import { closestDistanceAtXZ } from './bodyBounds';
import { valueNoise3D } from '../climb/spatialNoise';

/**
 * Anchors for the flower field.
 *
 * An anchor does NOT mean a flower grows there. It raises the probability of
 * vegetation appearing somewhere in its neighbourhood — the cluster centre is
 * allowed to drift off the anchor, neighbouring fields merge, and bare ground
 * survives between them. Placing flowers *at* anchors is what produces the
 * "arranged along a structure" look this exists to avoid.
 */

/** Probe heights for anchor fitting. Ground clearance only, so 3 not 6. */
const FIT_HEIGHTS = [0.05, 0.2, 0.4];
/** Field-local Y above which a capsule station is not resting on the ground. */
const GROUND_BAND_MAX = 0.55;
/** Probes around an anchor's inner ring when fitting it clear of the suit. */
const FIT_PROBES = 8;
const FIT_STEPS = 5;
/** How quickly density rises off the keep-out edge, in world units. */
const CONTACT_RISE = 0.1;

export const ANCHOR_COLORS = ['#ff9f1c', '#2ec4b6', '#3a86ff', '#c77dff'];

/**
 * Deliberately four, not eleven.
 *
 * `u` is the station along the capsule's `a -> b` axis, and LIMB_CAPSULE_DEFS
 * documents `a -> b` as the anatomical growth direction — so for `forearm.r`,
 * `a` is the HAND and low `u` means the hand. For `torso`, `a` is `spine_01`, so
 * low `u` means the hip. Getting `u` backwards is the easiest silent mistake
 * here: the ids name the region, not the endpoint.
 *
 * One arm only. A cluster at every contact point is exactly how this becomes
 * silhouette-outlining.
 */
export const LAY_ANCHOR_DEFS = [
  {
    id: 'hip',
    source: 'torso',
    u: 0.22,
    weight: 1.2,
    // Reach has to exceed footprint + clearMargin by enough for fitInner to grow
    // the inner ring clear of the suit, AND leave a wide band beyond it. Measured
    // inner lands at 0.79, so 1.25 gave a 0.46-wide band and the slots read as a
    // thin ring rather than a mass.
    // Widened to close the gap toward the backpack, which read as a hole.
    reach: 1.9,
    // Lozenge along the body axis rather than a puck at the hip.
    elong: 1.35,
  },
  {
    // The LEFT hand deliberately, not the right. Measured positions put the
    // character's right hand at x=-0.84 and the backpack at x=-1.84 — the same
    // side — so a right-hand anchor piles onto the heavy side and leaves the far
    // side empty. One arm still, just the one that balances.
    id: 'hand.l',
    source: 'forearm.l',
    u: 0.12,
    weight: 0.85,
    reach: 0.8,
    elong: 1.5,
  },
  {
    // The boot. A genuine ground-contact point, and it fills the region below the
    // legs that three anchors left bare. calf.a is the FOOT, so u is low.
    id: 'boot.l',
    source: 'calf.l',
    u: 0.16,
    weight: 0.8,
    reach: 0.85,
    elong: 1.6,
  },
  {
    id: 'backpack',
    source: 'backpack',
    u: 0.5,
    // Back up from 0.9: at that weight its slots spread so thin across the widened
    // band that the backpack stopped reading as a growth source at all, which breaks
    // one of the five questions the layout has to answer.
    weight: 1.1,
    // Sized against the bag, not the body: at 1.55 the annulus stretched to
    // x = -0.24 and bled into the torso, so the two masses stopped reading as
    // separate sources.
    reach: 1.2,
    elong: 1.15,
  },
];

