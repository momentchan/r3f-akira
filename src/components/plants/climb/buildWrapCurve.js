import * as THREE from 'three';
import { seededRng } from '../stem/buildStemTube';
import {
  allocateCapsuleCounts,
  capsuleFromBox,
} from './limbCapsules';

const _hit = {};
const _closest = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _radial = new THREE.Vector3();
const _right = new THREE.Vector3();
const _binorm = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _bodyRight = new THREE.Vector3(1, 0, 0);
const _tmp = new THREE.Vector3();

function snapToSurface(bvh, point, clearGap) {
  if (!bvh) return false;
  const res = bvh.closestPointToPoint(point, _hit, 0, Infinity);
  if (!res?.point) return false;
  _closest.copy(res.point);
  _radial.subVectors(point, _closest);
  if (_radial.lengthSq() < 1e-10) _radial.copy(_bodyRight);
  else _radial.normalize();
  point.copy(_closest).addScaledVector(_radial, clearGap);
  return true;
}

function capsuleBasis(axis, right, binorm) {
  const ref = Math.abs(axis.y) < 0.9 ? _up : new THREE.Vector3(1, 0, 0);
  right.crossVectors(axis, ref);
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  else right.normalize();
  binorm.crossVectors(right, axis).normalize();
}

function shortestDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Shell point on capsule. `u` along bone a→b; `angle` in capsule radial frame.
 */
function pointOnCapsule(capsule, u, angle, out) {
  _axis.subVectors(capsule.b, capsule.a);
  const len = Math.max(_axis.length(), 1e-4);
  _axis.multiplyScalar(1 / len);
  capsuleBasis(_axis, _right, _binorm);
  const r = capsule.radius * 1.06;
  out.copy(capsule.a)
    .addScaledVector(_axis, THREE.MathUtils.clamp(u, 0, 1) * len)
    .addScaledVector(_right, Math.cos(angle) * r)
    .addScaledVector(_binorm, Math.sin(angle) * r);
  return {
    axis: _axis.clone(),
    right: _right.clone(),
    binorm: _binorm.clone(),
    len,
  };
}

/** Angles in radial frame: ground underside, character-right, character-left. */
function capsuleAngles(capsule, bodyRight) {
  _axis.subVectors(capsule.b, capsule.a);
  const len = Math.max(_axis.length(), 1e-4);
  _axis.multiplyScalar(1 / len);
  capsuleBasis(_axis, _right, _binorm);

  const proj = (dir) => {
    _tmp.copy(dir).addScaledVector(_axis, -dir.dot(_axis));
    if (_tmp.lengthSq() < 1e-8) return null;
    _tmp.normalize();
    return Math.atan2(_tmp.dot(_binorm), _tmp.dot(_right));
  };

  const groundAng = proj(_down) ?? 0;
  const rightAng = proj(bodyRight) ?? 0;
  const leftAng = rightAng + Math.PI;
  return { groundAng, rightAng, leftAng, len };
}

/**
 * One tendril owns one `u` slot along the bone (spreads roots).
 * Starts on the ground-facing side (biased right), wraps toward character-left.
 */
