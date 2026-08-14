import * as THREE from 'three';
import { seededRng } from '../stem/buildStemTube.js';
import {
  allocateRingStations,
} from './limbCapsules.js';
import { distortCurveWithSpatialNoise } from './spatialNoise.js';

const _hit = {};
const _closest = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _radial = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDirection = new THREE.Vector3();
const _ray = new THREE.Ray();
const _right = new THREE.Vector3();
const _binorm = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _bodyRight = new THREE.Vector3(1, 0, 0);
const _tmp = new THREE.Vector3();
const _planeUp = new THREE.Vector3(0, 1, 0);

function snapToSurface(bvh, point, center, outward, capsuleRadius, surfaceOffset) {
  if (!bvh) return false;

  _rayDirection.copy(outward);
  if (_rayDirection.lengthSq() < 1e-10) return false;
  _rayDirection.normalize();

  // Start outside the entire calf and cast inward. The first hit is therefore
  // the surface on this exact radial side, unlike a global closest-point query
  // which can alternate between the front and back of the suit.
  const rayOffset = Math.max(capsuleRadius * 4, 0.28);
  _rayOrigin.copy(center).addScaledVector(_rayDirection, rayOffset);
  _ray.set(_rayOrigin, _radial.copy(_rayDirection).multiplyScalar(-1));
  const rayHit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, rayOffset * 1.6);
  if (rayHit?.point) {
    _radial.subVectors(rayHit.point, center);
    if (_radial.lengthSq() > 1e-10 && _radial.normalize().dot(_rayDirection) >= 0.35) {
      point.copy(rayHit.point).addScaledVector(_rayDirection, surfaceOffset);
      return true;
    }
  }

  // Local fallback only. Reject a closest point from the opposite radial side;
  // keeping the capsule shell is preferable to a visible cross-limb jump.
  const maxSnapDistance = Math.max(capsuleRadius * 1.5, 0.06);
  const closestHit = bvh.closestPointToPoint(point, _hit, 0, maxSnapDistance);
  if (!closestHit?.point) return false;
  _closest.copy(closestHit.point);
  _radial.subVectors(_closest, center);
  if (_radial.lengthSq() < 1e-10 || _radial.normalize().dot(_rayDirection) < 0.35) {
    return false;
  }
  point.copy(_closest).addScaledVector(_rayDirection, surfaceOffset);
  return true;
}

/**
 * Stable orthonormal frame around capsule axis, biased by character-right.
 */
function capsuleBasis(axis, bodyRight, right, binorm) {
  const len = axis.length();
  if (len < 1e-6) axis.set(0, 1, 0);
  else axis.multiplyScalar(1 / len);

  right.crossVectors(bodyRight, axis);
  if (right.lengthSq() < 1e-10) {
    const ref = Math.abs(axis.y) < 0.9 ? _planeUp : new THREE.Vector3(1, 0, 0);
    right.crossVectors(axis, ref);
  }
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  else right.normalize();

  binorm.crossVectors(axis, right).normalize();
}

function shortestDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function pointOnCapsule(capsule, u, angle, bodyRight, out) {
  _axis.subVectors(capsule.b, capsule.a);
  const len = Math.max(_axis.length(), 1e-4);
  capsuleBasis(_axis, bodyRight, _right, _binorm);
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

function capsuleAngles(capsule, bodyRight) {
  _axis.subVectors(capsule.b, capsule.a);
  const len = Math.max(_axis.length(), 1e-4);
  capsuleBasis(_axis, bodyRight, _right, _binorm);

  const proj = (dir) => {
    _tmp.copy(dir).addScaledVector(_axis, -dir.dot(_axis));
    if (_tmp.lengthSq() < 1e-8) return null;
    _tmp.normalize();
    return Math.atan2(_tmp.dot(_binorm), _tmp.dot(_right));
  };

  const groundAng = proj(_down) ?? -Math.PI * 0.5;
  const rightAng = proj(bodyRight) ?? 0;
  const leftAng = rightAng + Math.PI;
  return { groundAng, rightAng, leftAng, len };
}

/**
 * One independently animatable ring at a fixed station on a directed capsule.
 * The curve is open but its final point returns to its start, so growth can
 * reveal one circumference without linking to a neighboring ring.
 */
export function buildIndependentRingCurve({
  capsule,
  bvh,
  bodyRight = new THREE.Vector3(1, 0, 0),
  groundY = 0,
  seed,
  u = 0.5,
  curveSamples = 24,
  surfaceOffset = 0.007,
  ringIndex = 0,
  ringsOnRegion = 1,
  entrySide = 'underside',
  entrySideBias = 1,
  wrapAngleDegrees = 360,
  axialWeave = 0,
  entryBend = 0.55,
}) {
  const rng = seededRng(seed);
  _bodyRight.copy(bodyRight);
  if (_bodyRight.lengthSq() < 1e-8) _bodyRight.set(1, 0, 0);
  else _bodyRight.normalize();

  const { groundAng, rightAng, leftAng } = capsuleAngles(capsule, _bodyRight);
  const outerAngle = capsule.id.endsWith('.l') ? leftAng : rightAng;
  const innerAngle = capsule.id.endsWith('.l') ? rightAng : leftAng;
  let resolvedEntrySide = entrySide;
  if (entrySide === 'random-lateral') {
    resolvedEntrySide = rng() < 0.5 ? 'inner' : 'outer';
  }

  let entryAngle = groundAng;
  if (resolvedEntrySide === 'outer') {
    entryAngle = outerAngle;
  } else if (resolvedEntrySide === 'inner') {
    entryAngle = innerAngle;
  } else if (entrySide === 'right') {
    entryAngle = rightAng;
  } else if (entrySide === 'left') {
    entryAngle = leftAng;
  }
  const sideBlend = resolvedEntrySide === 'underside'
    ? 0
    : THREE.MathUtils.clamp(entrySideBias, 0, 1);
  const angleStart = groundAng
    + shortestDelta(groundAng, entryAngle) * sideBlend
    + (rng() - 0.5) * 0.02;
  const count = Math.max(18, Math.floor(curveSamples));
  const arcRadians = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(wrapAngleDegrees, 1, 360),
  );
  const topAngle = groundAng + Math.PI;
  const positiveMid = angleStart + arcRadians * 0.5;
  const negativeMid = angleStart - arcRadians * 0.5;
  const positiveTopError = Math.abs(shortestDelta(positiveMid, topAngle));
  const negativeTopError = Math.abs(shortestDelta(negativeMid, topAngle));
  // Choose the chirality whose midpoint passes closest to the gravity-opposed
  // top of the limb. This keeps partial arcs visible instead of routing under it.
  const arcDirection = positiveTopError <= negativeTopError ? 1 : -1;
  const station = THREE.MathUtils.clamp(u, 0.02, 0.98);
  const weaveAmplitude = THREE.MathUtils.clamp(axialWeave, 0, 2)
    / Math.max(ringsOnRegion, 1);
  const weavePhase = rng() * Math.PI * 2;
  const weaveCycles = THREE.MathUtils.lerp(0.55, 1.15, rng());
  const surfacePoints = [];
  let surfaceSnapCount = 0;
  let axis = null;
  let outward0 = null;

  for (let i = 0; i < count; i += 1) {
    const phase = i / (count - 1);
    const weaveEnvelope = Math.sin(phase * Math.PI);
    const stationOffset = Math.sin(
      phase * Math.PI * 2 * weaveCycles + weavePhase,
    ) * weaveEnvelope * weaveAmplitude;
    const sampleStation = THREE.MathUtils.clamp(station + stationOffset, 0.02, 0.98);
    const shell = new THREE.Vector3();
    const info = pointOnCapsule(
      capsule,
      sampleStation,
      angleStart + phase * arcRadians * arcDirection,
      _bodyRight,
      shell,
    );
    axis = info.axis.clone();
    const center = capsule.a.clone().addScaledVector(info.axis, sampleStation * info.len);
    const outward = shell.clone().sub(center).normalize();
    const pos = shell.clone();
    if (snapToSurface(
      bvh,
      pos,
      center,
      outward,
      capsule.radius,
      surfaceOffset,
    )) surfaceSnapCount += 1;
    if (i === 0) outward0 = pos.clone().sub(center).normalize();
    surfacePoints.push(pos);
  }

  if (surfacePoints.length < 4) return null;
  const contact = surfacePoints[0];
  // A buried underside cannot produce a meaningful upward-growing root.
  if (contact.y <= groundY + 0.005) return null;
  const ringTangent = surfacePoints[1].clone().sub(contact).normalize();
  const root = contact.clone();
  root.y = groundY;
  const bendStrength = THREE.MathUtils.clamp(entryBend, 0.05, 1);
  const bendRise = Math.max(contact.y - root.y, 0.005);
  const verticalHandle = bendRise * THREE.MathUtils.lerp(0.28, 0.58, bendStrength);
  const tangentHandle = Math.min(
    capsule.radius * THREE.MathUtils.lerp(0.3, 1.15, bendStrength),
    bendRise * THREE.MathUtils.lerp(0.35, 0.9, bendStrength),
  );
  const controlUp = root.clone().add(new THREE.Vector3(0, verticalHandle, 0));
  const controlTangent = contact.clone().addScaledVector(ringTangent, -tangentHandle);
  const transition = new THREE.CubicBezierCurve3(
    root,
    controlUp,
    controlTangent,
    contact,
  );
  const bendPoints = [0.2, 0.4, 0.6, 0.8].map((t) => transition.getPoint(t));
  const points = [root, ...bendPoints, ...surfacePoints];

  const orbit = new THREE.Vector3().crossVectors(axis, outward0).normalize();
  return {
    curve: new THREE.CatmullRomCurve3(points, false, 'centripetal'),
    debug: {
      points,
      surfacePoints,
      hitch: contact.clone(),
      hitchPre: root.clone(),
      climbDir: axis,
      outward: outward0,
      orbit,
      bodyRight: _bodyRight.clone(),
      peelStartIndex: -1,
      capsuleId: capsule.id,
      u: station,
      ringIndex,
      ringsOnRegion,
      entrySide: resolvedEntrySide,
      wrapAngleDegrees,
      axialWeave,
      arcDirection,
      entryBend: bendStrength,
      wrapStyle: 'independent-ring',
      surfaceSnapCount,
      surfaceSampleCount: surfacePoints.length,
    },
  };
}

