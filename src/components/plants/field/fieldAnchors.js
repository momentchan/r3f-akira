import { closestDistanceAtXZ, columnHitsHosts } from './bodyBounds';
import { valueNoise3D } from '../climb/spatialNoise';

/**
 * Density pins for the flower field — not flower positions.
 *
 * An anchor raises the chance of plants nearby. Clusters may drift off it,
 * neighbouring fields merge, and bare ground can sit between them.
 * Planting *on* the pins is what makes the layout look arranged.
 */

/** Skip a capsule endpoint above this Y — it is not on the ground. */
const GROUND_BAND_MAX = 0.55;
/** World-unit distance over which density ramps up from the pin. */
const CONTACT_RISE = 0.1;

export const ANCHOR_COLORS = ['#ff9f1c', '#2ec4b6', '#3a86ff', '#c77dff'];

/**
 * Four pins, not one per contact. Covering every limb outlines the silhouette.
 *
 * `id` is the host: a LIMB_CAPSULE_DEFS capsule, or `backpack`.
 * The pin sits at capsule `a` (hand / hip / foot).
 */
export const LAY_ANCHOR_DEFS = [
  {
    id: 'torso',
    weight: 1.2,
    reach: 1.9,   // wide enough to meet the backpack without becoming a ring
    elong: 1.35,  // stretch along the body, not a puck at the hip
  },
  {
    // Left forearm, not right: the right hand sits on the backpack side, so a
    // right-hand pin would stack on the heavy side and leave the far side empty.
    id: 'forearm.l',
    weight: 0.85,
    reach: 0.8,
    elong: 1.5,
  },
  {
    // Ground under the legs — the region three pins left bare.
    id: 'calf.l',
    weight: 0.8,
    reach: 0.85,
    elong: 1.6,
  },
  {
    id: 'backpack',
    weight: 1.3,  // 0.9 was too thin to read as its own source
    reach: 1.2,   // sized to the bag; 1.55 bled into the torso
    elong: 1.15,
  },
];

