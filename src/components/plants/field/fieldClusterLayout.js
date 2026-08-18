import { stableRandomRange } from '@core';
import { clearPointFromDisc, clearPointFromHosts } from './bodyBounds';
import { sampleAnchorField } from './fieldAnchors';

/**
 * Dispersal-based slot sampling.
 *
 * A few FOUNDERS are placed by rejection against the anchor field, then each
 * spawns offspring a short hop away, and offspring can spawn their own. So every
 * flower has a per-flower cause — "it spread from that one" — which independent
 * sampling can never give: N uniform samples clump and gap by accident rather
 * than by rule, and no amount of field tuning changes that.
 *
 * Two deliberate choices keep this from reading as LINES of flowers, which is the
 * failure a naive dispersal walk falls into:
 *   - every hop picks a fresh random direction and never inherits the parent's
 *     heading, so a lineage cannot march off on one bearing;
 *   - parents are drawn from ALL placed points, not just the newest, so growth is
 *     bushy rather than a chain.
 *
 * `generation` and `clumpId` ride on every slot. `clumpId` is the opening
 * founder lineage — those points become the runtime HEARTS. Hearts wander on
 * their own clock; a dying flower picks among them by field × distance, then
 * hops around the chosen heart.
 */

const S_ANG = 12;
const S_RAD = 13;
const S_ROLL = 14;
const S_HOP_DIR = 15;
const S_HOP_LEN = 16;
const S_PARENT = 17;
const S_PICK = 18;
const S_APPETITE = 21;

/** Attempts per point before falling back or reporting a shortfall. */
const MAX_TRIES = 40;

/** Hop length decay per dispersal depth. Matches the opening layout. */
export const DEFAULT_HOP_DECAY = 0.55;

/** Founder respawn: sit on the clump heart, not a full first-generation hop. */
const FOUNDER_JITTER = 0.02;

/** Largest-remainder split of `total` across `weights`. */
function allocateByWeight(weights, total) {
  const n = weights.length;
  const counts = new Array(n).fill(0);
  if (!n || total < 1) return counts;
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 1e-8) return counts;

  const remainders = [];
  let assigned = 0;
  for (let i = 0; i < n; i += 1) {
    const exact = (weights[i] / sum) * total;
    const whole = Math.floor(exact);
    counts[i] = whole;
    assigned += whole;
    remainders.push({ i, frac: exact - whole });
  }
  remainders.sort((a, b) => b.frac - a.frac);
  for (let k = 0; assigned < total; k += 1, assigned += 1) {
    counts[remainders[k % n].i] += 1;
  }
  return counts;
}

/**
 * A point anywhere in an anchor's support, for founder placement.
 *
 * Uniform in area (hence the sqrt), padded by the domain-warp amplitude — the
 * warp displaces the field outward in places, and candidates only ever generate
 * inside this band, so an unpadded band would leave the warped fringes empty.
 */
function sampleInSupport(anchor, tryIndex, seed, pad, origin = null) {
  const ox = origin?.x ?? anchor.x;
  const oz = origin?.z ?? anchor.z;
  const angle = stableRandomRange(tryIndex, S_ANG, seed, 0, Math.PI * 2);
  const u = stableRandomRange(tryIndex, S_RAD, seed, 0, 1);
  const innerPad = Math.max(0, anchor.inner - pad);
  const outerPad = anchor.radius + pad;
  const rr = Math.sqrt(
    innerPad * innerPad + u * (outerPad * outerPad - innerPad * innerPad),
  );

  const along = Math.cos(angle) * rr * anchor.elong;
  const across = Math.sin(angle) * rr;
  return {
    x: ox + along * anchor.axis.ax - across * anchor.axis.az,
    z: oz + along * anchor.axis.az + across * anchor.axis.ax,
  };
}

function pickAnchorIndex(anchors, tryIndex, seed) {
  let sum = 0;
  for (let i = 0; i < anchors.length; i += 1) sum += anchors[i].weight;
  if (sum <= 1e-8) return 0;
  let roll = stableRandomRange(tryIndex, S_PARENT, seed, 0, sum);
  for (let i = 0; i < anchors.length; i += 1) {
    roll -= anchors[i].weight;
    if (roll <= 0) return i;
  }
  return anchors.length - 1;
}

