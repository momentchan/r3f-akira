import * as THREE from 'three';

/**
 * Auto-Rig Pro wrap regions.
 * `a -> b` is always the intended growth direction: distal/lower -> torso/upper.
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

function collectBoneMap(root) {
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

function findBone(map, candidates) {
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

/**
 * Bake posed limb capsules in field-parent local space and explain every miss.
 * @returns {{ capsules: LimbCapsule[], diagnostics: {
 *   expected: number,
 *   found: number,
 *   boneCount: number,
 *   validIds: string[],
 *   issues: Array<{ id: string, reason: string, missing?: string[] }>
 * } }}
 */
export function extractLimbCapsulesWithDiagnostics(root, parent, {
  radiusScale = 1,
  defs = LIMB_CAPSULE_DEFS,
} = {}) {
  root.updateWorldMatrix(true, true);
  parent.updateWorldMatrix(true, false);

  const map = collectBoneMap(root);
  const out = [];
  const issues = [];

  for (const def of defs) {
    const boneA = findBone(map, def.a);
    const boneB = findBone(map, def.b);
    if (!boneA || !boneB) {
      const missing = [];
      if (!boneA) missing.push('growth-start');
      if (!boneB) missing.push('growth-end');
      issues.push({ id: def.id, reason: 'missing-bone', missing });
      continue;
    }

    boneA.updateWorldMatrix(true, false);
    boneB.updateWorldMatrix(true, false);

    const a = boneLocalPoint(boneA, parent, new THREE.Vector3());
    const b = boneLocalPoint(boneB, parent, new THREE.Vector3());
    if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) {
      issues.push({ id: def.id, reason: 'invalid-position' });
      continue;
    }
    const length = a.distanceTo(b);
    if (length < 1e-4) {
      issues.push({ id: def.id, reason: 'zero-length' });
      continue;
    }

    out.push({
      id: def.id,
      a,
      b,
      radius: def.radius * radiusScale,
      weight: def.weight,
      length,
    });
  }

  return {
    capsules: out,
    diagnostics: {
      expected: defs.length,
      found: out.length,
      boneCount: map.size,
      validIds: out.map((capsule) => capsule.id),
      issues,
    },
  };
}

/** Backward-compatible capsule-only accessor. */
export function extractLimbCapsules(root, parent, options) {
  return extractLimbCapsulesWithDiagnostics(root, parent, options).capsules;
}

/**
 * Ordered ring stations per directed body region.
 * @returns {Array<{ capsule: LimbCapsule, ringIndex: number, ringsOnRegion: number, station: number }>}
 */
export function allocateRingStations(capsules, ringSpacing, {
  maxRingsPerRegion = 8,
  totalBudget = 512,
} = {}) {
  if (!capsules.length || ringSpacing < 1e-4) return [];

  const raw = [];
  for (const capsule of capsules) {
    const ringsOnRegion = THREE.MathUtils.clamp(
      Math.floor(capsule.length / ringSpacing),
      1,
      maxRingsPerRegion,
    );
    for (let i = 0; i < ringsOnRegion; i += 1) {
      raw.push({
        capsule,
        ringIndex: i,
        ringsOnRegion,
        station: THREE.MathUtils.clamp((i + 0.5) / ringsOnRegion, 0.04, 0.96),
      });
    }
  }

  if (raw.length <= totalBudget) return raw;

  const out = [];
  const step = raw.length / totalBudget;
  for (let i = 0; i < totalBudget; i += 1) {
    out.push(raw[Math.min(Math.floor(i * step), raw.length - 1)]);
  }
  return out;
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

  // Prefer lateral separation; damp vertical so right reads side-to-side.
  right.y *= 0.2;
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
