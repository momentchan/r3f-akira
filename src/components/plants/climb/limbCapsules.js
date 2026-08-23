import * as THREE from 'three';

/**
 * Auto-Rig Pro wrap regions.
 * `a -> b` is always the intended anatomical growth direction.
 * Bone candidates are ordered by preference (first match wins).
 */
export const LIMB_CAPSULE_DEFS = [
  // Torso is nearly horizontal in Lay — heavy weight made every stem pile at the armpit.
  {
    id: 'torso',
    a: ['spine_01.x', 'c_spine_01.x', 'c_p_spine_01.x', 'spine_01'],
    b: ['spine_03.x', 'c_spine_03.x', 'spine_03', 'c_neck.x', 'c_neck.x', 'neck.x'],
    radius: 0.14,
    weight: 0.25,
  },
  {
    id: 'thigh.l',
    a: ['leg.l', 'leg_stretch.l', 'c_leg_fk.l', 'leg_fk.l', 'c_stretch_leg.l'],
    b: ['thigh.l', 'thigh_stretch.l', 'c_thigh_fk.l', 'thigh_fk.l'],
    radius: 0.085,
    weight: 1.2,
  },
  {
    id: 'calf.l',
    a: ['foot.l', 'foot_fk.l', 'c_foot_fk.l', 'c_p_foot_fk.l', 'c_foot_01.l'],
    b: ['leg.l', 'leg_stretch.l', 'c_leg_fk.l', 'leg_fk.l'],
    radius: 0.065,
    weight: 1.1,
  },
  {
    id: 'thigh.r',
    a: ['leg.r', 'leg_stretch.r', 'c_leg_fk.r', 'leg_fk.r', 'c_stretch_leg.r'],
    b: ['thigh.r', 'thigh_stretch.r', 'c_thigh_fk.r', 'thigh_fk.r'],
    radius: 0.085,
    weight: 1.4,
  },
  {
    id: 'calf.r',
    a: ['foot.r', 'foot_fk.r', 'c_foot_fk.r', 'c_p_foot_fk.r', 'c_foot_01.r'],
    b: ['leg.r', 'leg_stretch.r', 'c_leg_fk.r', 'leg_fk.r'],
    radius: 0.065,
    weight: 1.3,
  },
  {
    id: 'upperarm.l',
    a: ['forearm.l', 'forearm_stretch.l', 'c_forearm_fk.l', 'forearm_fk.l'],
    b: ['arm.l', 'arm_stretch.l', 'c_arm_fk.l', 'arm_fk.l', 'c_stretch_arm.l'],
    radius: 0.055,
    weight: 0.9,
  },
  {
    id: 'forearm.l',
    a: ['hand.l', 'hand_fk.l', 'c_hand_fk.l', 'c_p_hand_fk.l'],
    b: ['forearm.l', 'forearm_stretch.l', 'c_forearm_fk.l', 'forearm_fk.l'],
    radius: 0.045,
    weight: 0.85,
  },
  {
    id: 'upperarm.r',
    a: ['forearm.r', 'forearm_stretch.r', 'c_forearm_fk.r', 'forearm_fk.r'],
    b: ['arm.r', 'arm_stretch.r', 'c_arm_fk.r', 'arm_fk.r', 'c_stretch_arm.r'],
    radius: 0.055,
    weight: 1.0,
  },
  {
    id: 'forearm.r',
    a: ['hand.r', 'hand_fk.r', 'c_hand_fk.r', 'c_p_hand_fk.r'],
    b: ['forearm.r', 'forearm_stretch.r', 'c_forearm_fk.r', 'forearm_fk.r'],
    radius: 0.045,
    weight: 0.95,
  },
];

const _world = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _helmetVertex = new THREE.Vector3();
const HELMET_MESH_NAME = 'Helmet_Mesh';

/**
 * @typedef {{ id: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, weight: number, length: number }} LimbCapsule
 */

function normalizeBoneName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    // GLTFLoader sanitizes animation node names (`foot.r` -> `foot_r`).
    // Compare a separator-free key so raw GLB names and runtime names agree.
    .replace(/[._]\d{3}$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function registerBone(map, bone) {
  if (!bone?.isBone || !bone.name) return;
  const key = normalizeBoneName(bone.name);
  if (key && !map.has(key)) map.set(key, bone);
}

export function collectBoneMap(root) {
  /** @type {Map<string, THREE.Bone>} */
  const map = new Map();
  const skeletons = new Set();

  // Skeleton bones are authoritative after SkeletonUtils.clone().
  root.traverse((obj) => {
    if (obj.isSkinnedMesh && obj.skeleton) skeletons.add(obj.skeleton);
  });
  for (const sk of skeletons) {
    sk.update();
    for (const bone of sk.bones) registerBone(map, bone);
  }

  // Fallback for rigs whose bones are attached but absent from a mesh skeleton.
  root.traverse((obj) => registerBone(map, obj));
  return map;
}

export function findBone(map, candidates) {
  for (const name of candidates) {
    const b = map.get(normalizeBoneName(name));
    if (b) return b;
  }
  return null;
}

function boneLocalPoint(bone, parent, target) {
  bone.getWorldPosition(_world);
  parent.worldToLocal(_world);
  return target.copy(_world);
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const index = THREE.MathUtils.clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return THREE.MathUtils.lerp(sorted[lo], sorted[hi], index - lo);
}

function findNamedMesh(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (found || !obj.isMesh || !obj.visible) return;
    if (obj.name === name) found = obj;
  });
  return found;
}

