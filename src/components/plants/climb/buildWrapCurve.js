import * as THREE from 'three';
import { seededRng } from '../stem/buildStemTube.js';
import {
  allocateWrapStations,
} from './limbCapsules.js';
import { allocateSurfaceCoverageStations } from './surfaceCoverage.js';
import {
  buildGroundedSurfaceRoutes,
  roundedSurfacePolylineCurve,
} from './surfaceRoutes.js';
import { distortCurveWithSpatialNoise } from './spatialNoise.js';
import { TENDRIL_ROLE } from './climbRoles.js';

const _hit = {};
const _closest = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _center = new THREE.Vector3();
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

/** Bump whenever path topology/routing changes so Fast Refresh rebuilds geometry. */
export const WRAP_PATH_ALGORITHM_VERSION = 25;

function hostSurfaceOffset(host, surfaceOffset) {
  return surfaceOffset * (host?.profile?.surfaceOffsetScale ?? 1);
}

function measureCurveSurfaceClearance(curve, bvh, samples = 120) {
  const point = new THREE.Vector3();
  let maxDistance = 0;
  let maxPoint = null;
  for (let i = 0; i <= samples; i += 1) {
    curve.getPointAt(i / samples, point);
    const closest = bvh.closestPointToPoint(point, _hit, 0, Infinity);
    if (!closest || !Number.isFinite(closest.distance)) {
      return { maxDistance: Infinity, maxPoint: point.clone() };
    }
    if (closest.distance > maxDistance) {
      maxDistance = closest.distance;
      maxPoint = point.clone();
    }
  }
  return { maxDistance, maxPoint };
}

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