/**
 * Field-weighted accept, then the hard keep-out. `random > field` is the
 * probability: sparse ground can still win, just rarely. Zero field is the
 * only hard reject.
 */
function acceptCandidate(
  sx, sz, tryIndex, seed,
  {
    anchors, fieldOptions, floor = 0,
    head, faceClearRadius = 0,
    clearanceHosts, clearMargin, clearHeights,
  },
) {
  const field = sampleAnchorField(sx, sz, anchors, fieldOptions);
  if (field <= floor) return null;
  if (stableRandomRange(tryIndex, S_ROLL, seed, 0, 1) > field) return null;

  let x = sx;
  let z = sz;
  if (faceClearRadius > 0 && head) {
    [x, z] = clearPointFromDisc(x, z, head.x, head.z, faceClearRadius);
  }
  const [px, pz, ok] = clearPointFromHosts(x, z, clearanceHosts, clearMargin, clearHeights);
  if (!ok) return null;
  x = px;
  z = pz;

  if (faceClearRadius > 0 && head
    && Math.hypot(x - head.x, z - head.z) < faceClearRadius * 0.92) return null;
  const settled = sampleAnchorField(x, z, anchors, fieldOptions);
  if (settled <= floor) return null;
  return { x, z, field: settled };
}

/**
 * Rejection-sample one point from the live density field.
 *
 * Used when a heart's periodic hop fails and it needs to catch the drifted
 * mass. Pin `anchorIndex` so a hip heart cannot jump to the backpack.
 */
export function sampleFieldPosition({
  anchors,
  fieldOptions = {},
  floor = 0,
  clearanceHosts = [],
  clearMargin = 0.12,
  clearHeights,
  head = null,
  faceClearRadius = 0,
  seed = 0,
  tick = 0,
  anchorIndex = -1,
  maxTries = MAX_TRIES,
}) {
  if (!anchors?.length) return null;
  const pad = fieldOptions.shapeWarp ?? 0;
  const centres = fieldOptions.centres;
  const ctx = {
    anchors, fieldOptions, floor,
    head, faceClearRadius, clearanceHosts, clearMargin, clearHeights,
  };

  for (let t = 0; t < maxTries; t += 1) {
    const tryIndex = (tick * 7919 + t * 271) % 2147483647;
    const ai = anchorIndex >= 0 && anchorIndex < anchors.length
      ? anchorIndex
      : pickAnchorIndex(anchors, tryIndex, seed);
    const anchor = anchors[ai];
    const origin = centres?.[ai] ?? anchor;
    const s = sampleInSupport(anchor, tryIndex, seed, pad, origin);
    const got = acceptCandidate(s.x, s.z, tryIndex, seed, ctx);
    if (got) return got;
  }
  return null;
}

/**
 * Hop off `from` the way opening dispersal does: fresh random heading, length
 * shrinking with generation. Founders (generation 0) sit on the clump heart
 * with a tiny jitter so they do not pixel-lock across cycles.
 */
export function sampleClumpHop({
  from,
  generation = 0,
  hopMin = 0.07,
  hopMax = 0.2,
  hopDecay = DEFAULT_HOP_DECAY,
  anchors,
  fieldOptions = {},
  floor = 0,
  clearanceHosts = [],
  clearMargin = 0.12,
  clearHeights,
  head = null,
  faceClearRadius = 0,
  seed = 0,
  tick = 0,
  maxTries = MAX_TRIES,
}) {
  if (!from || !anchors?.length) return null;
  const ctx = {
    anchors, fieldOptions, floor,
    head, faceClearRadius, clearanceHosts, clearMargin, clearHeights,
  };
  const parentGen = Math.max(0, generation - 1);
  const decay = generation <= 0 ? 1 : 1 / (1 + parentGen * hopDecay);
  const lo = generation <= 0 ? 0 : hopMin * decay;
  const hi = generation <= 0 ? FOUNDER_JITTER : hopMax * decay;

  for (let t = 0; t < maxTries; t += 1) {
    const tryIndex = (tick * 7919 + t * 271) % 2147483647;
    const dir = stableRandomRange(tryIndex, S_HOP_DIR, seed, 0, Math.PI * 2);
    const len = stableRandomRange(tryIndex, S_HOP_LEN, seed, lo, hi);
    const got = acceptCandidate(
      from.x + Math.cos(dir) * len,
      from.z + Math.sin(dir) * len,
      tryIndex, seed, ctx,
    );
    if (got) return got;
  }
  return null;
}