function smoothstep01(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function station(capsule, u) {
  return {
    x: capsule.a.x + (capsule.b.x - capsule.a.x) * u,
    y: capsule.a.y + (capsule.b.y - capsule.a.y) * u,
    z: capsule.a.z + (capsule.b.z - capsule.a.z) * u,
  };
}

/** Normalized XZ axis of a capsule, falling back when it is near-vertical. */
function axisXZ(capsule, fallback) {
  const ax = capsule.b.x - capsule.a.x;
  const az = capsule.b.z - capsule.a.z;
  const len = Math.hypot(ax, az);
  if (len < 1e-4) return fallback;
  return { ax: ax / len, az: az / len };
}

/** Distance to the closest of any host mesh at (x,z), or null if none hit. */
function nearestHostDistance(hosts, x, z) {
  let best = null;
  for (let i = 0; i < hosts.length; i += 1) {
    const hit = closestDistanceAtXZ(hosts[i].bvh, x, z, FIT_HEIGHTS);
    if (hit && (best === null || hit.distance < best)) best = hit.distance;
  }
  return best;
}

/**
 * Grow the inner keep-out until the anchor's inner ring is mostly plantable.
 *
 * This exists to make one specific failure visible. If an anchor sits buried
 * inside the suit, every candidate around it gets pushed out to the same
 * silhouette contour, and its "cluster" degenerates into an arc on the body
 * outline — visually indistinguishable from the spiral being replaced, but now
 * carrying a confident false cause. Broken and unfalsifiable is worse than
 * broken, so report it as buried instead of silently producing that arc.
 *
 * Probes are generated in the anchor's OWN elongated frame, matching how
 * `anchorFalloff` measures distance. A circular probe ring penalised exactly the
 * along-body directions that `elong` exists to stretch clear, so a source in the
 * middle of a lying figure (the hip) could never pass however much reach it got.
 */
function fitInner(x, z, r0, reach, hosts, margin, axis, elong) {
  if (!hosts.length) return { inner: r0, clear: FIT_PROBES, bestClear: FIT_PROBES, buried: false };
  let bestClear = 0;
  for (let step = 0; step < FIT_STEPS; step += 1) {
    const r = r0 * (1 + step * 0.35);
    // Allow growth right up to the outer reach. Capping at 0.9 * reach starved
    // wide sources of the growth steps they need and reported them as `buried`
    // when they were merely under-provisioned.
    if (r > reach) break;
    let clear = 0;
    for (let i = 0; i < FIT_PROBES; i += 1) {
      const a = (i / FIT_PROBES) * Math.PI * 2;
      const along = Math.cos(a) * r * elong;
      const across = Math.sin(a) * r;
      const px = x + along * axis.ax - across * axis.az;
      const pz = z + along * axis.az + across * axis.ax;
      const d = nearestHostDistance(hosts, px, pz);
      if (d === null || d >= margin) clear += 1;
    }
    if (clear > bestClear) bestClear = clear;
    // 4 of 8, not 5: half the ring clear is enough for an annulus that is
    // deliberately lopsided against a body lying across it.
    if (clear >= 4) return { inner: r, clear, bestClear, buried: false };
  }
  return { inner: r0, clear: 0, bestClear, buried: true };
}

function backpackSource(localBox) {
  if (!localBox || localBox.isEmpty()) return null;
  const halfX = (localBox.max.x - localBox.min.x) * 0.5;
  const halfZ = (localBox.max.z - localBox.min.z) * 0.5;
  return {
    x: (localBox.min.x + localBox.max.x) * 0.5,
    z: (localBox.min.z + localBox.max.z) * 0.5,
    y: Math.max(localBox.min.y, 0),
    // The larger half-extent, NOT the circumscribed half-diagonal. The diagonal
    // starts the ring outside the box CORNERS, which is far too conservative
    // against its flat faces — it pushed inner to 0.82 and, with a reach wide
    // enough to give a usable band, the annulus reached almost to the torso.
    // fitInner BVH-probes and grows this if it is genuinely too tight, so
    // starting snug is safe.
    footprint: Math.max(halfX, halfZ),
    axis: halfX >= halfZ ? { ax: 1, az: 0 } : { ax: 0, az: 1 },
  };
}

/**
 * @returns {{ anchors: Array, diagnostics: { found, expected, issues } }}
 */
export function deriveFieldAnchors({
  capsules = [],
  bodyRight = null,
  backpackBox = null,
  // `{ bvh }[]` — all hosts, not just the body. Fitting the backpack anchor
  // against the body alone judged its ring against the wrong mesh.
  hosts = [],
  clearMargin = 0.12,
  reachScale = 1,
  weightOverrides = null,
  defs = LAY_ANCHOR_DEFS,
}) {
  const byId = new Map(capsules.map((capsule) => [capsule.id, capsule]));
  const rightXZ = (() => {
    const rx = bodyRight?.x ?? 1;
    const rz = bodyRight?.z ?? 0;
    const len = Math.hypot(rx, rz);
    return len < 1e-5 ? { ax: 1, az: 0 } : { ax: rx / len, az: rz / len };
  })();

  const anchors = [];
  const issues = [];

  for (let defIndex = 0; defIndex < defs.length; defIndex += 1) {
    const def = defs[defIndex];
    let src = null;
    if (def.source === 'backpack') {
      src = backpackSource(backpackBox);
      if (!src) { issues.push({ id: def.id, reason: 'missing-backpack' }); continue; }
    } else {
      const capsule = byId.get(def.source);
      if (!capsule) { issues.push({ id: def.id, reason: 'missing-capsule' }); continue; }
      const point = station(capsule, def.u);
      // Keeps the module pose-agnostic instead of secretly Lay-only.
      if (point.y > GROUND_BAND_MAX) {
        issues.push({ id: def.id, reason: 'airborne' });
        continue;
      }
      src = {
        x: point.x,
        z: point.z,
        y: point.y,
        // The suit is fatter than the bone capsule; fitInner makes the fudge safe.
        footprint: capsule.radius * 1.9,
        axis: axisXZ(capsule, rightXZ),
      };
    }

    const reach = def.reach * reachScale;
    // Diagnostic ONLY. Its radius is deliberately not used as the density hole:
    // excluding a whole circle around the anchor centre also excluded every bit of
    // near-contact ground, so nothing could grow against the suit or the bag. The
    // real "do not plant inside the mesh" rule is the nearestHostDistance mask,
    // which measures from the SURFACE and lets density hug the silhouette.
    const fit = fitInner(
      src.x, src.z, src.footprint + clearMargin, reach, hosts, clearMargin,
      src.axis, def.elong,
    );
    if (fit.buried) {
      issues.push({
        id: def.id,
        reason: 'buried',
        // Enough to diagnose without re-running: where it sat, how wide it had to
        // start, and how close the best ring got to the 4-of-8 threshold.
        at: `${src.x.toFixed(2)},${src.y.toFixed(2)},${src.z.toFixed(2)}`,
        startInner: (src.footprint + clearMargin).toFixed(2),
        reach: reach.toFixed(2),
        bestClear: `${fit.bestClear}/${FIT_PROBES}`,
      });
      continue;
    }

    const index = anchors.length;

    const weight = weightOverrides?.[def.id] ?? def.weight;

    anchors.push({
      id: def.id,
      index,
      x: src.x,
      z: src.z,
      weight,
      radius: reach,
      // Just the mesh clearance, so flowers reach the surface.
      inner: clearMargin,
      axis: src.axis,
      elong: def.elong,
      sourceId: def.source,
      color: ANCHOR_COLORS[index % ANCHOR_COLORS.length],
    });
  }

  return {
    anchors,
    diagnostics: { found: anchors.length, expected: defs.length, issues },
  };
}

/**
 * Coherent 2-D domain warp.
 *
 * The crucial difference from `edgeNoiseAmount`: that multiplies the field's
 * VALUE, which only varies a ring's intensity — the ring is still a ring. This
 * displaces the sample POSITION before distance is measured, so the shape itself
 * becomes irregular. Because the warp is spatially coherent and shared across
 * anchors, neighbouring blobs deform together and merge believably instead of
 * looking like two circles that happen to overlap.
 */
function warpPoint(x, z, amount, frequency, seed) {
  if (amount <= 0) return { x, z };
  return {
    x: x + valueNoise3D(x * frequency, 3.7, z * frequency, seed) * amount,
    z: z + valueNoise3D(x * frequency, 8.1, z * frequency, seed + 977) * amount,
  };
}

/**
 * Shared low-frequency presence mask — irregular bare patches across the WHOLE
 * composition, not per anchor.
 *
 * This is what stops an annulus reading as a closed ring: it punches organic gaps
 * straight through one. Being shared rather than per-anchor is deliberate, so the
 * negative space reads as one coherent set of clearings rather than as each
 * cluster having its own private holes.
 */
function presenceMask(x, z, amount, frequency, seed) {
  if (amount <= 0) return 1;
  const n = valueNoise3D(x * frequency, 21.4, z * frequency, seed + 5011) * 0.5 + 0.5;
  // `amount` raises the cut, so higher = more bare ground.
  const cut = amount * 0.85;
  return smoothstep01((n - cut) / 0.28);
}

/**
 * Where an anchor's field centre sits at time `t`.
 *
 * A slow 2-D noise walk around the anchor rather than an orbit: an orbit is a
 * regular path and would read as the clusters going round in circles. The walk
 * is bounded by `dist`, so a cluster wanders near its cause and never detaches
 * from it — the anchor stays the reason even while the mass moves.
 */
export function animatedCentre(anchor, time, dist, speed) {
  if (!(dist > 0) || !(speed > 0)) return { x: anchor.x, z: anchor.z };
  const t = time * speed;
  // valueNoise3D is -1..1, so the walk is centred on the anchor and the slot
  // envelope (radius + migrateDist about the same point) covers it exactly.
  //
  // This walk is also the ONLY thing that offsets a mass from its cause. A static
  // `centre drift` used to sit underneath it and was removed: at 0.18 against a
  // 0.45 migration range it was unobservable, and two mechanisms for "the mass is
  // not exactly on the anchor" is one too many.
  return {
    x: anchor.x + valueNoise3D(t, anchor.index * 13.7, 0.5, 101) * dist,
    z: anchor.z + valueNoise3D(t, anchor.index * 13.7, 7.9, 227) * dist,
  };
}

/** One anchor's annular falloff at (x,z), measured from `cx,cz`. */
function anchorFalloff(anchor, x, z, cx, cz) {
  const dx = x - cx;
  const dz = z - cz;
  // Into the anchor's frame, then un-stretch along its axis so the field is a
  // lozenge along the limb rather than a circle around a point.
  const along = dx * anchor.axis.ax + dz * anchor.axis.az;
  const across = -dx * anchor.axis.az + dz * anchor.axis.ax;
  const d = Math.hypot(along / Math.max(anchor.elong, 1e-3), across);
  if (d >= anchor.radius || d <= anchor.inner) return 0;

  // A true annulus: hard zero inside the fitted keep-out, a short rise just
  // outside it, then a long falloff to the outer reach. An earlier version ramped
  // from zero at the anchor *centre* up to full at `inner`, which put the highest
  // density directly on top of the suit — the keep-out excluded nothing.
  // Rise measured in ABSOLUTE distance, not as a fraction of the band: density
  // should peak right against the surface and thin outward, because contact is
  // what makes the vegetation read as caused by the body. Using a band fraction
  // put the peak ~0.46 out from the anchor and left the contact ground bare.
  const rise = smoothstep01((d - anchor.inner) / CONTACT_RISE);
  const t = (d - anchor.inner) / Math.max(anchor.radius - anchor.inner, 1e-3);
  const fall = 1 - smoothstep01(t);
  return rise * fall;
}

/**
 * Probability of vegetation at (x,z), 0..1.
 *
 * Anchors are SUMMED before saturating, so neighbouring fields merge into one
 * mass instead of reading as N discs. That is deliberate: if the viewer can
 * count the clusters and get the anchor count, the system is visible.
 */
export function sampleAnchorField(x, z, anchors, options = {}) {
  const {
    mergeNorm = 1.15,
    edgeNoiseAmount = 0.35,
    edgeNoiseFrequency = 2.6,
    warpAmount = 0.3,
    warpFrequency = 1.6,
    gapAmount = 0.4,
    gapFrequency = 1.1,
    seed = 0,
    // Optional hard keep-out. A single per-anchor inner radius can only carve a
    // circular hole, but the body is a star shape — arms and legs lie inside the
    // annulus band. Without this the field promises density exactly where the
    // clearance chain would reject it.
    hosts = null,
    clearMargin = 0,
    // Migration. `time` 0 or `migrateDist` 0 pins the centres where they were
    // derived, so a still field is exactly the old behaviour.
    time = 0,
    migrateDist = 0,
    migrateSpeed = 0,
    // Precomputed animated centres, one per anchor. They depend only on `time`,
    // so a per-frame caller should compute them ONCE and pass them in rather
    // than having every sample redo the same noise walks.
    centres = null,
  } = options;

  // Warp once, then measure every anchor from the warped point, so all the blobs
  // distort consistently and their overlaps stay coherent.
  const w = warpPoint(x, z, warpAmount, warpFrequency, seed);

  let sum = 0;
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    const c = centres ? centres[i] : animatedCentre(anchor, time, migrateDist, migrateSpeed);
    const falloff = anchorFalloff(anchor, w.x, w.z, c.x, c.z);
    if (falloff > 0) sum += anchor.weight * falloff;
  }
  if (sum <= 0) return 0;

  // Checked after the sum so the BVH cost is only paid where there is density.
  if (hosts?.length && clearMargin > 0) {
    const d = nearestHostDistance(hosts, x, z);
    if (d !== null && d < clearMargin) return 0;
  }

  let field = Math.min(1, sum / Math.max(mergeNorm, 1e-3));

  // Gaps use the UNWARPED position: the clearings should be a property of the
  // ground, not of whichever anchor happens to reach there.
  field *= presenceMask(x, z, gapAmount, gapFrequency, seed);
  if (field <= 0) return 0;

  if (edgeNoiseAmount > 0) {
    const n = valueNoise3D(w.x * edgeNoiseFrequency, 0.37, w.z * edgeNoiseFrequency, seed);
    // Multiplicative so the noise cannot manufacture density out on bare ground —
    // it only ragged-edges what the anchors already put there.
    field *= 1 + n * edgeNoiseAmount;
  }
  return Math.min(1, Math.max(0, field));
}