export function retargetWrapPointsToGraphVertex({
  points,
  graphHitch,
  capsuleRadius,
}) {
  if (!points?.length || !graphHitch) return null;
  const retargeted = points.map((point) => point.clone());
  const delta = graphHitch.clone().sub(retargeted[0]);
  const maxHitchShift = Math.max(capsuleRadius * 0.5, 0.03);
  if (delta.length() > maxHitchShift) return null;

  const blendCount = Math.min(8, retargeted.length);
  for (let i = 0; i < blendCount; i += 1) {
    const phase = blendCount > 1 ? i / (blendCount - 1) : 1;
    retargeted[i].addScaledVector(delta, (1 - phase) ** 2);
    if (i === 0) retargeted[i].copy(graphHitch);
    if (i < 1) continue;

    const originalStep = points[i].distanceTo(points[i - 1]);
    const allowedStep = Math.max(originalStep * 3, 0.03);
    if (retargeted[i].distanceTo(retargeted[i - 1]) > allowedStep) return null;
  }

  return {
    points: retargeted,
    curve: new THREE.CatmullRomCurve3(retargeted, false, 'centripetal'),
  };
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
    .addScaledVector(_axis, u * len)
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

function buildPlanarSurfaceStroke({
  capsule,
  bvh,
  seed,
  u,
  curveSamples,
  surfaceOffset,
  wrapIndex,
  wrapsOnRegion,
  wrapAngleDegrees,
  axialWeave,
  coverageTarget,
  bodyRight,
}) {
  if (!coverageTarget || !capsule.planeAcross || !capsule.planeNormal) return null;
  const rng = seededRng(seed);
  const axis = new THREE.Vector3().subVectors(capsule.b, capsule.a);
  const axisLength = axis.length();
  if (axisLength < 1e-6) return null;
  axis.multiplyScalar(1 / axisLength);

  const across = capsule.planeAcross.clone().normalize();
  const normal = capsule.planeNormal.clone().normalize();
  const guideCenter = capsule.a.clone().addScaledVector(
    axis,
    THREE.MathUtils.clamp(u, capsule.uMin ?? 0, capsule.uMax ?? 1) * axisLength,
  );
  if (coverageTarget.clone().sub(guideCenter).dot(normal) < 0) normal.negate();
  if (rng() < 0.5) across.negate();

  const count = Math.max(18, Math.floor(curveSamples));
  const angleRatio = THREE.MathUtils.clamp(wrapAngleDegrees / 180, 0.45, 1);
  const strokeLength = Math.max(capsule.planeWidth * angleRatio, 0.04);
  const weaveAmplitude = Math.min(
    strokeLength * 0.18 * THREE.MathUtils.clamp(axialWeave, 0, 2),
    axisLength / Math.max(wrapsOnRegion, 1),
  );
  const weavePhase = rng() * Math.PI * 2;
  const surfacePoints = [];
  let previousCandidate = null;

  for (let i = 0; i < count; i += 1) {
    const phase = i / (count - 1);
    const candidate = coverageTarget.clone()
      .addScaledVector(across, (phase - 0.5) * strokeLength)
      .addScaledVector(
        axis,
        Math.sin(phase * Math.PI * 2 + weavePhase)
          * Math.sin(phase * Math.PI)
          * weaveAmplitude,
      );
    const center = candidate.clone().addScaledVector(normal, -capsule.radius);
    const point = candidate.clone();
    if (!snapToSurface(
      bvh,
      point,
      center,
      normal,
      capsule.radius,
      surfaceOffset,
    )) return null;

    if (surfacePoints.length && previousCandidate) {
      const expectedStep = Math.max(candidate.distanceTo(previousCandidate), 1e-4);
      if (point.distanceTo(surfacePoints[surfacePoints.length - 1]) > Math.max(
        expectedStep * 3,
        0.025,
      )) return null;
    }
    surfacePoints.push(point);
    previousCandidate = candidate;
  }

  if (surfacePoints.length < 4) return null;
  return {
    curve: new THREE.CatmullRomCurve3(surfacePoints, false, 'centripetal'),
    debug: {
      points: surfacePoints,
      surfacePoints,
      hitch: surfacePoints[0].clone(),
      hitchPre: null,
      climbDir: axis,
      outward: normal,
      orbit: across,
      bodyRight: bodyRight.clone(),
      peelStartIndex: -1,
      capsuleId: capsule.id,
      u,
      wrapIndex,
      wrapsOnRegion,
      entrySide: 'surface-target',
      wrapAngleDegrees,
      axialWeave,
      arcDirection: 0,
      entryBend: 0,
      coverageTarget: coverageTarget.clone(),
      usesGroundRoot: false,
      airDistance: 0,
      wrapStyle: 'surface-stroke',
      surfaceSnapCount: surfacePoints.length,
      surfaceSampleCount: surfacePoints.length,
    },
  };
}

/**
 * One independently animatable wrap at a fixed station on a directed capsule.
 * The curve is open but its final point returns to its start, so growth can
 * reveal one circumference without linking to a neighboring wrap.
 */
export function buildIndependentWrapCurve({
  capsule,
  bvh,
  bodyRight = new THREE.Vector3(1, 0, 0),
  groundY = 0,
  seed,
  u = 0.5,
  curveSamples = 24,
  surfaceOffset = 0.007,
  wrapIndex = 0,
  wrapsOnRegion = 1,
  entrySide = 'underside',
  entrySideBias = 1,
  wrapAngleDegrees = 360,
  axialWeave = 0,
  entryBend = 0.55,
  coverageTarget = null,
  maxFreeAirDistance = -1,
  debugOnFailure = false,
}) {
  if (capsule.surfaceMode === 'planar' && coverageTarget) {
    return buildPlanarSurfaceStroke({
      capsule,
      bvh,
      seed,
      u,
      curveSamples,
      surfaceOffset,
      wrapIndex,
      wrapsOnRegion,
      wrapAngleDegrees,
      axialWeave,
      coverageTarget,
      bodyRight,
    });
  }

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
  let angleStart = groundAng
    + shortestDelta(groundAng, entryAngle) * sideBlend
    + (rng() - 0.5) * 0.02;
  const count = Math.max(18, Math.floor(curveSamples));
  const arcRadians = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(wrapAngleDegrees, 1, 360),
  );
  const topAngle = groundAng + Math.PI;
  const uMin = capsule.uMin ?? 0.02;
  const uMax = capsule.uMax ?? 0.98;
  const station = THREE.MathUtils.clamp(u, uMin, uMax);
  let coverageAngle = null;
  if (coverageTarget) {
    _axis.subVectors(capsule.b, capsule.a);
    const axisLength = Math.max(_axis.length(), 1e-4);
    capsuleBasis(_axis, _bodyRight, _right, _binorm);
    _center.copy(capsule.a).addScaledVector(_axis, station * axisLength);
    _tmp.subVectors(coverageTarget, _center);
    _tmp.addScaledVector(_axis, -_tmp.dot(_axis));
    if (_tmp.lengthSq() > 1e-8) {
      _tmp.normalize();
      coverageAngle = Math.atan2(_tmp.dot(_binorm), _tmp.dot(_right));
    }
  }
  const desiredMidAngle = coverageAngle ?? topAngle;
  let arcDirection;
  if (coverageAngle != null && capsule.generatedFromSurface) {
    // A bone-free prop has no anatomical cuff side. Center its partial arc on
    // the sampled surface patch; otherwise the body-specific side start can
    // leave broad backpack faces permanently uncovered.
    arcDirection = rng() < 0.5 ? 1 : -1;
    angleStart = coverageAngle - arcDirection * arcRadians * 0.5;
  } else {
    const positiveMid = angleStart + arcRadians * 0.5;
    const negativeMid = angleStart - arcRadians * 0.5;
    const positiveTopError = Math.abs(shortestDelta(positiveMid, desiredMidAngle));
    const negativeTopError = Math.abs(shortestDelta(negativeMid, desiredMidAngle));
    // Choose the chirality whose midpoint passes closest to the gravity-opposed
    // top of the limb. This keeps partial arcs visible instead of routing under it.
    arcDirection = positiveTopError <= negativeTopError ? 1 : -1;
  }
  const weaveAmplitude = THREE.MathUtils.clamp(axialWeave, 0, 2)
    / Math.max(wrapsOnRegion, 1);
  const weavePhase = rng() * Math.PI * 2;
  const weaveCycles = THREE.MathUtils.lerp(0.55, 1.15, rng());
  const surfacePoints = [];
  let surfaceSnapCount = 0;
  let maximumNeighborDistance = 0;
  let maximumAllowedNeighborDistance = 0;
  let axis = null;
  let outward0 = null;
  let previousShell = null;
  const shellPoints = [];
  const debugFailure = () => (debugOnFailure ? {
    curve: null,
    debug: {
      shellPoints,
      surfacePoints,
    },
  } : null);

  for (let i = 0; i < count; i += 1) {
    const phase = i / (count - 1);
    const weaveEnvelope = Math.sin(phase * Math.PI);
    const stationOffset = Math.sin(
      phase * Math.PI * 2 * weaveCycles + weavePhase,
    ) * weaveEnvelope * weaveAmplitude;
    const sampleStation = THREE.MathUtils.clamp(
      station + stationOffset,
      uMin,
      uMax,
    );
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
    shellPoints.push(shell.clone());
    const snapped = snapToSurface(
      bvh,
      pos,
      center,
      outward,
      capsule.radius,
      surfaceOffset,
    );
    if (!snapped) return debugFailure();

    // A merged character BVH can return a valid hit on the wrong body part
    // (for example torso -> arm across an armpit). Distance-to-any-surface
    // cannot detect that. Require each hit to remain locally continuous with
    // the preceding wrap sample and retry/drop the wrap when it jumps.
    if (surfacePoints.length > 0 && previousShell) {
      const expectedStep = Math.max(shell.distanceTo(previousShell), 1e-4);
      const neighborDistance = pos.distanceTo(surfacePoints[surfacePoints.length - 1]);
      const allowedNeighborDistance = Math.max(
        expectedStep * 3,
        Math.min(capsule.radius * 0.28, 0.035),
        0.018,
      );
      maximumNeighborDistance = Math.max(maximumNeighborDistance, neighborDistance);
      maximumAllowedNeighborDistance = Math.max(
        maximumAllowedNeighborDistance,
        allowedNeighborDistance,
      );
      if (neighborDistance > allowedNeighborDistance) return debugFailure();
    }

    surfaceSnapCount += 1;
    if (i === 0) outward0 = pos.clone().sub(center).normalize();
    surfacePoints.push(pos);
    previousShell = shell;
  }

  if (surfacePoints.length < 4) return debugFailure();
  const contact = surfacePoints[0];
  if (contact.y < groundY - 0.02) return debugFailure();
  const wrapTangent = surfacePoints[1].clone().sub(contact).normalize();
  const bendStrength = THREE.MathUtils.clamp(entryBend, 0.05, 1);
  const airDistance = Math.max(contact.y - groundY, 0);
  const usesGroundRoot = maxFreeAirDistance >= 0
    && airDistance <= maxFreeAirDistance;
  let root = null;
  let points = surfacePoints;
  if (usesGroundRoot) {
    root = contact.clone();
    root.y = groundY;
    const bendRise = Math.max(contact.y - root.y, 0.005);
    const verticalHandle = bendRise * THREE.MathUtils.lerp(0.28, 0.58, bendStrength);
    const tangentHandle = Math.min(
      capsule.radius * THREE.MathUtils.lerp(0.3, 1.15, bendStrength),
      bendRise * THREE.MathUtils.lerp(0.35, 0.9, bendStrength),
    );
    const controlUp = root.clone().add(new THREE.Vector3(0, verticalHandle, 0));
    const controlTangent = contact.clone().addScaledVector(wrapTangent, -tangentHandle);
    const transition = new THREE.CubicBezierCurve3(
      root,
      controlUp,
      controlTangent,
      contact,
    );
    const bendPoints = [0.2, 0.4, 0.6, 0.8].map((t) => transition.getPoint(t));
    points = [root, ...bendPoints, ...surfacePoints];
  }

  const orbit = new THREE.Vector3().crossVectors(axis, outward0).normalize();
  return {
    curve: new THREE.CatmullRomCurve3(points, false, 'centripetal'),
    debug: {
      points,
      surfacePoints,
      hitch: contact.clone(),
      hitchPre: root?.clone() ?? null,
      climbDir: axis,
      outward: outward0,
      orbit,
      bodyRight: _bodyRight.clone(),
      peelStartIndex: -1,
      capsuleId: capsule.id,
      u: station,
      wrapIndex,
      wrapsOnRegion,
      entrySide: resolvedEntrySide,
      wrapAngleDegrees,
      axialWeave,
      arcDirection,
      entryBend: bendStrength,
      coverageTarget: coverageTarget?.clone?.() ?? null,
      usesGroundRoot,
      airDistance,
      wrapStyle: 'independent-wrap',
      surfaceSnapCount,
      surfaceSampleCount: surfacePoints.length,
      shellPoints,
      maximumNeighborDistance,
      maximumAllowedNeighborDistance,
    },
  };
}

