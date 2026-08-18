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
 * `generation` and `parentIndex` ride on every slot, so the role hierarchy can
 * later fall out of the dispersal tree — founders are the primaries, first
 * offspring the secondaries, deeper generations the quiet echoes.
 */

const S_ANG = 12;
const S_RAD = 13;
const S_ROLL = 14;
const S_HOP_DIR = 15;
const S_HOP_LEN = 16;
const S_PARENT = 17;
const S_APPETITE = 21;

/** Attempts per point before falling back or reporting a shortfall. */
const MAX_TRIES = 40;

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
function sampleInSupport(anchor, tryIndex, seed, pad) {
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
    x: anchor.x + along * anchor.axis.ax - across * anchor.axis.az,
    z: anchor.z + along * anchor.axis.az + across * anchor.axis.ax,
  };
}

export function buildAnchorClusterSlots({
  anchors,
  // Anchors widened by the migration range. LIVE slots are placed against
  // `anchors` so the opening composition is tight to the field that actually
  // exists; only the respawn spares are allowed out here, where the field is not
  // yet but will be. Placing live slots against the envelope was survivable only
  // while a gate hid the ones in the margin — without it they read as a vague
  // halo around every mass.
  envelopeAnchors = null,
  // How far a respawn spare may sit from its live point. Set to the migration
  // range: spares are the ONLY slots a respawning plant can move into, so hugging
  // the parent means the composition can never follow the drifting field, while
  // scattering scene-wide dissolves the clusters. One cluster-travel is the reach
  // that gives migration room without costing cluster identity.
  variantSpread = 0,
  count,
  slotFactor = 1,
  clearanceHosts = [],
  clearMargin = 0.12,
  clearHeights,
  head = null,
  faceClearRadius = 0,
  bodyCenter = [0, 0],
  nearR = 0.1,
  farR = 1,
  arrangementSeed = 0,
  fieldOptions = {},
  founderShare = 0.14,
  hopMin = 0.07,
  hopMax = 0.2,
  hopDecay = 0.55,
  clumpVariance = 0.6,
}) {
  if (!anchors?.length || count < 1) {
    return { slots: [], liveIndices: [], diagnostics: { shortfall: 0, attempts: 0, founders: 0 } };
  }

  const variants = Math.max(1, Math.round(slotFactor));
  const envelopeSet = envelopeAnchors ?? anchors;
  const pad = fieldOptions.warpAmount ?? 0;
  const liveByAnchor = allocateByWeight(anchors.map((a) => a.weight), Math.floor(count));
  const [cx, cz] = bodyCenter;
  const slots = [];
  const liveIndices = [];
  let shortfall = 0;
  let attempts = 0;
  let founderCount = 0;

  /**
   * Field roll, then the hard keep-out. Everything above the clearance call is
   * arithmetic, so rejection stays cheap against a chain that runs ~100
   * closest-point queries. Note `fieldOptions` carries no `hosts` here — the
   * clearance below PUSHES points out rather than discarding them.
   */
  const tryAccept = (sx, sz, tryIndex, envelope = false) => {
    const against = envelope ? envelopeSet : anchors;
    const field = sampleAnchorField(sx, sz, against, fieldOptions);
    if (field <= 0) return null;
    if (stableRandomRange(tryIndex, S_ROLL, arrangementSeed, 0, 1) > field) return null;

    let x = sx;
    let z = sz;
    if (faceClearRadius > 0 && head) {
      [x, z] = clearPointFromDisc(x, z, head.x, head.z, faceClearRadius);
    }
    const [px, pz, ok] = clearPointFromHosts(x, z, clearanceHosts, clearMargin, clearHeights);
    if (!ok) return null;
    x = px;
    z = pz;

    // The push moved the point. Re-verify the cheap invariants, but never push
    // again — it can ping-pong between the face disc and the mesh.
    if (faceClearRadius > 0 && head
      && Math.hypot(x - head.x, z - head.z) < faceClearRadius * 0.92) return null;
    // Measured AFTER the push, so it describes where the flower actually stands.
    const settled = sampleAnchorField(x, z, against, fieldOptions);
    if (settled <= 0) return null;
    return { x, z, field: settled };
  };

  const pushSlot = (anchor, ai, p, generation, parentIndex, variant, ownerSlot = -1) => {
    const distC = Math.hypot(p.x - cx, p.z - cz);
    const index = slots.length;
    slots.push({
      x: p.x,
      z: p.z,
      rimT: Math.min(1, Math.max(0, (distC - nearR) / Math.max(farR - nearR, 1e-4))),
      leanOutwardAngle: Math.atan2(p.x - cx, p.z - cz),
      anchorId: anchor.id,
      anchorIndex: ai,
      generation,
      parentIndex,
      variant,
      // For a variant, the slot index of the live plant it belongs to; -1 for a
      // live slot. Role is classified only for live slots, so a variant inherits
      // its owner's role and lands in the same respawn bucket.
      ownerSlot,
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
      attempts += 1;
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
      attempts += 1;
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

  /**
   * A respawn target for the live point `from`.
   *
   * Reaches further than a dispersal hop — out to `variantSpread` — and is tested
   * against the ENVELOPE rather than the live field, because a spare's whole job
   * is to already exist where the drifting field is heading. No generation decay:
   * a deep-generation plant needs the same room to follow the mass as a founder.
   */
  const placeSpare = (from, salt) => {
    const hi = Math.max(hopMax, variantSpread);
    for (let t = 0; t < MAX_TRIES; t += 1) {
      attempts += 1;
      const tryIndex = (salt * 31 + t) % 2147483647;
      const dir = stableRandomRange(tryIndex, S_HOP_DIR, arrangementSeed, 0, Math.PI * 2);
      const len = stableRandomRange(tryIndex, S_HOP_LEN, arrangementSeed, hopMin, hi);
      const got = tryAccept(
        from.x + Math.cos(dir) * len,
        from.z + Math.sin(dir) * len,
        tryIndex,
        true,
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
      if (got) placed.push({ p: got, gen: 0, parent: -1, root: placed.length });
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
      if (got) placed.push({ p: got, gen: parent.gen + 1, parent: pick, root: parent.root ?? pick });
    }

    // Dispersal can stall where the field is tight. Top up by plain field
    // sampling so the count is met rather than silently thinning out.
    let topUp = 0;
    while (placed.length < budget && topUp < budget) {
      topUp += 1;
      const got = placeFounder(anchor, ai, 1000 + topUp);
      if (!got) break;
      placed.push({ p: got, gen: 1, parent: -1 });
    }
    if (placed.length < budget) shortfall += budget - placed.length;

    // Emit each live point followed by its respawn spares. A spare stays within one
    // cluster-travel of the live point, so a respawning plant follows its own
    // cluster as the field drifts rather than teleporting across the composition.
    for (let i = 0; i < placed.length; i += 1) {
      const entry = placed[i];
      const liveIndex = pushSlot(anchor, ai, entry.p, entry.gen, entry.parent, 0);
      liveIndices.push(liveIndex);
      for (let v = 1; v < variants; v += 1) {
        const got = placeSpare(entry.p, (ai * 1299721 + i * 131 + v * 17) % 2147483647);
        if (got) pushSlot(anchor, ai, got, entry.gen, i, v, liveIndex);
      }
    }
  }

  return {
    slots,
    liveIndices,
    diagnostics: { shortfall, attempts, founders: founderCount },
  };
}
