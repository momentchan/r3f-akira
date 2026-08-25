import { stableRandomRange } from '@core';
import { clearPointFromHosts } from './bodyBounds';
import { sampleAnchorField } from './fieldAnchors';

/**
 * Cluster layout: hearts first, then stems hop around a heart.
 *
 * The same two primitives run at opening and on death:
 *   pickClumpHeart  — choose a heart on this pin (field × distance)
 *   sampleClumpHop  — hop hopRange off that heart, then the field accepts
 *
 * Opening places one stem on each heart so the bouquet has a core; everything
 * else is the death hop. Hearts wander on their own clock with migrateRange.
 */

const S_ANG = 12;
const S_RAD = 13;
const S_ROLL = 14;
const S_HOP_DIR = 15;
const S_HOP_LEN = 16;
const S_PARENT = 17;
const S_PICK = 18;

/** Attempts per point before giving up. */
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
 * Random xz inside this pin's ellipse (the disk where its field can be > 0).
 *
 * Uniform by area (sqrt on radius). `pad` widens the ellipse by the warp
 * amount: warp pushes the field out in places, and we only spawn inside this
 * disk, so without pad the warped edge would stay empty.
 */
function sampleInPinEllipse(anchor, tryIndex, seed, pad, origin = null) {
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
    clearanceHosts, clearMargin,
  },
) {
  const field = sampleAnchorField(sx, sz, anchors, fieldOptions);
  if (field <= floor) return null;
  if (stableRandomRange(tryIndex, S_ROLL, seed, 0, 1) > field) return null;

  let x = sx;
  let z = sz;
  const [px, pz, ok] = clearPointFromHosts(x, z, clearanceHosts, clearMargin);
  if (!ok) return null;
  x = px;
  z = pz;

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
  seed = 0,
  tick = 0,
  anchorIndex = -1,
  maxTries = MAX_TRIES,
}) {
  if (!anchors?.length) return null;
  const pad = fieldOptions.shapeWarp ?? 0;
  const ctx = {
    anchors, fieldOptions, floor,
    clearanceHosts, clearMargin,
  };

  for (let t = 0; t < maxTries; t += 1) {
    const tryIndex = (tick * 7919 + t * 271) % 2147483647;
    const ai = anchorIndex >= 0 && anchorIndex < anchors.length
      ? anchorIndex
      : pickAnchorIndex(anchors, tryIndex, seed);
    const anchor = anchors[ai];
    const origin = anchor;
    const s = sampleInPinEllipse(anchor, tryIndex, seed, pad, origin);
    const got = acceptCandidate(s.x, s.z, tryIndex, seed, ctx);
    if (got) return got;
  }
  return null;
}

/**
 * Hop off `from`: fresh random heading, length in [hopMin, hopMax], then the
 * field and mesh keep-out accept or reject. Opening and death both use this.
 */
export function sampleClumpHop({
  from,
  hopMin = 0.07,
  hopMax = 0.2,
  anchors,
  fieldOptions = {},
  floor = 0,
  clearanceHosts = [],
  clearMargin = 0.12,
  seed = 0,
  tick = 0,
  maxTries = MAX_TRIES,
}) {
  if (!from || !anchors?.length) return null;
  const ctx = {
    anchors, fieldOptions, floor,
    clearanceHosts, clearMargin,
  };

  for (let t = 0; t < maxTries; t += 1) {
    const tryIndex = (tick * 7919 + t * 271) % 2147483647;
    const dir = stableRandomRange(tryIndex, S_HOP_DIR, seed, 0, Math.PI * 2);
    const len = stableRandomRange(tryIndex, S_HOP_LEN, seed, hopMin, hopMax);
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
 * likelihood without everyone piling onto whichever heart is hottest. Pin
 * `anchorIndex` so a hip flower cannot rehome onto a backpack heart.
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
  anchorIndex = -1,
}) {
  const n = hearts?.length ?? 0;
  if (!n) return null;

  const pinOk = (h) => (
    anchorIndex < 0 || (h.anchorIndex ?? 0) === anchorIndex
  );

  let total = 0;
  const weights = new Array(n);
  const radius = Math.max(attractRadius, 1e-3);
  for (let i = 0; i < n; i += 1) {
    const h = hearts[i];
    if (!pinOk(h)) {
      weights[i] = 0;
      continue;
    }
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
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (!pinOk(hearts[i])) continue;
      const d = Math.hypot(x - hearts[i].cx, z - hearts[i].cz);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best >= 0 ? hearts[best] : null;
  }

  let roll = stableRandomRange(tick, S_PICK, seed, 0, total);
  let last = null;
  for (let i = 0; i < n; i += 1) {
    if (weights[i] <= 0) continue;
    last = hearts[i];
    roll -= weights[i];
    if (roll <= 0) return hearts[i];
  }
  return last;
}