/**
 * Weighted pick among live hearts: P ∝ field(heart) × exp(-dist / attractRadius).
 *
 * Distance keeps a dying flower in its neighbourhood so occupancy can follow
 * likelihood without everyone piling onto whichever heart is hottest.
 */
export function pickClumpHeart({
  hearts,
  x, z,
  anchors,
  fieldOptions = {},
  floor = 0,
  attractRadius = 0.6,
  seed = 0,
  tick = 0,
}) {
  const n = hearts?.length ?? 0;
  if (!n) return null;

  let total = 0;
  const weights = new Array(n);
  const radius = Math.max(attractRadius, 1e-3);
  for (let i = 0; i < n; i += 1) {
    const h = hearts[i];
    const field = sampleAnchorField(h.cx, h.cz, anchors, fieldOptions);
    if (field <= floor) {
      weights[i] = 0;
      continue;
    }
    const dist = Math.hypot(x - h.cx, z - h.cz);
    const w = field * Math.exp(-dist / radius);
    weights[i] = w;
    total += w;
  }

  if (total <= 1e-8) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = Math.hypot(x - hearts[i].cx, z - hearts[i].cz);
      if (d < bestD) { bestD = d; best = i; }
    }
    return hearts[best];
  }

  let roll = stableRandomRange(tick, S_PICK, seed, 0, total);
  for (let i = 0; i < n; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return hearts[i];
  }
  return hearts[n - 1];
}