export function buildCapsuleWrapCurve({
  capsule,
  bvh,
  bodyRight = new THREE.Vector3(1, 0, 0),
  groundY = 0,
  seed,
  sampleCount = 14,
  turns = 0.55,
  clearGap = 0.007,
  peelAt = 0.9,
  index = 0,
  total = 1,
}) {
  const rng = seededRng(seed);
  const points = [];
  const count = Math.max(6, Math.floor(sampleCount));
  _bodyRight.copy(bodyRight);

  const n = Math.max(total, 1);
  // CRITICAL: each tendril gets its own station along the full limb — no shared tip.
  const u = THREE.MathUtils.clamp((index + 0.5) / n, 0.04, 0.96);

  const { groundAng, rightAng, leftAng } = capsuleAngles(capsule, _bodyRight);
  // Start = underside, pulled a bit toward character-right.
  const towardRight = shortestDelta(groundAng, rightAng);
  const angleStart = groundAng + towardRight * 0.4 + (rng() - 0.5) * 0.08;
  // Travel toward character-left (at least ~half turn around the cylinder).
  let travel = shortestDelta(angleStart, leftAng);
  const minTravel = -Math.PI * Math.max(turns, 0.35);
  // Prefer wrapping the short-or-long way that goes "over" away from ground:
  // if travel is very small, push a full leftward arc.
  if (Math.abs(travel) < 0.6) {
    travel = travel <= 0 ? minTravel : -minTravel;
  } else if (travel > 0) {
    // Force leftward (negative in our convention when left = right+π via shortest path flip)
    travel = travel - Math.PI * 2;
  }
  // Extra wrap from turns knob.
  travel -= Math.max(turns - 0.35, 0) * Math.PI;

  const shell = new THREE.Vector3();
  let climbDir = new THREE.Vector3(0, 1, 0);
  let outward0 = null;
  let orbit0 = null;
  let hitch = null;
  let hitchPre = null;
  let peelStartIndex = -1;

  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const peel = t >= peelAt;
    if (peel && peelStartIndex < 0) peelStartIndex = points.length;

    const angle = peel
      ? angleStart + travel * peelAt
      : angleStart + travel * t;
    // Slight climb along bone while wrapping so it doesn't look like a flat ring.
    const uLive = THREE.MathUtils.clamp(u + t * 0.08, 0.02, 0.98);

    const info = pointOnCapsule(capsule, uLive, angle, shell);
    climbDir.copy(info.axis);

    if (i === 0) {
      hitchPre = shell.clone();
      hitchPre.y = groundY;
      points.push(hitchPre.clone());
    }

    const pos = shell.clone();
    if (!peel) {
      snapToSurface(bvh, pos, clearGap);
    } else {
      pos.addScaledVector(_bodyRight, -capsule.radius * (0.35 + (t - peelAt) * 1.8));
      pos.y += (t - peelAt) * capsule.radius * 1.2;
    }

    if (i === 0) {
      hitch = pos.clone();
      outward0 = pos.clone().sub(
        _tmp.copy(capsule.a).addScaledVector(info.axis, uLive * info.len),
      );
      if (outward0.lengthSq() > 1e-8) outward0.normalize();
      else outward0 = _bodyRight.clone();
      orbit0 = new THREE.Vector3().crossVectors(climbDir, outward0);
      if (orbit0.lengthSq() > 1e-8) orbit0.normalize();
      else orbit0 = info.binorm.clone();
    }

    points.push(pos.clone());
  }

  if (points.length < 4) return null;

  return {
    curve: new THREE.CatmullRomCurve3(points, false, 'centripetal'),
    debug: {
      index,
      hitchPre,
      hitch,
      points,
      climbDir: climbDir.clone(),
      outward: outward0,
      orbit: orbit0,
      bodyRight: _bodyRight.clone(),
      chirality: -1,
      peelStartIndex,
      capsuleId: capsule.id,
    },
  };
}

/**
 * Build wrap curves: one root station per slot along each limb capsule.
 */
export function buildWrapCurves({
  hosts,
  count = 22,
  bodyRatio = 0.65,
  seed = 0,
  sampleCount = 14,
  stepLength = 0.045,
  turns = 0.55,
  climbBias = 0.55,
  clearGap = 0.007,
  peelAt = 0.9,
  capsuleRadiusScale = 1,
}) {
  void stepLength;
  void climbBias;

  const out = [];
  const bodyHost = hosts.find((h) => h.id === 'body');
  const packHost = hosts.find((h) => h.id === 'backpack');
  const bodyRight = bodyHost?.bodyRight?.clone?.()
    ?? new THREE.Vector3(1, 0, 0);

  const bodyCount = bodyHost
    ? Math.round(count * THREE.MathUtils.clamp(bodyRatio, 0, 1))
    : 0;
  const packCount = count - bodyCount;

  const spawnOnCapsules = (host, capsules, n, typeOffset) => {
    if (!host?.bvh || !capsules?.length || n < 1) return 0;
    const groundY = 0;
    const scaled = capsules.map((c) => ({
      ...c,
      radius: c.radius * capsuleRadiusScale,
    }));
    const buckets = allocateCapsuleCounts(scaled, n);
    let spawned = 0;
    let localIndex = 0;
    for (const { capsule, count: cCount } of buckets) {
      for (let i = 0; i < cCount; i += 1) {
        const tendrilSeed = seed * 97 + typeOffset * 131 + localIndex * 17 + 3;
        const built = buildCapsuleWrapCurve({
          capsule,
          bvh: host.bvh,
          bodyRight: host.bodyRight ?? bodyRight,
          groundY,
          seed: tendrilSeed,
          index: i,
          total: cCount,
          sampleCount,
          turns,
          clearGap,
          peelAt,
        });
        localIndex += 1;
        if (!built) continue;
        out.push({
          seed: tendrilSeed,
          hostId: host.id,
          capsuleId: capsule.id,
          curve: built.curve,
          debug: built.debug,
        });
        spawned += 1;
      }
    }
    return spawned;
  };

  if (bodyHost && bodyCount > 0) {
    const caps = bodyHost.capsules?.length
      ? bodyHost.capsules
      : (() => {
        const c = capsuleFromBox(bodyHost.localBox, 'body-hull', capsuleRadiusScale);
        return c ? [c] : [];
      })();
    spawnOnCapsules(bodyHost, caps, bodyCount, 0);
  }

  if (packHost && packCount > 0) {
    const packCaps = packHost.capsules?.length
      ? packHost.capsules
      : (() => {
        const c = capsuleFromBox(packHost.localBox, 'backpack', capsuleRadiusScale);
        return c ? [c] : [];
      })();
    spawnOnCapsules(
      { ...packHost, bodyRight },
      packCaps,
      packCount,
      1,
    );
  }

  return out;
}