function makeCapsule(id, a, b, radius, weight, extras = {}) {
  return {
    id,
    a,
    b,
    radius,
    weight,
    length: a.distanceTo(b),
    uMin: 0.02,
    uMax: 0.98,
    ...extras,
  };
}

/**
 * Helmet + neck guides from Helmet_Mesh, along c_neck.x → c_head.x.
 * Bones give direction; posed verts place the tube on the shell.
 */
function extractHelmetCapsule(root, parent, boneMap, radiusScale) {
  const neck = findBone(boneMap, ['c_neck.x']);
  const head = findBone(boneMap, ['c_head.x']);
  const mesh = findNamedMesh(root, HELMET_MESH_NAME);
  const position = mesh?.geometry?.getAttribute?.('position');
  if (!neck || !head || !position || position.count < 3) return null;

  neck.updateWorldMatrix(true, false);
  head.updateWorldMatrix(true, false);
  const axis = boneLocalPoint(head, parent, new THREE.Vector3())
    .sub(boneLocalPoint(neck, parent, new THREE.Vector3()));
  if (axis.lengthSq() < 1e-8) return null;
  axis.normalize();

  const points = [];
  const step = Math.max(1, Math.floor(position.count / 1024));
  for (let i = 0; i < position.count; i += step) {
    if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, _helmetVertex);
    else _helmetVertex.fromBufferAttribute(position, i);
    _helmetVertex.applyMatrix4(mesh.matrixWorld);
    parent.worldToLocal(_helmetVertex);
    points.push(_helmetVertex.clone());
  }
  if (points.length < 8) return null;

  const center = new THREE.Vector3();
  for (const point of points) center.add(point);
  center.multiplyScalar(1 / points.length);

  const axial = points.map((point) => point.clone().sub(center).dot(axis)).sort((a, b) => a - b);
  const axialMin = quantile(axial, 0.04);
  const axialMax = quantile(axial, 0.96);
  if (axialMax - axialMin <= 1e-4) return null;

  const a = center.clone().addScaledVector(axis, axialMin);
  const b = center.clone().addScaledVector(axis, axialMax);
  const radial = points.map((point) => {
    const along = point.clone().sub(a).dot(axis);
    return point.distanceTo(a.clone().addScaledVector(axis, along));
  }).sort((left, right) => left - right);
  const radius = Math.max(quantile(radial, 0.82), 0.08) * radiusScale;

  const helmet = makeCapsule('helmet', a, b, radius, 0.65, {
    coverageRadiusScale: 1.45,
    radiusExpansionLimit: 1.25,
    wrapAngleScale: 0.2,
  });
  const neckLength = THREE.MathUtils.clamp(helmet.length * 0.42, 0.14, 0.3);
  const neckA = a.clone().addScaledVector(axis, -neckLength);
  const neckB = a.clone().addScaledVector(axis, neckLength * 0.16);
  const neckCapsule = makeCapsule(
    'neck',
    neckA,
    neckB,
    THREE.MathUtils.clamp(radius * 0.55, 0.09, 0.24),
    0.35,
    { coverageRadiusScale: 1.7, radiusExpansionLimit: 1.35, wrapAngleScale: 0.3 },
  );

  return { helmet, neckCapsule };
}

/**
 * Bake posed limb capsules in field-parent local space.
 * @returns {LimbCapsule[]}
 */
export function extractLimbCapsules(root, parent, {
  radiusScale = 1,
  defs = LIMB_CAPSULE_DEFS,
} = {}) {
  root.updateWorldMatrix(true, true);
  parent.updateWorldMatrix(true, false);

  const map = collectBoneMap(root);
  const out = [];

  for (const def of defs) {
    const boneA = findBone(map, def.a);
    const boneB = findBone(map, def.b);
    if (!boneA || !boneB) continue;

    boneA.updateWorldMatrix(true, false);
    boneB.updateWorldMatrix(true, false);

    const a = boneLocalPoint(boneA, parent, new THREE.Vector3());
    const b = boneLocalPoint(boneB, parent, new THREE.Vector3());
    if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) continue;
    const length = a.distanceTo(b);
    if (length < 1e-4) continue;

    out.push({
      id: def.id,
      a,
      b,
      radius: def.radius * radiusScale,
      weight: def.weight,
      length,
      ...(def.uMin == null ? {} : { uMin: def.uMin }),
      ...(def.uMax == null ? {} : { uMax: def.uMax }),
      ...(def.coverageRadiusScale == null
        ? {}
        : { coverageRadiusScale: def.coverageRadiusScale }),
      ...(def.radiusExpansionLimit == null
        ? {}
        : { radiusExpansionLimit: def.radiusExpansionLimit }),
    });
  }

  const helmet = extractHelmetCapsule(root, parent, map, radiusScale);
  if (helmet) out.push(helmet.neckCapsule, helmet.helmet);

  return out;
}

