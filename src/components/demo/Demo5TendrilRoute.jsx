import { useEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { folder, useControls } from 'leva';
import * as THREE from 'three/webgpu';
import { Character } from '../character/Character';
import {
  buildGroundedSurfaceRoutes,
  roundedSurfacePolylineCurve,
} from '../plants/climb/surfaceRoutes';
import {
  buildIndependentWrapCurve,
} from '../plants/climb/buildWrapCurve';
import { TENDRIL_ROLE } from '../plants/climb/climbRoles';
import { treeSegmentGrowth } from '../plants/climb/climbLifecycle';
import { CLIMB_DEFAULTS } from '../plants/climb/climbDefaults';
import { createBatchedStemMaterial, createFlowerUniforms } from '../plants/look/createFlowerMaterials';
import { FLOWER_DEFAULTS } from '../plants/look/flowerDefaults';
import {
  buildPackedStemTubes,
  GROWTH_START_SCALE,
} from '../plants/stem/buildStemTube';
import { enablePlantShadowLayer } from '../scene/plantShadowLayer';

const GROUND_Y = 0;
const SURFACE_OFFSET = 0.018;
const TARGET_ID = 'demo-right-calf-target';
const GROUND_ROUTE_COLOR = '#c77dff';

const _point = new THREE.Vector3();
const _candidate = new THREE.Vector3();
const _center = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _lateral = new THREE.Vector3();
const _hit = {};
const _up = new THREE.Vector3(0, 1, 0);
const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();

const TUBE_SEGMENTS = 60;
const TUBE_RADIAL_SEGMENTS = 5;

function BodyRegionHelper({ capsule, visible }) {
  const transform = useMemo(() => {
    if (!capsule) return null;
    const direction = new THREE.Vector3().subVectors(capsule.b, capsule.a);
    const length = direction.length();
    if (length < 1e-6) return null;
    direction.multiplyScalar(1 / length);
    return {
      position: capsule.a.clone().lerp(capsule.b, 0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(_up, direction),
      length,
      arrowPosition: capsule.a.clone().lerp(capsule.b, 0.78),
      markerRadius: Math.min(capsule.radius * 0.22, 0.012),
    };
  }, [capsule]);

  if (!visible || !transform) return null;
  return (
    <group name="Demo5CalfRegion">
      <mesh
        position={transform.position.toArray()}
        quaternion={transform.quaternion}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.0015, 0.0015, transform.length, 5, 1, false]} />
        <meshBasicMaterial
          color="#000000"
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.72}
        />
      </mesh>
      <mesh position={capsule.a.toArray()} frustumCulled={false}>
        <sphereGeometry args={[transform.markerRadius, 10, 10]} />
        <meshBasicMaterial
          color="#ffd166"
          depthTest={false}
          depthWrite={false}
          wireframe
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh position={capsule.b.toArray()} frustumCulled={false}>
        <sphereGeometry args={[transform.markerRadius, 10, 10]} />
        <meshBasicMaterial
          color="#06d6a0"
          depthTest={false}
          depthWrite={false}
          wireframe
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh
        position={transform.arrowPosition.toArray()}
        quaternion={transform.quaternion}
        frustumCulled={false}
      >
        <coneGeometry args={[transform.markerRadius * 0.75, transform.markerRadius * 1.8, 10]} />
        <meshBasicMaterial
          color="#ffffff"
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function DemoPathRibbon({
  curve,
  color,
  visible,
  opacity = 0.9,
  depthTest = true,
  renderOrder = depthTest ? 20 : 10,
}) {
  const meshRef = useRef(null);
  const points = useMemo(
    () => (curve ? curve.getSpacedPoints(96) : []),
    [curve],
  );
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const positions = new Float32Array(points.length * 2 * 3);
    const indices = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = i * 2;
      const b = a + 2;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    next.setIndex(indices);
    return next;
  }, [points]);
  const { camera, size } = useThree();

  useFrame(() => {
    if (!visible || !geometry || points.length < 2) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.updateWorldMatrix(true, false);
    const worldToLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const position = geometry.getAttribute('position');
    const side = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const view = new THREE.Vector3();
    const left = new THREE.Vector3();
    const right = new THREE.Vector3();
    const worldPoint = new THREE.Vector3();
    const previousWorld = new THREE.Vector3();
    const nextWorld = new THREE.Vector3();
    const pixelWidth = 1.5;
    const halfHeight = Math.max(size.height, 1) * 0.5;
    const fovRadians = THREE.MathUtils.degToRad(camera.fov ?? 45);

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const previous = points[Math.max(i - 1, 0)];
      const next = points[Math.min(i + 1, points.length - 1)];
      worldPoint.copy(point).applyMatrix4(mesh.matrixWorld);
      previousWorld.copy(previous).applyMatrix4(mesh.matrixWorld);
      nextWorld.copy(next).applyMatrix4(mesh.matrixWorld);
      tangent.subVectors(nextWorld, previousWorld);
      if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0);
      else tangent.normalize();
      view.subVectors(camera.position, worldPoint).normalize();
      side.crossVectors(tangent, view);
      if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
      else side.normalize();

      const distance = worldPoint.distanceTo(camera.position);
      const halfWidth = camera.isPerspectiveCamera
        ? distance * Math.tan(fovRadians * 0.5) * pixelWidth / halfHeight
        : pixelWidth / Math.max(size.height, 1);
      left.copy(worldPoint).addScaledVector(side, halfWidth).applyMatrix4(worldToLocal);
      right.copy(worldPoint).addScaledVector(side, -halfWidth).applyMatrix4(worldToLocal);
      position.setXYZ(i * 2, left.x, left.y, left.z);
      position.setXYZ(i * 2 + 1, right.x, right.y, right.z);
    }
    position.needsUpdate = true;
  });

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!visible || !geometry) return null;
  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false} renderOrder={renderOrder}>
      <meshBasicMaterial
        color={color}
        side={THREE.DoubleSide}
        depthTest={depthTest}
        depthWrite={false}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