function smoothstep01(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Capsule direction in XZ. Near-vertical capsules use `fallback`. */
function axisXZ(capsule, fallback) {
  const ax = capsule.b.x - capsule.a.x;
  const az = capsule.b.z - capsule.a.z;
  const len = Math.hypot(ax, az);
  if (len < 1e-4) return fallback;
  return { ax: ax / len, az: az / len };
}

/** Closest surface distance at (x, z) across hosts, or null. */
function nearestHostDistance(hosts, x, z) {
  let best = null;
  for (let i = 0; i < hosts.length; i += 1) {
    const hit = closestDistanceAtXZ(hosts[i].bvh, x, z, hosts[i].localBox);
    if (hit && (best === null || hit.distance < best)) best = hit.distance;
  }
  return best;
}

function backpackSource(localBox) {
  if (!localBox || localBox.isEmpty()) return null;
  const halfX = (localBox.max.x - localBox.min.x) * 0.5;
  const halfZ = (localBox.max.z - localBox.min.z) * 0.5;
  return {
    x: (localBox.min.x + localBox.max.x) * 0.5,
    z: (localBox.min.z + localBox.max.z) * 0.5,
    axis: halfX >= halfZ ? { ax: 1, az: 0 } : { ax: 0, az: 1 },
  };
}

/**
 * Map posed capsules / backpack box onto the four pins.
 * Flowers are placed later by sampling `sampleAnchorField`.
 */
export function deriveFieldAnchors({
  capsules = [],
  bodyRight = null,
  backpackBox = null,
  reachScale = 1,
  pinOverrides = null,
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
    const pin = pinOverrides?.[def.id] ?? {};
    const weight = pin.weight ?? def.weight;
    const reach = pin.reach ?? def.reach;
    const elong = pin.elong ?? def.elong;

    let src = null;
    if (def.id === 'backpack') {
      src = backpackSource(backpackBox);
      if (!src) { issues.push({ id: def.id, reason: 'missing-backpack' }); continue; }
    } else {
      const capsule = byId.get(def.id);
      if (!capsule) { issues.push({ id: def.id, reason: 'missing-capsule' }); continue; }
      const point = capsule.a;
      if (point.y > GROUND_BAND_MAX) {
        issues.push({ id: def.id, reason: 'airborne' });
        continue;
      }
      src = {
        x: point.x,
        z: point.z,
        axis: axisXZ(capsule, rightXZ),
      };
    }

    const index = anchors.length;
    anchors.push({
      id: def.id,
      index,
      x: src.x,
      z: src.z,
      weight,
      radius: reach * reachScale,
      inner: 0, // no hole at the pin; BVH keep-out is in sampleAnchorField
      axis: src.axis,
      elong,
      color: ANCHOR_COLORS[index % ANCHOR_COLORS.length],
    });
  }

  return {
    anchors,
    diagnostics: { found: anchors.length, expected: defs.length, issues },
  };
}

/** Shift the sample before measuring distance, so blobs deform instead of pulsing. */
function warpPoint(x, z, amount, frequency, seed) {
  if (amount <= 0) return { x, z };
  return {
    x: x + valueNoise3D(x * frequency, 3.7, z * frequency, seed) * amount,
    z: z + valueNoise3D(x * frequency, 8.1, z * frequency, seed + 977) * amount,
  };
}

/**
 * Bare patches shared across the whole field, not per pin.
 * Breaks closed rings, and the gaps read as one set of clearings.
 */
function presenceMask(x, z, amount, frequency, seed) {
  if (amount <= 0) return 1;
  const n = valueNoise3D(x * frequency, 21.4, z * frequency, seed + 5011) * 0.5 + 0.5;
  const cut = amount * 0.85; // higher amount → more bare ground
  return smoothstep01((n - cut) / 0.28);
}

/** One pin's falloff at (x, z), measured from (cx, cz). */
function anchorFalloff(anchor, x, z, cx, cz) {
  const dx = x - cx;
  const dz = z - cz;
  // Local frame, then un-stretch along the limb so the field is a lozenge.
  const along = dx * anchor.axis.ax + dz * anchor.axis.az;
  const across = -dx * anchor.axis.az + dz * anchor.axis.ax;
  const d = Math.hypot(along / Math.max(anchor.elong, 1e-3), across);
  if (d >= anchor.radius || d <= anchor.inner) return 0;

  // Peak near the pin, then fall to the outer reach.
  // Mesh interior is zeroed later, so this can hug the surface.
  const rise = smoothstep01((d - anchor.inner) / CONTACT_RISE);
  const t = (d - anchor.inner) / Math.max(anchor.radius - anchor.inner, 1e-3);
  const fall = 1 - smoothstep01(t);
  return rise * fall;
}

/**
 * Vegetation probability at (x, z), 0..1.
 *
 * Pins are summed then clamped, so neighbours merge into one mass.
 * If you can count the clusters and get four, the system is too visible.
 */
export function sampleAnchorField(x, z, anchors, options = {}) {
  const {
    mergeNorm = 1.15,
    shapeWarp = 0.3,
    warpScale = 1.6,
    barePatches = 0.4,
    patchScale = 1.1,
    seed = 0,
    hosts = null,
    meshClearDistance = 0,
  } = options;

  const w = warpPoint(x, z, shapeWarp, warpScale, seed);

  let sum = 0;
  for (let i = 0; i < anchors.length; i += 1) {
    const falloff = anchorFalloff(anchors[i], w.x, w.z, anchors[i].x, anchors[i].z);
    if (falloff > 0) sum += anchors[i].weight * falloff;
  }
  if (sum <= 0) return 0;

  // BVH only where density exists. Column test first: unsigned closest-point
  // is large *inside* a thick torso, so it cannot be the inside test.
  if (hosts?.length) {
    if (columnHitsHosts(hosts, x, z)) return 0;
    if (meshClearDistance > 0) {
      const d = nearestHostDistance(hosts, x, z);
      if (d !== null && d < meshClearDistance) return 0;
    }
  }

  let field = Math.min(1, sum / Math.max(mergeNorm, 1e-3));

  // Gaps use the unwarped point so clearings belong to the ground, not a pin.
  field *= presenceMask(x, z, barePatches, patchScale, seed);
  if (field <= 0) return 0;

  return Math.min(1, Math.max(0, field));
}