function stationRng(seed) {
  let state = ((seed + 1) * 2654435761) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Allocate one global tendril count proportionally by region length, then use
 * bounded-random gaps inside each region. This preserves coverage without the
 * mechanical look of identical spacing.
 * @returns {Array<{ capsule: LimbCapsule, ringIndex: number, ringsOnRegion: number, station: number }>}
 */
export function allocateRingStations(capsules, tendrilCount, {
  layoutSeed = 0,
  spacingVariation = 1,
  totalBudget = 512,
} = {}) {
  if (!capsules.length || tendrilCount < 1) return [];

  const target = Math.min(Math.max(Math.floor(tendrilCount), 1), totalBudget);
  const counts = new Array(capsules.length).fill(0);
  let remaining = target;

  // Reserve one tendril for every selected region whenever the budget allows it.
  if (target >= capsules.length) {
    counts.fill(1);
    remaining -= capsules.length;
  }

  const totalLength = capsules.reduce((sum, capsule) => sum + capsule.length, 0);
  const shares = capsules.map((capsule, index) => {
    const exact = totalLength > 1e-6
      ? (capsule.length / totalLength) * remaining
      : remaining / capsules.length;
    const whole = Math.floor(exact);
    counts[index] += whole;
    return { index, fraction: exact - whole, length: capsule.length };
  });
  let assigned = counts.reduce((sum, count) => sum + count, 0);
  shares.sort((a, b) => b.fraction - a.fraction || b.length - a.length);
  for (let i = 0; assigned < target; i += 1, assigned += 1) {
    counts[shares[i % shares.length].index] += 1;
  }

  const variation = THREE.MathUtils.clamp(spacingVariation, 0, 1);
  const out = [];
  for (let regionIndex = 0; regionIndex < capsules.length; regionIndex += 1) {
    const capsule = capsules[regionIndex];
    const ringsOnRegion = counts[regionIndex];
    if (ringsOnRegion < 1) continue;

    const rng = stationRng(layoutSeed * 977 + regionIndex * 131 + 17);
    const gaps = new Array(ringsOnRegion + 1);
    let gapTotal = 0;
    for (let i = 0; i < gaps.length; i += 1) {
      const randomGap = THREE.MathUtils.lerp(0.18, 1.82, rng());
      gaps[i] = THREE.MathUtils.lerp(1, randomGap, variation);
      gapTotal += gaps[i];
    }

    let cursor = 0;
    for (let i = 0; i < ringsOnRegion; i += 1) {
      cursor += gaps[i];
      out.push({
        capsule,
        ringIndex: i,
        ringsOnRegion,
        station: THREE.MathUtils.clamp(cursor / gapTotal, 0.02, 0.98),
      });
    }
  }
  return out;
}

/**
 * Character-facing right in `parent` local space (posed thigh.r − thigh.l).
 * @returns {THREE.Vector3}
 */
export function extractBodyRight(root, parent) {
  const map = collectBoneMap(root);
  const rThigh = findBone(map, ['thigh.r', 'c_thigh_fk.r', 'thigh_stretch.r']);
  const lThigh = findBone(map, ['thigh.l', 'c_thigh_fk.l', 'thigh_stretch.l']);
  const right = new THREE.Vector3(1, 0, 0);
  if (!rThigh || !lThigh) return right;

  const r = boneLocalPoint(rThigh, parent, new THREE.Vector3());
  const l = boneLocalPoint(lThigh, parent, new THREE.Vector3());
  right.subVectors(r, l);
  right.y *= 0.2;
  if (right.lengthSq() < 1e-8) return right.set(1, 0, 0);
  return right.normalize();
}

/** Closest point + radial outward on a capsule segment. */
export function capsuleFrame(capsule, point, target = {}) {
  const axis = _tmp.subVectors(capsule.b, capsule.a);
  const len = axis.length();
  if (len < 1e-8) {
    target.axis = new THREE.Vector3(0, 1, 0);
    target.center = capsule.a.clone();
    target.outward = new THREE.Vector3(1, 0, 0);
    target.t = 0;
    return target;
  }
  axis.multiplyScalar(1 / len);
  const ap = point.clone().sub(capsule.a);
  const t = THREE.MathUtils.clamp(ap.dot(axis), 0, len);
  const center = capsule.a.clone().addScaledVector(axis, t);
  const outward = point.clone().sub(center);
  if (outward.lengthSq() < 1e-10) {
    const ref = Math.abs(axis.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    outward.crossVectors(axis, ref).normalize();
  } else {
    outward.normalize();
  }
  target.axis = axis.clone();
  target.center = center;
  target.outward = outward;
  target.t = len > 1e-8 ? t / len : 0;
  return target;
}