/** Build independent partial-ring tendrils across directed body regions. */
export function buildWrapCurves({
  hosts,
  tendrilCount = 108,
  layoutSeed = 0,
  curveSamples = 48,
  spacingVariation = 0.45,
  surfaceOffset = 0.007,
  enabledCapsuleIds = null,
  entrySide = 'random-lateral',
  entrySideBias = 1,
  wrapAngleRange = [180, 260],
  axialWeave = 0,
  entryBend = 0.55,
  noiseAmount = 0,
  noiseFrequency = 3,
  noiseSeed = 0,
} = {}) {
  const bodyHost = hosts.find((host) => host.id === 'body');
  if (!bodyHost?.bvh || !bodyHost.capsules?.length || tendrilCount < 1) return [];

  const enabled = enabledCapsuleIds ? new Set(enabledCapsuleIds) : null;
  const regions = bodyHost.capsules.filter((capsule) => (
    !enabled || enabled.has(capsule.id)
  ));
  const stations = allocateRingStations(regions, tendrilCount, {
    layoutSeed,
    spacingVariation,
    totalBudget: 512,
  });
  const bodyRight = bodyHost.bodyRight ?? new THREE.Vector3(1, 0, 0);
  const out = [];

  for (let i = 0; i < stations.length; i += 1) {
    const slot = stations[i];
    const tendrilSeed = layoutSeed * 97 + i * 17 + 3;
    const stationRng = seededRng(tendrilSeed + 7919);
    const angleMin = Math.min(wrapAngleRange[0], wrapAngleRange[1]);
    const angleMax = Math.max(wrapAngleRange[0], wrapAngleRange[1]);
    const wrapAngleDegrees = THREE.MathUtils.lerp(angleMin, angleMax, stationRng());
    let built = null;
    // A lateral entry can occasionally land too close to the ground. Retry the
    // alternate seeded side and a tiny station shift instead of leaving a hole.
    for (let attempt = 0; attempt < 3 && !built; attempt += 1) {
      const retryWidth = Math.min(0.03, 0.3 / Math.max(slot.ringsOnRegion, 1));
      const station = THREE.MathUtils.clamp(
        slot.station + (attempt === 0 ? 0 : (stationRng() * 2 - 1) * retryWidth),
        0.02,
        0.98,
      );
      built = buildIndependentRingCurve({
        capsule: slot.capsule,
        bvh: bodyHost.bvh,
        bodyRight,
        groundY: 0,
        seed: tendrilSeed + attempt * 1009,
        u: station,
        curveSamples,
        surfaceOffset,
        ringIndex: slot.ringIndex,
        ringsOnRegion: slot.ringsOnRegion,
        entrySide,
        entrySideBias,
        wrapAngleDegrees,
        axialWeave,
        entryBend,
      });
    }
    if (!built) continue;
    const noisy = distortCurveWithSpatialNoise(built.curve, {
      amount: noiseAmount,
      frequency: noiseFrequency,
      seed: noiseSeed,
      samples: curveSamples,
    });
    if (noisy.points) built.debug.points = noisy.points;
    out.push({
      seed: tendrilSeed,
      hostId: bodyHost.id,
      capsuleId: slot.capsule.id,
      ringIndex: slot.ringIndex,
      curve: noisy.curve,
      debug: built.debug,
    });
  }

  return out;
}