export function buildAnchorClusterSlots({
  anchors,
  count,
  clearanceHosts = [],
  clearMargin = 0.12,
  clearHeights,
  head = null,
  faceClearRadius = 0,
  bodyCenter = [0, 0],
  arrangementSeed = 0,
  fieldOptions = {},
  founderShare = 0.14,
  hopMin = 0.07,
  hopMax = 0.2,
  hopDecay = DEFAULT_HOP_DECAY,
  clumpVariance = 0.6,
}) {
  if (!anchors?.length || count < 1) {
    return { slots: [], liveIndices: [], diagnostics: { shortfall: 0, attempts: 0, founders: 0 } };
  }

  const pad = fieldOptions.shapeWarp ?? 0;
  const liveByAnchor = allocateByWeight(anchors.map((a) => a.weight), Math.floor(count));
  const [cx, cz] = bodyCenter;
  const slots = [];
  const liveIndices = [];
  let shortfall = 0;
  let attempts = 0;
  let founderCount = 0;
  let nextClumpId = 0;

  const ctx = {
    anchors, fieldOptions, floor: 0,
    head, faceClearRadius, clearanceHosts, clearMargin, clearHeights,
  };

  const tryAccept = (sx, sz, tryIndex) => {
    attempts += 1;
    return acceptCandidate(sx, sz, tryIndex, arrangementSeed, ctx);
  };

  const pushSlot = (anchor, ai, p, generation, clumpId) => {
    const index = slots.length;
    slots.push({
      x: p.x,
      z: p.z,
      leanOutwardAngle: Math.atan2(p.x - cx, p.z - cz),
      anchorIndex: ai,
      generation,
      clumpId,
      // Local density at this slot. Role and bloom derive from this rather than from
      // dispersal depth, which was an artifact of traversal order with no relation
      // to the field.
      fieldValue: p.field ?? 0,
    });
    return index;
  };

  /** Rejection-sample a founder anywhere in the anchor's support. */
  const placeFounder = (anchor, ai, salt) => {
    for (let t = 0; t < MAX_TRIES; t += 1) {
      const tryIndex = ((ai * 7919 + salt * 271) * 61 + t) % 2147483647;
      const s = sampleInSupport(anchor, tryIndex, arrangementSeed, pad);
      const got = tryAccept(s.x, s.z, tryIndex);
      if (got) return got;
    }
    return null;
  };

  /**
   * Hop off `from` in a fresh random direction.
   *
   * The hop SHRINKS with generation. A uniform hop made every clump the same
   * scale and evenly filled; decaying it packs the deeper generations tight
   * around their parents, which is what produces a dense core with a loose
   * fringe instead of a uniform blob.
   */
  const placeHop = (from, salt, generation = 0) => {
    const decay = 1 / (1 + generation * hopDecay);
    const lo = hopMin * decay;
    const hi = hopMax * decay;
    for (let t = 0; t < MAX_TRIES; t += 1) {
      const tryIndex = (salt * 31 + t) % 2147483647;
      const dir = stableRandomRange(tryIndex, S_HOP_DIR, arrangementSeed, 0, Math.PI * 2);
      const len = stableRandomRange(tryIndex, S_HOP_LEN, arrangementSeed, lo, hi);
      const got = tryAccept(
        from.x + Math.cos(dir) * len,
        from.z + Math.sin(dir) * len,
        tryIndex,
      );
      if (got) return got;
    }
    return null;
  };

  for (let ai = 0; ai < anchors.length; ai += 1) {
    const anchor = anchors[ai];
    const budget = liveByAnchor[ai];
    if (budget < 1) continue;

    // Founders are rejection-sampled against the field, so a lineage still starts
    // where the anchor says vegetation belongs.
    const founders = Math.min(budget, Math.max(1, Math.round(budget * founderShare)));
    const placed = [];
    for (let f = 0; f < founders; f += 1) {
      const got = placeFounder(anchor, ai, f);
      if (got) {
        placed.push({
          p: got, gen: 0, parent: -1, root: placed.length, clumpId: nextClumpId,
        });
        nextClumpId += 1;
      }
    }
    if (!placed.length) { shortfall += budget; continue; }
    founderCount += placed.length;

    // Per-founder appetite, so clump SIZES differ. Splitting the budget evenly
    // gave every clump the same mass, which is the other reason they all read
    // alike. Weighted parent choice concentrates growth on the hungry ones.
    const appetite = placed.map((_, f) => 1 + stableRandomRange(
      ai * 31 + f, S_APPETITE, arrangementSeed, -clumpVariance, clumpVariance * 2,
    ));

    // Spread. Any placed point may parent, which is what keeps the shape bushy.
    let guard = 0;
    while (placed.length < budget && guard < budget * 24) {
      guard += 1;
      const salt = (ai * 5003 + placed.length * 97 + guard) % 2147483647;
      // Weighted toward the founder lineages with the larger appetite.
      let total = 0;
      for (let q = 0; q < placed.length; q += 1) {
        total += Math.max(0.05, appetite[placed[q].root ?? q] ?? 1);
      }
      let roll = stableRandomRange(salt, S_PARENT, arrangementSeed, 0, total);
      let pick = placed.length - 1;
      for (let q = 0; q < placed.length; q += 1) {
        roll -= Math.max(0.05, appetite[placed[q].root ?? q] ?? 1);
        if (roll <= 0) { pick = q; break; }
      }
      const parent = placed[pick];
      const got = placeHop(parent.p, salt, parent.gen);
      if (got) {
        placed.push({
          p: got, gen: parent.gen + 1, parent: pick,
          root: parent.root ?? pick, clumpId: parent.clumpId,
        });
      }
    }

    // Dispersal can stall where the field is tight. Top up by plain field
    // sampling so the count is met rather than silently thinning out. Attach the
    // extra to the nearest founder so it stays in a bouquet instead of becoming
    // a one-flower "clump" that relocates every death.
    let topUp = 0;
    while (placed.length < budget && topUp < budget) {
      topUp += 1;
      const got = placeFounder(anchor, ai, 1000 + topUp);
      if (!got) break;
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < placed.length; i += 1) {
        if (placed[i].gen !== 0) continue;
        const d = Math.hypot(got.x - placed[i].p.x, got.z - placed[i].p.z);
        if (d < best) { best = d; nearest = i; }
      }
      const founder = placed[nearest];
      placed.push({
        p: got, gen: 1, parent: nearest,
        root: founder.root ?? nearest, clumpId: founder.clumpId,
      });
    }
    if (placed.length < budget) shortfall += budget - placed.length;

    for (let i = 0; i < placed.length; i += 1) {
      const entry = placed[i];
      liveIndices.push(pushSlot(
        anchor, ai, entry.p, entry.gen, entry.clumpId,
      ));
    }
  }

  return {
    slots,
    liveIndices,
    diagnostics: { shortfall, attempts, founders: founderCount },
  };
}