export function buildAnchorClusterSlots({
  anchors,
  count,
  clearanceHosts = [],
  clearMargin = 0.12,
  bodyCenter = [0, 0],
  arrangementSeed = 0,
  fieldOptions = {},
  // 0.14 → about 1 in 7 of this pin's flowers sit on a heart.
  hearts: heartFrac = 0.14,
  hopMin = 0.07,
  hopMax = 0.2,
}) {
  if (!anchors?.length || count < 1) {
    return { slots: [], liveIndices: [], hearts: [] };
  }

  const pad = fieldOptions.shapeWarp ?? 0;
  const flowersPerPin = allocateByWeight(anchors.map((a) => a.weight), Math.floor(count));
  const [cx, cz] = bodyCenter;
  const slots = [];
  const liveIndices = [];
  const hearts = [];
  let nextHeartId = 0;

  const ctx = {
    anchors, fieldOptions, floor: 0,
    clearanceHosts, clearMargin,
  };

  const tryAccept = (sx, sz, tryIndex) => (
    acceptCandidate(sx, sz, tryIndex, arrangementSeed, ctx)
  );

  const pushSlot = (ai, p, clumpId) => {
    const index = slots.length;
    slots.push({
      x: p.x,
      z: p.z,
      leanOutwardAngle: Math.atan2(p.x - cx, p.z - cz),
      anchorIndex: ai,
      clumpId,
      fieldValue: p.field ?? 0,
    });
    return index;
  };

  /** Keep drawing in the pin ellipse until the field and keep-out accept. */
  const placeInPinEllipse = (anchor, ai, salt) => {
    for (let t = 0; t < MAX_TRIES; t += 1) {
      const tryIndex = ((ai * 7919 + salt * 271) * 61 + t) % 2147483647;
      const s = sampleInPinEllipse(anchor, tryIndex, arrangementSeed, pad);
      const got = tryAccept(s.x, s.z, tryIndex);
      if (got) return got;
    }
    return null;
  };

  const hopOpts = {
    hopMin, hopMax,
    anchors, fieldOptions,
    clearanceHosts, clearMargin,
    seed: arrangementSeed,
  };

  for (let ai = 0; ai < anchors.length; ai += 1) {
    const anchor = anchors[ai];
    const pinFlowers = flowersPerPin[ai];
    if (pinFlowers < 1) continue;

    const nHearts = Math.min(pinFlowers, Math.max(1, Math.round(pinFlowers * heartFrac)));
    const placed = [];
    const pinHearts = [];
    for (let f = 0; f < nHearts; f += 1) {
      const got = placeInPinEllipse(anchor, ai, f);
      if (got) {
        const id = nextHeartId;
        nextHeartId += 1;
        const heart = { id, cx: got.x, cz: got.z, anchorIndex: ai };
        hearts.push(heart);
        pinHearts.push(heart);
        placed.push({ p: got, clumpId: id });
      }
    }
    if (!placed.length) continue;

    let hx = 0;
    let hz = 0;
    for (let i = 0; i < pinHearts.length; i += 1) {
      hx += pinHearts[i].cx;
      hz += pinHearts[i].cz;
    }
    hx /= pinHearts.length;
    hz /= pinHearts.length;

    // Same rule as death: pick a heart, hop around it. Guard so a tight field
    // still places pinFlowers instead of silently thinning out.
    let guard = 0;
    while (placed.length < pinFlowers && guard < pinFlowers * 24) {
      guard += 1;
      const salt = (ai * 5003 + placed.length * 97 + guard) % 2147483647;
      const heart = pickClumpHeart({
        hearts: pinHearts,
        x: hx,
        z: hz,
        anchors,
        fieldOptions,
        attractRadius: hopMax * 3,
        seed: arrangementSeed,
        tick: salt,
        anchorIndex: ai,
      });
      if (!heart) break;
      const got = sampleClumpHop({
        ...hopOpts,
        from: { x: heart.cx, z: heart.cz },
        tick: salt,
      });
      if (got) placed.push({ p: got, clumpId: heart.id });
    }

    for (let i = 0; i < placed.length; i += 1) {
      liveIndices.push(pushSlot(ai, placed[i].p, placed[i].clumpId));
    }
  }

  return { slots, liveIndices, hearts };
}

