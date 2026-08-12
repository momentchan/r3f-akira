import * as THREE from 'three';
import { seededRng } from '../stem/buildStemTube.js';
import {
  allocateHelixCoils,
  capsuleFromBox,
} from './limbCapsules.js';

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

function snapToSurface(bvh, point, center, outward, capsuleRadius, clearGap) {
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
      point.copy(rayHit.point).addScaledVector(_rayDirection, clearGap);
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
  point.copy(_closest).addScaledVector(_rayDirection, clearGap);
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

function buildStackedRingSamples({
  uStart,
  uEnd,
  angleStart,
  ringCount,
  ringAxialWidth,
  sampleCount,
}) {
  const rings = THREE.MathUtils.clamp(Math.floor(ringCount), 1, 12);
  const start = THREE.MathUtils.clamp(uStart, 0.02, 0.98);
  const end = THREE.MathUtils.clamp(Math.max(uEnd, start + 0.02), 0.02, 0.98);
  const span = end - start;
  const ringRise = Math.min(Math.max(ringAxialWidth, 0), span / Math.max(rings * 2, 1));
  const ringSamples = Math.max(16, Math.floor((sampleCount * 0.82) / rings));
  const connectorSamples = rings > 1
    ? Math.max(3, Math.floor((sampleCount * 0.18) / (rings - 1)))
    : 0;
  const ringStarts = Array.from({ length: rings }, (_, index) => (
    rings === 1
      ? start
      : THREE.MathUtils.lerp(start, end - ringRise, index / (rings - 1))
  ));
  const samples = [];

  for (let ring = 0; ring < rings; ring += 1) {
    const ringStart = ringStarts[ring];
    for (let j = ring > 0 ? 1 : 0; j < ringSamples; j += 1) {
      const phase = j / (ringSamples - 1);
      samples.push({
        uLive: ringStart + ringRise * phase,
        angle: angleStart + (ring + phase) * Math.PI * 2,
      });
    }

    if (ring >= rings - 1) continue;
    const connectorStart = ringStart + ringRise;
    const connectorEnd = ringStarts[ring + 1];
    const connectorAngle = angleStart + (ring + 1) * Math.PI * 2;
    for (let j = 1; j <= connectorSamples; j += 1) {
      samples.push({
        uLive: THREE.MathUtils.lerp(connectorStart, connectorEnd, j / connectorSamples),
        angle: connectorAngle,
      });
    }
  }

  return samples.map((sample, index) => ({
    ...sample,
    t: samples.length > 1 ? index / (samples.length - 1) : 0,
  }));
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
  sampleCount = 24,
  clearGap = 0.007,
  ringIndex = 0,
  ringCount = 1,
  entrySide = 'underside',
  entrySideBias = 1,
  arcDegrees = 360,
  rootBendStrength = 0.55,
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
  const count = Math.max(18, Math.floor(sampleCount));
  const arcRadians = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(arcDegrees, 1, 360),
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
  const surfacePoints = [];
  let surfaceSnapCount = 0;
  let axis = null;
  let outward0 = null;

  for (let i = 0; i < count; i += 1) {
    const phase = i / (count - 1);
    const shell = new THREE.Vector3();
    const info = pointOnCapsule(
      capsule,
      station,
      angleStart + phase * arcRadians * arcDirection,
      _bodyRight,
      shell,
    );
    axis = info.axis.clone();
    const center = capsule.a.clone().addScaledVector(info.axis, station * info.len);
    const outward = shell.clone().sub(center).normalize();
    const pos = shell.clone();
    if (snapToSurface(
      bvh,
      pos,
      center,
      outward,
      capsule.radius,
      clearGap,
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
  const bendStrength = THREE.MathUtils.clamp(rootBendStrength, 0.05, 1);
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
      ringCount,
      entrySide: resolvedEntrySide,
      arcDegrees,
      arcDirection,
      rootBendStrength: bendStrength,
      wrapStyle: 'independent-ring',
      surfaceSnapCount,
      surfaceSampleCount: surfacePoints.length,
    },
  };
}

/**
 * One helix coil: ground root → surface → circumferential wrap with axial pitch.
 */
export function buildHelixWrapCurve({
  capsule,
  bvh,
  bodyRight = new THREE.Vector3(1, 0, 0),
  groundY = 0,
  seed,
  sampleCount = 18,
  turns = 1,
  helixPitch = 0.12,
  climbBias = 0.55,
  clearGap = 0.007,
  peelAt = 1,
  uStart = 0.5,
  coilIndex = 0,
  coilsOnCapsule = 1,
  wrapStyle = 'helix',
  ringCount = 5,
  ringAxialWidth = 0.012,
}) {
  const rng = seededRng(seed);
  const surfacePoints = [];
  const count = Math.max(8, Math.floor(sampleCount));
  _bodyRight.copy(bodyRight);
  if (_bodyRight.lengthSq() < 1e-8) _bodyRight.set(1, 0, 0);
  else _bodyRight.normalize();

  const { groundAng, rightAng } = capsuleAngles(capsule, _bodyRight);
  const coilSlot = coilIndex / Math.max(coilsOnCapsule, 1);
  const towardRight = shortestDelta(groundAng, rightAng);
  const angleStart = groundAng
    + towardRight * 0.35
    + coilSlot * Math.PI * 0.22
    + (rng() - 0.5) * 0.1;

  const axisLen = Math.max(capsule.length, 1e-4);
  const axialSpan = THREE.MathUtils.clamp(
    (helixPitch / axisLen) * THREE.MathUtils.clamp(climbBias, 0.1, 1),
    0.02,
    0.92,
  );
  const angleSpan = turns * Math.PI * 2;
  const pathSamples = wrapStyle === 'stacked-rings'
    ? buildStackedRingSamples({
      uStart,
      uEnd: uStart + axialSpan,
      angleStart,
      ringCount,
      ringAxialWidth,
      sampleCount: count,
    })
    : Array.from({ length: count }, (_, index) => {
      const t = index / (count - 1);
      return {
        t,
        uLive: THREE.MathUtils.clamp(uStart + axialSpan * t, 0.02, 0.98),
        angle: angleStart + angleSpan * t,
      };
    });

  const shell = new THREE.Vector3();
  let climbDir = new THREE.Vector3(0, 1, 0);
  let outward0 = null;
  let orbit0 = null;
  let hitch = null;
  let hitchPre = null;
  let peelStartIndex = -1;
  let surfaceSnapCount = 0;

  for (let i = 0; i < pathSamples.length; i += 1) {
    const sample = pathSamples[i];
    const { t, uLive } = sample;
    const peel = peelAt < 1 && t >= peelAt;
    if (peel && peelStartIndex < 0) peelStartIndex = surfacePoints.length;

    const angle = peel
      ? angleStart + angleSpan * peelAt
      : sample.angle;

    const info = pointOnCapsule(capsule, uLive, angle, _bodyRight, shell);
    climbDir.copy(info.axis);
    const center = new THREE.Vector3()
      .copy(capsule.a)
      .addScaledVector(info.axis, uLive * info.len);
    const shellOutward = new THREE.Vector3().subVectors(shell, center).normalize();

    if (i === 0) {
      hitchPre = shell.clone();
      hitchPre.y = groundY;
    }

    const pos = shell.clone();
    if (!peel) {
      if (snapToSurface(
        bvh,
        pos,
        center,
        shellOutward,
        capsule.radius,
        clearGap,
      )) surfaceSnapCount += 1;
    } else {
      pos.addScaledVector(_bodyRight, -capsule.radius * (0.35 + (t - peelAt) * 1.8));
      pos.y += (t - peelAt) * capsule.radius * 1.2;
    }

    if (i === 0) {
      hitch = pos.clone();
      outward0 = pos.clone().sub(center);
      if (outward0.lengthSq() > 1e-8) outward0.normalize();
      else outward0 = _bodyRight.clone();
      orbit0 = new THREE.Vector3().crossVectors(climbDir, outward0);
      if (orbit0.lengthSq() > 1e-8) orbit0.normalize();
      else orbit0 = info.binorm.clone();
    }

    surfacePoints.push(pos.clone());
  }

  if (!hitchPre || !hitch || surfacePoints.length < 4) return null;

  // Give the ground-to-suit transition its own short, smooth approach instead
  // of asking CatmullRom to bridge a single long segment. The controls stay in
  // the vertical plane below the first surface hit, so they cannot jump limbs.
  const root = hitchPre.clone();
  const rise = Math.max(hitch.y - groundY, capsule.radius * 0.6);
  const approach = hitch.clone().lerp(root, 0.34);
  approach.y = groundY + rise * 0.48;
  const landing = hitch.clone().lerp(root, 0.1);
  landing.y = Math.min(hitch.y, groundY + rise * 0.88);
  const points = [root, approach, landing, ...surfacePoints];

  if (peelStartIndex >= 0) peelStartIndex += 3;
  if (points.length < 4) return null;

  return {
    curve: new THREE.CatmullRomCurve3(points, false, 'centripetal'),
    debug: {
      index: coilIndex,
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
      u: uStart,
      coilIndex,
      coilsOnCapsule,
      surfaceSnapCount,
      surfaceSampleCount: surfacePoints.length,
      wrapStyle,
      ringCount: wrapStyle === 'stacked-rings' ? ringCount : 0,
    },
  };
}

/**
 * Build helix wrap curves across limb capsules with pitch-based coil stacking.
 */
export function buildWrapCurves({
  hosts,
  count = 120,
  bodyRatio = 0.65,
  seed = 0,
  sampleCount = 18,
  stepLength = 0.12,
  stationJitter = 0,
  turns = 1,
  climbBias = 0.55,
  clearGap = 0.007,
  peelAt = 1,
  maxCoilsPerCapsule = 8,
  debugSingleHelix = false,
  debugCapsuleId = 'calf.r',
  wrapStyle = 'helix',
  ringCount = 5,
  ringAxialWidth = 0.012,
  enabledCapsuleIds = null,
  ringEntrySide = 'underside',
  ringEntrySideBias = 1,
  ringArcDegrees = 360,
  rootBendStrength = 0.55,
} = {}) {
  const out = [];
  const bodyHost = hosts.find((h) => h.id === 'body');
  const packHost = hosts.find((h) => h.id === 'backpack');
  const bodyRight = bodyHost?.bodyRight?.clone?.()
    ?? new THREE.Vector3(1, 0, 0);

  const bodyCount = bodyHost
    ? Math.round(count * THREE.MathUtils.clamp(bodyRatio, 0, 1))
    : 0;
  const packCount = count - bodyCount;

  const spawnHelixCoils = (host, capsules, budget, typeOffset) => {
    if (!host?.bvh || !capsules?.length || budget < 1) return 0;

    const groundY = 0;
    const scaled = capsules;

    if (debugSingleHelix && typeOffset === 0 && wrapStyle === 'independent-rings') {
      const target = scaled.find((c) => c.id === debugCapsuleId) ?? scaled[0];
      if (!target) return 0;
      const countOnTarget = THREE.MathUtils.clamp(Math.floor(ringCount), 1, 12);
      let spawned = 0;
      for (let ringIndex = 0; ringIndex < countOnTarget; ringIndex += 1) {
        const station = countOnTarget === 1
          ? 0.08
          : THREE.MathUtils.lerp(0.08, 0.9, ringIndex / (countOnTarget - 1));
        const tendrilSeed = seed * 97 + typeOffset * 131 + ringIndex * 17 + 3;
        const built = buildIndependentRingCurve({
          capsule: target,
          bvh: host.bvh,
          bodyRight: host.bodyRight ?? bodyRight,
          groundY,
          seed: tendrilSeed,
          u: station,
          sampleCount: Math.max(24, Math.floor(sampleCount / countOnTarget)),
          clearGap,
          ringIndex,
          ringCount: countOnTarget,
          entrySide: ringEntrySide,
          entrySideBias: ringEntrySideBias,
          arcDegrees: ringArcDegrees,
          rootBendStrength,
        });
        if (!built) continue;
        out.push({
          seed: tendrilSeed,
          hostId: host.id,
          capsuleId: target.id,
          ringIndex,
          curve: built.curve,
          debug: built.debug,
        });
        spawned += 1;
      }
      return spawned;
    }

    let slots = allocateHelixCoils(scaled, stepLength, {
      maxCoilsPerCapsule,
      totalBudget: budget,
    });

    if (debugSingleHelix && typeOffset === 0) {
      const target = scaled.find((c) => c.id === debugCapsuleId) ?? scaled[0];
      if (target) {
        slots = [{
          capsule: target,
          coilIndex: 0,
          coilsOnCapsule: 1,
          // Start near the ankle/wrist end (`a`) and grow toward the torso (`b`).
          uStart: 0.08,
        }];
      }
    }

    if (wrapStyle === 'independent-rings') {
      let spawned = 0;
      for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        const tendrilSeed = seed * 97 + typeOffset * 131 + i * 17 + 3;
        const stationRng = seededRng(tendrilSeed + 7919);
        const cellHalfWidth = 0.45 / Math.max(slot.coilsOnCapsule, 1);
        const stationOffset = (stationRng() * 2 - 1)
          * cellHalfWidth
          * THREE.MathUtils.clamp(stationJitter, 0, 1);
        const station = THREE.MathUtils.clamp(slot.uStart + stationOffset, 0.04, 0.96);
        const built = buildIndependentRingCurve({
          capsule: slot.capsule,
          bvh: host.bvh,
          bodyRight: host.bodyRight ?? bodyRight,
          groundY,
          seed: tendrilSeed,
          u: station,
          sampleCount: Math.max(24, sampleCount),
          clearGap,
          ringIndex: slot.coilIndex,
          ringCount: slot.coilsOnCapsule,
          entrySide: ringEntrySide,
          entrySideBias: ringEntrySideBias,
          arcDegrees: ringArcDegrees,
          rootBendStrength,
        });
        if (!built) continue;
        out.push({
          seed: tendrilSeed,
          hostId: host.id,
          capsuleId: slot.capsule.id,
          ringIndex: slot.coilIndex,
          curve: built.curve,
          debug: built.debug,
        });
        spawned += 1;
      }
      return spawned;
    }

    let spawned = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const tendrilSeed = seed * 97 + typeOffset * 131 + i * 17 + 3;
      const built = buildHelixWrapCurve({
        capsule: slot.capsule,
        bvh: host.bvh,
        bodyRight: host.bodyRight ?? bodyRight,
        groundY,
        seed: tendrilSeed,
        sampleCount,
        turns,
        helixPitch: debugSingleHelix ? slot.capsule.length * 0.82 : stepLength,
        climbBias: debugSingleHelix ? 1 : climbBias,
        clearGap,
        peelAt,
        uStart: slot.uStart,
        coilIndex: slot.coilIndex,
        coilsOnCapsule: slot.coilsOnCapsule,
        wrapStyle,
        ringCount,
        ringAxialWidth,
      });
      if (!built) continue;
      out.push({
        seed: tendrilSeed,
        hostId: host.id,
        capsuleId: slot.capsule.id,
        curve: built.curve,
        debug: built.debug,
      });
      spawned += 1;
    }
    return spawned;
  };

  if (bodyHost && bodyCount > 0) {
    // A whole-body AABB hides rig extraction failures and cannot express
    // sleeve / trouser-leg direction. Body wraps require directed regions.
    const enabled = enabledCapsuleIds ? new Set(enabledCapsuleIds) : null;
    const capsules = (bodyHost.capsules ?? []).filter((capsule) => (
      !enabled || enabled.has(capsule.id)
    ));
    spawnHelixCoils(bodyHost, capsules, bodyCount, 0);
  }

  if (packHost && packCount > 0) {
    const packCaps = packHost.capsules?.length
      ? packHost.capsules
      : (() => {
        const c = capsuleFromBox(packHost.localBox, 'backpack');
        return c ? [c] : [];
      })();
    spawnHelixCoils(
      { ...packHost, bodyRight },
      packCaps,
      packCount,
      1,
    );
  }

  return out;
}

/** @deprecated Use buildHelixWrapCurve */
export function buildCapsuleWrapCurve(args) {
  return buildHelixWrapCurve({
    ...args,
    helixPitch: args.helixPitch ?? args.stepLength ?? 0.12,
    uStart: args.u ?? args.uStart ?? 0.5,
    coilIndex: args.index ?? 0,
    coilsOnCapsule: args.total ?? 1,
  });
}