function DemoMarker({
  point,
  color,
  label,
  radius,
  visible,
  labelVisible,
  renderOrder = 30,
  labelColor = '#ffffff',
  labelOffset = [0, 0, 0],
}) {
  if (!point || !visible) return null;
  return (
    <group position={point}>
      <mesh renderOrder={renderOrder}>
        <sphereGeometry args={[radius, 8, 8]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.9}
        />
      </mesh>
      {labelVisible && (
        <Html
          center
          position={labelOffset}
          distanceFactor={1.2}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              color: labelColor,
              fontFamily: 'Cousine, monospace',
              fontSize: '7px',
              letterSpacing: '0.035em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

function CandidateSampleDots({ points, visible }) {
  if (!visible || !points?.length) return null;
  return (
    <group name="Demo5WrapCandidateSamples">
      {points.map((point, index) => {
        if (index % 4 !== 0 && index !== points.length - 1) return null;
        return (
          <mesh key={`candidate-${index}`} position={point} frustumCulled={false} renderOrder={11}>
            <sphereGeometry args={[0.004, 6, 6]} />
            <meshBasicMaterial
              color="#ff9f1c"
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.9}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function SnappedWrapSampleDots({ points, visible }) {
  if (!visible || !points?.length) return null;
  return (
    <group name="Demo5SnappedWrapSamples">
      {points.map((point, index) => {
        if (index % 4 !== 0 && index !== points.length - 1) return null;
        return (
          <mesh key={`snapped-wrap-${index}`} position={point} frustumCulled={false} renderOrder={21}>
            <sphereGeometry args={[0.005, 7, 7]} />
            <meshBasicMaterial
              color="#7df9ff"
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.95}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function GrowthFront({ segments, speed, visible, labelVisible }) {
  const markerRef = useRef(null);
  const ageRef = useRef(0);
  const route = useMemo(
    () => segments
      .filter((segment) => (
        segment?.curve
        && Number.isFinite(segment.pathStartDistance)
        && Number.isFinite(segment.pathEndDistance)
        && segment.pathEndDistance > segment.pathStartDistance
      ))
      .sort((left, right) => left.pathStartDistance - right.pathStartDistance),
    [segments],
  );
  const totalDistance = route.length
    ? Math.max(...route.map((segment) => segment.pathEndDistance))
    : 0;

  useEffect(() => {
    ageRef.current = 0;
  }, [route, visible]);

  useFrame((_, delta) => {
    if (!markerRef.current || !visible || totalDistance <= 0) return;
    ageRef.current = (ageRef.current + delta * speed) % totalDistance;
    const distance = ageRef.current;
    let segment = route[route.length - 1];
    for (let i = 0; i < route.length; i += 1) {
      if (distance <= route[i].pathEndDistance) {
        segment = route[i];
        break;
      }
    }
    const span = Math.max(segment.pathEndDistance - segment.pathStartDistance, 1e-6);
    const t = THREE.MathUtils.clamp(
      (distance - segment.pathStartDistance) / span,
      0,
      1,
    );
    segment.curve.getPointAt(t, _point);
    markerRef.current.position.copy(_point);
  });

  if (!visible || !route.length) return null;
  return (
    <mesh ref={markerRef}>
      <sphereGeometry args={[0.012, 8, 8]} />
      <meshBasicMaterial
        color="#fff1a8"
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.9}
      />
      {labelVisible && (
        <Html center distanceFactor={1.2} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              color: '#fff1a8',
              fontFamily: 'Cousine, monospace',
              fontSize: '7px',
              letterSpacing: '0.03em',
              whiteSpace: 'nowrap',
            }}
          >
            growth front
          </div>
        </Html>
      )}
    </mesh>
  );
}

function createDemoPlantDataTexture(count) {
  const width = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(count));
  const data = new Float32Array(width * 4);
  const tex = new THREE.DataTexture(
    data,
    width,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, data, width };
}

function applyDemoStemLookDefaults(uniforms) {
  const defaults = FLOWER_DEFAULTS.stem;
  const { stem } = uniforms;
  stem.colorLevels.value = defaults.colorLevels;
  stem.thresholdLow.value = defaults.thresholdLow;
  stem.thresholdHigh.value = defaults.thresholdHigh;
  stem.shadowColor.value.set(defaults.shadowColor);
  stem.highlightColor.value.set(defaults.highlightColor);
  stem.edgeColor.value.set(defaults.edgeColor);
  stem.edgeThreshold.value = defaults.edgeThreshold;
  stem.edgeSoftness.value = defaults.edgeSoftness;
}

function DemoAnimatedTendril({ segments, visible, animate, speed }) {
  const flowerUniforms = useMemo(() => {
    const uniforms = createFlowerUniforms();
    applyDemoStemLookDefaults(uniforms);
    return uniforms;
  }, []);
  const build = useMemo(() => {
    const ordered = (segments ?? [])
      .filter((segment) => (
        segment?.curve
        && Number.isFinite(segment.pathStartDistance)
        && Number.isFinite(segment.pathEndDistance)
        && segment.pathEndDistance > segment.pathStartDistance
      ))
      .sort((left, right) => left.pathStartDistance - right.pathStartDistance);
    if (!ordered.length) {
      return {
        geometry: null,
        plantData: null,
        segments: [],
        totalDistance: 0,
      };
    }

    const totalDistance = Math.max(
      ...ordered.map((segment) => segment.pathEndDistance),
    );
    const radiusAtDistance = (distance) => THREE.MathUtils.lerp(
      1,
      CLIMB_DEFAULTS.radiusAttenuation,
      THREE.MathUtils.clamp(distance / Math.max(totalDistance, 1e-6), 0, 1),
    );
    const packed = ordered.map((segment, plantId) => ({
      curve: segment.curve,
      plantId,
      radiusStartScale: radiusAtDistance(segment.pathStartDistance),
      radiusEndScale: radiusAtDistance(segment.pathEndDistance),
      baseFlareScale: segment.pathStartDistance <= 1e-6 ? 1 : 0,
    }));
    const geometry = buildPackedStemTubes(packed, {
      stemRadius: CLIMB_DEFAULTS.tendrilRadius,
      stemSegments: TUBE_SEGMENTS,
      radialSegs: TUBE_RADIAL_SEGMENTS,
      radiusAttenuation: CLIMB_DEFAULTS.radiusAttenuation,
      baseFlare: CLIMB_DEFAULTS.baseFlare,
    });
    if (!geometry) {
      return {
        geometry: null,
        plantData: null,
        segments: [],
        totalDistance: 0,
      };
    }
    return {
      geometry,
      plantData: createDemoPlantDataTexture(ordered.length),
      segments: ordered,
      totalDistance,
    };
  }, [segments]);
  const material = useMemo(() => {
    if (!build.plantData) return null;
    return createBatchedStemMaterial(flowerUniforms, {
      plantDataTexture: build.plantData.tex,
      texWidth: build.plantData.width,
      maskPow: 2,
      startScale: GROWTH_START_SCALE,
      growthSegments: TUBE_SEGMENTS,
    });
  }, [build.plantData, flowerUniforms]);
  const growthFrontRef = useRef(0);
  const lightRef = useRef(null);

  useEffect(() => {
    growthFrontRef.current = 0;
  }, [build, animate]);

  useEffect(() => () => {
    build.geometry?.dispose();
    build.plantData?.tex.dispose();
  }, [build]);

  useEffect(() => () => material?.dispose(), [material]);

  useFrame(({ scene }, delta) => {
    if (!build.plantData || !build.segments.length) return;

    if (!lightRef.current) {
      scene.traverse((object) => {
        if (!lightRef.current && object.isDirectionalLight) lightRef.current = object;
      });
    }
    const light = lightRef.current;
    if (light) {
      light.updateWorldMatrix(true, false);
      light.target.updateWorldMatrix(true, false);
      light.getWorldPosition(_lightWorld);
      light.target.getWorldPosition(_lightTarget);
      flowerUniforms.lightDir.value.copy(
        _lightWorld.sub(_lightTarget).normalize(),
      );
    }

    if (animate) {
      growthFrontRef.current = (
        growthFrontRef.current + Math.min(delta, 0.1) * speed
      ) % Math.max(build.totalDistance, 1e-6);
    } else {
      growthFrontRef.current = build.totalDistance;
    }

    const { data, tex } = build.plantData;
    for (let i = 0; i < build.segments.length; i += 1) {
      const segment = build.segments[i];
      const offset = i * 4;
      data[offset] = treeSegmentGrowth(
        growthFrontRef.current,
        segment.pathStartDistance,
        segment.pathEndDistance,
      );
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
    tex.needsUpdate = true;
  });

  if (!visible || !build.geometry || !material) return null;
  return (
    <mesh
      ref={enablePlantShadowLayer}
      geometry={build.geometry}
      material={material}
      frustumCulled={false}
      castShadow
      receiveShadow
    />
  );
}

function projectRightLegStation(bodyBounds, capsule, stationU) {
  _axis.subVectors(capsule.b, capsule.a);
  const length = _axis.length();
  if (length < 1e-6) return null;
  _axis.multiplyScalar(1 / length);

  _lateral.copy(bodyBounds.bodyRight ?? new THREE.Vector3(1, 0, 0));
  _lateral.addScaledVector(_axis, -_lateral.dot(_axis));
  if (_lateral.lengthSq() < 1e-8) return null;
  _lateral.normalize();

  _center.copy(capsule.a).addScaledVector(
    _axis,
    THREE.MathUtils.clamp(stationU, capsule.uMin ?? 0.02, capsule.uMax ?? 0.98)
      * length,
  );
  _candidate.copy(_center).addScaledVector(_lateral, capsule.radius * 1.35);
  const closest = bodyBounds.bvh.closestPointToPoint(_candidate, _hit, 0, Infinity);
  return closest?.point?.clone() ?? null;
}

function retargetWrapStart({
  surfacePoints,
  graphHitch,
  bvh,
  capsuleRadius,
  surfaceOffset,
  fallbackOutward,
}) {
  if (!surfacePoints?.length || !graphHitch || !bvh) return null;
  const points = surfacePoints.map((point) => point.clone());
  const delta = graphHitch.clone().sub(points[0]);
  const localTolerance = Math.max(capsuleRadius * 0.7, 0.035);
  const maxHitchShift = Math.max(capsuleRadius * 0.5, 0.03);
  const maxSurfaceDrift = Math.max(capsuleRadius * 0.35, 0.022);
  if (delta.length() > maxHitchShift) return null;
  const blendCount = Math.min(8, points.length);
  const outward = new THREE.Vector3();

  for (let i = 0; i < blendCount; i += 1) {
    const phase = blendCount > 1 ? i / (blendCount - 1) : 1;
    const weight = (1 - phase) ** 2;
    points[i].addScaledVector(delta, weight);
    if (i === 0) {
      points[i].copy(graphHitch);
      continue;
    }

    const closest = bvh.closestPointToPoint(points[i], _hit, 0, localTolerance);
    if (!closest?.point) return null;
    outward.subVectors(points[i], closest.point);
    if (outward.lengthSq() < 1e-10) outward.copy(fallbackOutward ?? _up);
    if (outward.lengthSq() < 1e-10) outward.copy(_up);
    outward.normalize();
    _candidate.copy(closest.point).addScaledVector(outward, surfaceOffset);

    // A global closest-point query can walk onto a neighboring garment layer
    // one locally valid step at a time. Retargeting is optional, so abandon it
    // if any blended point leaves the original wrap surface neighborhood.
    if (_candidate.distanceTo(surfacePoints[i]) > maxSurfaceDrift) return null;
    const originalStep = surfacePoints[i].distanceTo(surfacePoints[i - 1]);
    const allowedStep = Math.max(originalStep * 3, 0.03);
    if (_candidate.distanceTo(points[i - 1]) > allowedStep) return null;
    points[i].copy(_candidate);
  }

  points[0].copy(graphHitch);
  return {
    points,
    curve: new THREE.CatmullRomCurve3(points, false, 'centripetal'),
  };
}

function buildRightLegRoute(bodyBounds, controls) {
  if (!bodyBounds?.bvh || !bodyBounds.geometry) return null;
  const capsule = bodyBounds.capsules?.find((item) => item.id === 'calf.r');
  if (!capsule) return null;

  const bodyRight = bodyBounds.bodyRight?.clone() ?? new THREE.Vector3(1, 0, 0);
  const station = projectRightLegStation(bodyBounds, capsule, controls.stationU);
  if (!station) return null;

  const built = buildIndependentWrapCurve({
    capsule,
    bvh: bodyBounds.bvh,
    bodyRight,
    groundY: GROUND_Y,
    seed: controls.layoutSeed,
    u: controls.stationU,
    curveSamples: 48,
    surfaceOffset: controls.surfaceOffset,
    entrySide: 'outer',
    entrySideBias: 1,
    wrapAngleDegrees: controls.wrapAngle,
    // Keep the teaching preview on one capsule cross-section so the
    // candidate sweep reads as a circular arc around the guide.
    axialWeave: 0,
    entryBend: 0.55,
    coverageTarget: station,
    maxFreeAirDistance: -1,
    debugOnFailure: true,
  });
  if (!built?.debug?.shellPoints?.length) return null;

  const preview = {
    candidateCurve: built.debug.shellPoints.length > 1
      ? new THREE.CatmullRomCurve3(built.debug.shellPoints, false, 'centripetal')
      : null,
    candidatePoints: built.debug.shellPoints,
    snappedWrapPoints: built.debug.surfacePoints ?? [],
    capsule,
    station,
    hitch: built.debug.hitch?.clone() ?? null,
    segments: [],
  };
  if (!built.debug.hitch || !built.curve) return preview;

  const host = {
    id: 'demo-character-body',
    bvh: bodyBounds.bvh,
    geometry: bodyBounds.geometry,
    localBox: bodyBounds.localBox,
    bodyRight,
    capsules: [capsule],
    profile: { surfaceOffsetScale: 1, wrapAngleScale: 1 },
  };
  const routed = buildGroundedSurfaceRoutes({
    host,
    targets: [{ id: TARGET_ID, point: built.debug.hitch.clone() }],
    groundY: GROUND_Y,
    surfaceOffset: controls.surfaceOffset,
  });
  if (!routed.reached.has(TARGET_ID)) return preview;

  const targetDistance = routed.targetDistances.get(TARGET_ID) ?? 0;
  const graphHitch = routed.targetGraphPoints?.get(TARGET_ID) ?? null;
  const retargetedWrap = controls.hitchOnGraphVertex && graphHitch
    ? retargetWrapStart({
      surfacePoints: built.debug.surfacePoints,
      graphHitch,
      bvh: bodyBounds.bvh,
      capsuleRadius: capsule.radius,
      surfaceOffset: controls.surfaceOffset,
      fallbackOutward: built.debug.outward,
    })
    : null;
  const finalHitch = retargetedWrap ? graphHitch.clone() : built.debug.hitch.clone();
  const finalWrapCurve = retargetedWrap?.curve ?? built.curve;
  const finalWrapPoints = retargetedWrap?.points ?? built.debug.surfacePoints;
  let wrapStartDistance = targetDistance;

  let routeSegments = routed.routes.map((route) => ({
    role: TENDRIL_ROLE.GROUND_PATH,
    kind: route.kind,
    curve: route.curve,
    pathStartDistance: route.startDistance,
    pathEndDistance: route.endDistance,
    debug: { points: route.points },
  }));

  if (!retargetedWrap) {
    const attachment = routed.targetAttachments.get(TARGET_ID);
    if (!attachment?.length) return preview;
    const attachmentCurve = roundedSurfacePolylineCurve(attachment);
    if (!attachmentCurve) return preview;
    const attachmentLength = attachmentCurve.getLength();
    wrapStartDistance += attachmentLength;

    // The graph route ends at the graph node nearest the hitch. Merge its
    // attachment into one ribbon for the demo, otherwise two ribbon meshes
    // overlap at that endpoint and look like a fork or a broken line.
    const attachmentStart = attachment[0];
    let attachmentRouteIndex = -1;
    let attachmentRouteDistance = Infinity;
    for (let i = 0; i < routed.routes.length; i += 1) {
      const routeEnd = routed.routes[i].points?.[routed.routes[i].points.length - 1];
      if (!routeEnd) continue;
      const distance = routeEnd.distanceToSquared(attachmentStart);
      if (distance < attachmentRouteDistance) {
        attachmentRouteDistance = distance;
        attachmentRouteIndex = i;
      }
    }

    routeSegments = routed.routes.map((route, index) => {
      if (index !== attachmentRouteIndex) {
        return {
          role: TENDRIL_ROLE.GROUND_PATH,
          kind: route.kind,
          curve: route.curve,
          pathStartDistance: route.startDistance,
          pathEndDistance: route.endDistance,
          debug: { points: route.points },
        };
      }
      const mergedPoints = [...route.points, ...attachment.slice(1)];
      const mergedCurve = roundedSurfacePolylineCurve(mergedPoints);
      if (!mergedCurve) {
        return {
          role: TENDRIL_ROLE.GROUND_PATH,
          kind: route.kind,
          curve: route.curve,
          pathStartDistance: route.startDistance,
          pathEndDistance: route.endDistance,
          debug: { points: route.points },
        };
      }
      return {
        role: TENDRIL_ROLE.GROUND_PATH,
        kind: route.kind,
        curve: mergedCurve,
        pathStartDistance: route.startDistance,
        pathEndDistance: route.endDistance + attachmentLength,
        debug: { points: mergedPoints },
      };
    });
  }

  return {
    ...preview,
    hitch: finalHitch,
    snappedWrapPoints: finalWrapPoints,
    segments: [
      ...routeSegments,
      {
        role: TENDRIL_ROLE.WRAP,
        curve: finalWrapCurve,
        pathStartDistance: wrapStartDistance,
        pathEndDistance: wrapStartDistance + finalWrapCurve.getLength(),
        debug: {
          ...built.debug,
          hitch: finalHitch.clone(),
          points: finalWrapPoints,
          surfacePoints: finalWrapPoints,
        },
      },
    ],
  };
}

/** One fixed point on the astronaut's right calf, routed through the real suit mesh. */
export function Demo5TendrilRoute() {
  const controls = useControls('Demo / Right Leg Tendril', {
    Display: folder({
      showCharacter: { value: true, label: 'character' },
      showHost: { value: false, label: 'host wireframe' },
      showRegion: { value: true, label: 'calf.r region' },
      showStation: { value: true, label: 'wrap station' },
      showWrapCandidate: { value: true, label: 'pre-snap capsule sweep' },
      showWrap: { value: true, label: 'wrap curve' },
      showHitch: { value: true, label: 'hitch' },
      showGroundPath: { value: true, label: 'ground route' },
      showRenderedTendril: { value: true, label: 'rendered tendril' },
      showGrowthFront: { value: true, label: 'growth front' },
      showLabels: { value: false, label: 'labels' },
    }, { collapsed: false }),
    RightLeg: folder({
      stationU: { value: 0.58, min: 0.08, max: 0.92, step: 0.01, label: 'station u' },
      layoutSeed: { value: 12, min: 0, max: 999, step: 1, label: 'station seed' },
      wrapAngle: { value: 190, min: 90, max: 360, step: 1, label: 'wrap angle' },
      surfaceOffset: { value: SURFACE_OFFSET, min: 0.005, max: 0.05, step: 0.001 },
      hitchOnGraphVertex: { value: true, label: 'hitch on graph vertex' },
    }, { collapsed: false }),
    Growth: folder({
      animate: { value: true },
      speed: { value: 0.12, min: 0.02, max: 0.8, step: 0.01 },
    }, { collapsed: true }),
  });

  const parentRef = useRef(null);
  const [bodyBounds, setBodyBounds] = useState(null);
  const route = useMemo(
    () => buildRightLegRoute(bodyBounds, controls),
    [
      bodyBounds,
      controls.layoutSeed,
      controls.stationU,
      controls.surfaceOffset,
      controls.wrapAngle,
      controls.hitchOnGraphVertex,
    ],
  );
  const groundRoot = route?.segments.find((segment) => segment.role === TENDRIL_ROLE.GROUND_PATH)
    ?.debug?.points?.[0] ?? null;

  return (
    <group ref={parentRef} name="Demo5RightLegTendril">
      <Character
        position={[0, 0.6, 0]}
        scale={1.5}
        visible={controls.showCharacter}
        fieldParentRef={parentRef}
        onBounds={setBodyBounds}
      />

      {bodyBounds && (
        <mesh geometry={bodyBounds.geometry} visible={controls.showHost} dispose={null}>
          <meshBasicMaterial
            color="#ffe66d"
            wireframe
            transparent
            opacity={0.12}
            depthWrite={false}
          />
        </mesh>
      )}

      <BodyRegionHelper
        capsule={route?.capsule}
        visible={controls.showRegion}
      />

      <DemoPathRibbon
        curve={route?.candidateCurve}
        color="#ff9f1c"
        opacity={0.65}
        depthTest={false}
        renderOrder={10}
        visible={controls.showWrapCandidate}
      />
      <CandidateSampleDots
        points={route?.candidatePoints}
        visible={controls.showWrapCandidate}
      />
      <SnappedWrapSampleDots
        points={route?.snappedWrapPoints}
        visible={controls.showWrap}
      />

      <mesh position={[0, GROUND_Y - 0.012, 0]} rotation={[-Math.PI * 0.5, 0, 0]} receiveShadow>
        <circleGeometry args={[1.5, 64]} />
        <meshStandardMaterial color="#d8c6a5" roughness={1} />
      </mesh>

      {route?.segments.map((segment, index) => {
        const isGroundPath = segment.role === TENDRIL_ROLE.GROUND_PATH;
        return (
          <DemoPathRibbon
            key={`${segment.role}-${index}`}
            curve={segment.curve}
            color={isGroundPath ? GROUND_ROUTE_COLOR : '#2ec4b6'}
            renderOrder={isGroundPath ? 15 : 20}
            visible={isGroundPath ? controls.showGroundPath : controls.showWrap}
          />
        );
      })}

      <DemoAnimatedTendril
        segments={route?.segments ?? []}
        visible={controls.showRenderedTendril}
        animate={controls.animate}
        speed={controls.speed}
      />

      <DemoMarker
        point={groundRoot}
        color={GROUND_ROUTE_COLOR}
        label="ground root"
        radius={0.012}
        visible={controls.showGroundPath}
        labelVisible={controls.showLabels}
        labelColor="#ffffff"
        labelOffset={[0, 0, 0]}
      />
      <DemoMarker
        point={route?.station}
        color="#ffe66d"
        label="wrap station"
        radius={0.006}
        visible={controls.showStation}
        labelVisible={controls.showLabels}
        labelColor="#ffffff"
        labelOffset={[0, 0, 0]}
      />
      <DemoMarker
        point={route?.hitch}
        color="#ff006e"
        label="hitch"
        radius={0.008}
        visible={controls.showHitch}
        labelVisible={controls.showLabels}
        renderOrder={30}
        labelColor="#ffffff"
        labelOffset={[0, 0, 0]}
      />
      <GrowthFront
        segments={route?.segments ?? []}
        speed={controls.speed}
        visible={controls.animate && controls.showGrowthFront}
        labelVisible={controls.showLabels}
      />
    </group>
  );
}