/** Build independent partial-wrap tendrils across directed body regions. */
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
  hitchOnGraphVertex = false,
} = {}) {
  if (!hosts?.length || tendrilCount < 1) return [];

  const requestedCount = Math.max(Math.floor(tendrilCount), 1);
  // Wrap snapping/continuity validation is intentionally strict. Generate a
  // deterministic surplus and keep sampling until the requested visible count
  // is filled instead of turning every rejected candidate into a coverage hole.
  const candidateBudget = Math.min(
    Math.max(requestedCount * 6, requestedCount + 128),
    3072,
  );

  let stations = allocateSurfaceCoverageStations(hosts, candidateBudget, {
    layoutSeed,
    spacingVariation,
    enabledCapsuleIds,
    totalBudget: candidateBudget,
  });

  // Compatibility fallback for hosts created before posed geometry was exposed.
  if (!stations.length) {
    const bodyHost = hosts.find((host) => host.id === 'body');
    if (!bodyHost?.bvh || !bodyHost.capsules?.length) return [];
    const enabled = enabledCapsuleIds ? new Set(enabledCapsuleIds) : null;
    const regions = bodyHost.capsules.filter((capsule) => (
      !enabled || enabled.has(capsule.id)
    ));
    stations = allocateWrapStations(regions, candidateBudget, {
      layoutSeed,
      spacingVariation,
      totalBudget: candidateBudget,
    }).map((station) => ({ ...station, host: bodyHost, targetPoint: null }));
  }
  const orderRng = seededRng(layoutSeed * 1597 + 43);
  for (let i = stations.length - 1; i > 0; i -= 1) {
    const swap = Math.floor(orderRng() * (i + 1));
    [stations[i], stations[swap]] = [stations[swap], stations[i]];
  }
  const wrapCandidates = [];
  const routeTargetsByHost = new Map();

  for (let i = 0; i < stations.length; i += 1) {
    if (wrapCandidates.length >= requestedCount) break;
    const slot = stations[i];
    const host = slot.host;
    if (!host?.bvh) continue;
    const bodyRight = host.bodyRight ?? new THREE.Vector3(1, 0, 0);
    const tendrilSeed = layoutSeed * 97 + i * 17 + 3;
    const stationRng = seededRng(tendrilSeed + 7919);
    const angleMin = Math.min(wrapAngleRange[0], wrapAngleRange[1]);
    const angleMax = Math.max(wrapAngleRange[0], wrapAngleRange[1]);
    const wrapAngleDegrees = THREE.MathUtils.lerp(angleMin, angleMax, stationRng())
      * (host.profile?.wrapAngleScale ?? 1)
      * (slot.capsule.wrapAngleScale ?? 1);
    const resolvedSurfaceOffset = hostSurfaceOffset(host, surfaceOffset);
    let built = null;
    // A lateral entry can occasionally land too close to the ground. Retry the
    // alternate seeded side and a tiny station shift instead of leaving a hole.
    for (let attempt = 0; attempt < 3 && !built; attempt += 1) {
      const retryWidth = Math.min(0.03, 0.3 / Math.max(slot.wrapsOnRegion, 1));
      const stationMin = slot.capsule.uMin ?? 0.02;
      const stationMax = slot.capsule.uMax ?? 0.98;
      const station = THREE.MathUtils.clamp(
        slot.station + (attempt === 0 ? 0 : (stationRng() * 2 - 1) * retryWidth),
        stationMin,
        stationMax,
      );
      built = buildIndependentWrapCurve({
        capsule: slot.capsule,
        bvh: host.bvh,
        bodyRight,
        groundY: 0,
        seed: tendrilSeed + attempt * 1009,
        u: station,
        curveSamples,
        surfaceOffset: resolvedSurfaceOffset,
        wrapIndex: slot.wrapIndex,
        wrapsOnRegion: slot.wrapsOnRegion,
        entrySide,
        entrySideBias,
        wrapAngleDegrees,
        axialWeave,
        entryBend,
        coverageTarget: slot.targetPoint,
        maxFreeAirDistance: -1,
      });
    }
    if (!built) continue;
    const routeTargetId = built.debug.usesGroundRoot
      ? null
      : `${host.id}:${tendrilSeed}`;
    if (routeTargetId) {
      let group = routeTargetsByHost.get(host.id);
      if (!group) {
        group = { host, targets: [] };
        routeTargetsByHost.set(host.id, group);
      }
      group.targets.push({
        id: routeTargetId,
        point: built.debug.hitch.clone(),
      });
    }
    const noisy = distortCurveWithSpatialNoise(built.curve, {
      amount: noiseAmount,
      frequency: noiseFrequency,
      seed: noiseSeed,
      samples: curveSamples,
    });
    if (noisy.points) built.debug.points = noisy.points;
    wrapCandidates.push({
      seed: tendrilSeed,
      hostId: host.id,
      capsuleId: slot.capsule.id,
      capsuleRadius: slot.capsule.radius,
      wrapIndex: slot.wrapIndex,
      role: TENDRIL_ROLE.WRAP,
      treeId: routeTargetId ? null : `${host.id}:wrap:${tendrilSeed}`,
      routeTargetId,
      curve: noisy.curve,
      debug: built.debug,
    });
  }

  const out = [];
  const reachedTargets = new Set();
  const targetDistances = new Map();
  const targetGraphPoints = new Map();
  const targetAttachments = new Map();
  const targetRadiusScales = new Map();
  const targetTreeIds = new Map();
  let routeSeedIndex = 0;
  for (const group of routeTargetsByHost.values()) {
    const routed = buildGroundedSurfaceRoutes({
      host: group.host,
      targets: group.targets,
      groundY: 0,
      surfaceOffset: hostSurfaceOffset(group.host, surfaceOffset),
    });
    for (const targetId of routed.reached) reachedTargets.add(targetId);
    for (const [targetId, distance] of routed.targetDistances) {
      targetDistances.set(targetId, distance);
    }
    for (const [targetId, point] of routed.targetGraphPoints) {
      targetGraphPoints.set(targetId, point);
    }
    for (const [targetId, points] of routed.targetAttachments) {
      targetAttachments.set(targetId, points);
    }
    for (const [targetId, radiusScale] of routed.targetRadiusScales) {
      targetRadiusScales.set(targetId, radiusScale);
    }
    for (const [targetId, treeId] of routed.targetTreeIds) {
      targetTreeIds.set(targetId, treeId);
    }
    for (let i = 0; i < routed.routes.length; i += 1) {
      const route = routed.routes[i];
      const routeSeed = layoutSeed * 97 + 700001 + routeSeedIndex * 1009;
      out.push({
        seed: routeSeed,
        hostId: group.host.id,
        capsuleId: 'surface-route',
        wrapIndex: -1,
        role: TENDRIL_ROLE.GROUND_PATH,
        treeId: route.treeId,
        pathStartDistance: route.startDistance,
        pathEndDistance: route.endDistance,
        radiusStartScale: route.radiusStartScale,
        radiusEndScale: route.radiusEndScale,
        baseFlareScale: route.kind === 'ground-entry' ? 1 : 0,
        curve: route.curve,
        debug: {
          points: route.points,
          surfacePoints: route.points,
          hitch: route.points[route.points.length - 1]?.clone?.() ?? null,
          hitchPre: route.kind === 'ground-entry'
            ? route.points[0]?.clone?.() ?? null
            : null,
          climbDir: route.points.length > 1
            ? route.points[route.points.length - 1].clone()
              .sub(route.points[0]).normalize()
            : null,
          outward: null,
          orbit: null,
          bodyRight: group.host.bodyRight?.clone?.() ?? null,
          peelStartIndex: -1,
          capsuleId: 'surface-route',
          u: null,
          wrapIndex: -1,
          wrapsOnRegion: 0,
          entrySide: 'surface',
          wrapStyle: route.kind,
          usesGroundRoot: route.kind === 'ground-entry',
          startLoad: route.startLoad,
          endLoad: route.endLoad,
          radiusStartScale: route.radiusStartScale,
          radiusEndScale: route.radiusEndScale,
          startDistance: route.startDistance,
          endDistance: route.endDistance,
        },
      });
      routeSeedIndex += 1;
    }
  }

  for (let i = 0; i < wrapCandidates.length; i += 1) {
    const wrapSegment = wrapCandidates[i];
    if (wrapSegment.routeTargetId && !reachedTargets.has(wrapSegment.routeTargetId)) continue;
    if (wrapSegment.routeTargetId) {
      const wrapPoints = wrapSegment.curve.getSpacedPoints(Math.max(curveSamples, 24));
      const graphHitch = targetGraphPoints.get(wrapSegment.routeTargetId);
      const retargeted = hitchOnGraphVertex && graphHitch
        ? retargetWrapPointsToGraphVertex({
            points: wrapPoints,
            graphHitch,
            capsuleRadius: wrapSegment.capsuleRadius,
          })
        : null;

      if (retargeted) {
        wrapSegment.curve = retargeted.curve;
        wrapSegment.debug.points = retargeted.points;
        wrapSegment.debug.surfacePoints = retargeted.points;
        wrapSegment.debug.hitch = graphHitch.clone();
        wrapSegment.debug.attachmentPointCount = 0;
        wrapSegment.debug.hitchOnGraphVertex = true;
      } else {
        const attachment = targetAttachments.get(wrapSegment.routeTargetId);
        if (!attachment?.length) continue;
        const connectedPoints = [
          ...attachment.slice(0, -1),
          ...wrapPoints,
        ];
        const connected = roundedSurfacePolylineCurve(connectedPoints);
        if (!connected) continue;
        wrapSegment.curve = connected;
        wrapSegment.debug.attachmentPointCount = attachment.length;
        wrapSegment.debug.hitchOnGraphVertex = false;
        wrapSegment.debug.points = [
          ...attachment.slice(0, -1).map((point) => point.clone()),
          ...(wrapSegment.debug.points ?? []),
        ];
      }
      wrapSegment.radiusStartScale = targetRadiusScales.get(wrapSegment.routeTargetId) ?? 1;
      // ClimbTendrils resolves the end to the current global tip taper.
      wrapSegment.radiusEndScale = null;
      wrapSegment.baseFlareScale = 0;
      wrapSegment.pathStartDistance = targetDistances.get(wrapSegment.routeTargetId) ?? 0;
      wrapSegment.pathEndDistance = wrapSegment.pathStartDistance + wrapSegment.curve.getLength();
      wrapSegment.treeId = targetTreeIds.get(wrapSegment.routeTargetId)
        ?? `${wrapSegment.hostId}:wrap:${wrapSegment.seed}`;
    }
    out.push(wrapSegment);
  }

  return out;
}

