import * as THREE from 'three';

/**
 * Auto-Rig Pro deform bones: legs + torso (first pass).
 * a/b are bone name candidates (first match wins).
 */
export const LIMB_CAPSULE_DEFS = [
  // Torso is nearly horizontal in Lay — heavy weight made every stem pile at the armpit.
  {
    id: 'torso',
    a: ['spine_01.x', 'c_spine_01.x', 'spine_01'],
    b: ['spine_03.x', 'c_spine_03.x', 'spine_03', 'c_neck.x', 'neck.x'],
    radius: 0.14,
    weight: 0.25,
  },
  {
    id: 'thigh.l',
    a: ['thigh.l', 'thigh_stretch.l', 'c_thigh_fk.l'],
    b: ['leg.l', 'leg_stretch.l', 'c_leg_fk.l'],
    radius: 0.085,
    weight: 1.2,
  },
  {
    id: 'calf.l',
    a: ['leg.l', 'leg_stretch.l', 'c_leg_fk.l'],
    b: ['foot.l', 'foot_fk.l', 'c_foot_fk.l', 'c_foot_01.l'],
    radius: 0.065,
    weight: 1.1,
  },
  {
    id: 'thigh.r',
    a: ['thigh.r', 'thigh_stretch.r', 'c_thigh_fk.r'],
    b: ['leg.r', 'leg_stretch.r', 'c_leg_fk.r'],
    radius: 0.085,
    weight: 1.4,
  },
  {
    id: 'calf.r',
    a: ['leg.r', 'leg_stretch.r', 'c_leg_fk.r'],
    b: ['foot.r', 'foot_fk.r', 'c_foot_fk.r', 'c_foot_01.r'],
    radius: 0.065,
    weight: 1.3,
  },
];

const _world = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * @typedef {{ id: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, weight: number, length: number }} LimbCapsule
 */

function collectBoneMap(root) {
  /** @type {Map<string, THREE.Bone>} */
  const map = new Map();
  const skeletons = new Set();

  root.traverse((obj) => {
    if (obj.isBone && obj.name) map.set(obj.name, obj);
    if (obj.isSkinnedMesh && obj.skeleton) skeletons.add(obj.skeleton);
  });
  for (const sk of skeletons) {
    sk.update();
    for (const bone of sk.bones) {
      if (bone?.name && !map.has(bone.name)) map.set(bone.name, bone);
    }
  }
  return map;
}

function findBone(map, candidates) {
  for (const name of candidates) {
    const b = map.get(name);
    if (b) return b;
  }
  // Case-insensitive fallback.
  const lower = new Map([...map.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of candidates) {
    const b = lower.get(name.toLowerCase());
    if (b) return b;
  }
  return null;
}

function boneLocalPoint(bone, parent, target) {
  bone.getWorldPosition(_world);
  parent.worldToLocal(_world);
  return target.copy(_world);
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

    const a = boneLocalPoint(boneA, parent, new THREE.Vector3());
    const b = boneLocalPoint(boneB, parent, new THREE.Vector3());
    const length = a.distanceTo(b);
    if (length < 1e-4) continue;

    out.push({
      id: def.id,
      a,
      b,
      radius: def.radius * radiusScale,
      weight: def.weight,
      length,
    });
  }

  return out;
}

/**
 * Approximate a prop AABB as one capsule along its longest axis (backpack).
 * @returns {LimbCapsule | null}
 */
export function capsuleFromBox(localBox, id = 'box', radiusScale = 1) {
  if (!localBox || localBox.isEmpty()) return null;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  localBox.getCenter(center);
  localBox.getSize(size);

  const dims = [
    { axis: 0, len: size.x },
    { axis: 1, len: size.y },
    { axis: 2, len: size.z },
  ].sort((x, y) => y.len - x.len);

  const major = dims[0];
  const mid = dims[1];
  const minor = dims[2];
  const half = major.len * 0.42;
  const a = center.clone();
  const b = center.clone();
  a.setComponent(major.axis, center.getComponent(major.axis) - half);
  b.setComponent(major.axis, center.getComponent(major.axis) + half);

  const radius = Math.max(0.04, 0.45 * 0.5 * (mid.len + minor.len)) * radiusScale;
  return {
    id,
    a,
    b,
    radius,
    weight: 1,
    length: a.distanceTo(b),
  };
}

/**
 * Allocate tendril counts across capsules by weight × length.
 * @returns {Array<{ capsule: LimbCapsule, count: number }>}
 */
export function allocateCapsuleCounts(capsules, total) {
  if (!capsules.length || total < 1) return [];
  const scores = capsules.map((c) => Math.max(c.length, 0.05) * (c.weight || 1));
  const sum = scores.reduce((s, v) => s + v, 0);
  const raw = scores.map((s) => (s / sum) * total);
  const floors = raw.map((v) => Math.floor(v));
  let used = floors.reduce((s, v) => s + v, 0);
  const frac = raw.map((v, i) => ({ i, f: v - floors[i] }))
    .sort((a, b) => b.f - a.f);
  const counts = floors.slice();
  let k = 0;
  while (used < total && k < frac.length * 4) {
    counts[frac[k % frac.length].i] += 1;
    used += 1;
    k += 1;
  }
  return capsules.map((capsule, i) => ({ capsule, count: counts[i] }))
    .filter((e) => e.count > 0);
}

/**
 * Character-facing right / up in `parent` local space (from posed left/right bones).
 * @returns {{ right: THREE.Vector3, up: THREE.Vector3 }}
 */
export function extractBodyAxes(root, parent) {
  root.updateWorldMatrix(true, true);
  parent.updateWorldMatrix(true, false);
  const map = collectBoneMap(root);
  const pick = (names) => findBone(map, names);

  const rightPt = new THREE.Vector3();
  const leftPt = new THREE.Vector3();
  const rThigh = pick(['thigh.r', 'c_thigh_fk.r', 'thigh_stretch.r']);
  const lThigh = pick(['thigh.l', 'c_thigh_fk.l', 'thigh_stretch.l']);
  const rShoulder = pick(['shoulder.r', 'c_shoulder.r', 'arm.r']);
  const lShoulder = pick(['shoulder.l', 'c_shoulder.l', 'arm.l']);

  const right = new THREE.Vector3();
  if (rThigh && lThigh) {
    boneLocalPoint(rThigh, parent, rightPt);
    boneLocalPoint(lThigh, parent, leftPt);
    right.subVectors(rightPt, leftPt);
  } else if (rShoulder && lShoulder) {
    boneLocalPoint(rShoulder, parent, rightPt);
    boneLocalPoint(lShoulder, parent, leftPt);
    right.subVectors(rightPt, leftPt);
  }

  if (right.lengthSq() < 1e-6) {
    const rootBone = pick(['c_root.x', 'root.x', 'c_root_master.x']);
    if (rootBone) {
      rootBone.updateWorldMatrix(true, false);
      const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      right.set(1, 0, 0).transformDirection(rootBone.matrixWorld).transformDirection(inv);
    } else {
      right.set(1, 0, 0);
    }
  }

  // Keep lateral in the ground plane so "right→left" reads clearly in Lay.
  right.y *= 0.15;
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();

  return { right, up: new THREE.Vector3(0, 1, 0) };
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