/**
 * Annotate each wrap with how far it strays from its host surface.
 *
 * Debug-only output, and by far the most expensive thing in this module: 121 BVH
 * closest-point queries per wrap, so ~40k for a default layout. The debug overlay
 * calls this while it is mounted instead of every layout build paying for data
 * that is usually never looked at.
 */
export function annotateWrapClearance(
  wraps,
  hosts,
  {
    surfaceOffset = 0.007,
    noiseAmount = 0,
    startIndex = 0,
    endIndex = wraps.length,
  } = {},
) {
  const hostById = new Map((hosts ?? []).map((host) => [host.id, host]));
  const from = Math.min(Math.max(Math.floor(startIndex), 0), wraps.length);
  const to = Math.min(
    Math.max(Math.floor(endIndex), from),
    wraps.length,
  );
  for (let i = from; i < to; i += 1) {
    const wrap = wraps[i];
    if (!wrap?.debug) continue;
    const host = hostById.get(wrap.hostId);
    const clearanceLimit = hostSurfaceOffset(host, surfaceOffset)
      + Math.max(noiseAmount, 0) + 0.012;
    const isGroundEntry = wrap.debug.wrapStyle === 'ground-entry';
    if (!host?.bvh || isGroundEntry) {
      wrap.debug.maxSurfaceDistance = 0;
      wrap.debug.clearanceLimit = clearanceLimit;
      wrap.debug.clearanceExceeded = false;
      wrap.debug.clearancePoint = null;
      continue;
    }
    const clearance = measureCurveSurfaceClearance(wrap.curve, host.bvh);
    wrap.debug.maxSurfaceDistance = clearance.maxDistance;
    wrap.debug.clearanceLimit = clearanceLimit;
    wrap.debug.clearanceExceeded = clearance.maxDistance > clearanceLimit;
    wrap.debug.clearancePoint = clearance.maxPoint;
  }
  return wraps;
}
