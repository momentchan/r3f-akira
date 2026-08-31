import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { annotateWrapClearance } from './buildWrapCurve';
import { TENDRIL_ROLE } from './climbRoles';

const AXIS_LEN = 0.09;
const SEED_R = 0.012;
const HITCH_R = 0.008;
const STATION_R = 0.006;

const STATION_COLOR = '#ffe66d';
const ROUTE_TARGET_COLOR = '#ff006e';
const CLEARANCE_CHUNK_SIZE = 1;
const DEBUG_TUBE_SEGMENTS_MAX = 16;
const DEBUG_TUBE_RADIAL_SEGMENTS = 2;

function SegmentLine({
  a,
  b,
  color = '#ffffff',
  opacity = 0.85,
  depthTest = false,
}) {
  const transform = useMemo(() => {
    if (!a || !b) return null;
    const direction = new THREE.Vector3().subVectors(b, a);
    const length = direction.length();
    if (length < 1e-6) return null;
    direction.multiplyScalar(1 / length);
    return {
      position: new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction,
      ),
      length,
    };
  }, [a, b]);

  if (!transform) return null;

  return (
    <mesh
      position={transform.position.toArray()}
      quaternion={transform.quaternion}
      frustumCulled={false}
    >
      <cylinderGeometry args={[0.0015, 0.0015, transform.length, 5, 1, false]} />
      <meshBasicMaterial
        color={color}
        depthTest={depthTest}
        depthWrite={false}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

function DirArrow({ from, dir, length, color }) {
  const to = useMemo(() => {
    if (!from || !dir) return null;
    return from.clone().addScaledVector(dir, length);
  }, [from, dir, length]);
  return <SegmentLine a={from} b={to} color={color} opacity={0.95} />;
}

function DebugMarker({ point, radius, color, wireframe = false, opacity = 0.9 }) {
  if (!point) return null;
  return (
    <mesh position={point.toArray()} frustumCulled={false}>
      <sphereGeometry args={[radius, 8, 8]} />
      <meshBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        wireframe={wireframe}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

function DebugMarkerBatch({ points, radius, color, wireframe = false, opacity = 0.9 }) {
  const meshRef = useRef(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(radius, 8, 8), [radius]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    wireframe,
    transparent: true,
    opacity,
  }), [color, opacity, wireframe]);
  const matrix = useMemo(() => new THREE.Matrix4(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < points.length; i += 1) {
      matrix.makeTranslation(points[i].x, points[i].y, points[i].z);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.count = points.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrix, points]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  if (!points.length) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, points.length]}
      frustumCulled={false}
    />
  );
}

function PathPolyline({
  points,
  peelStartIndex = -1,
  color = '#2ec4b6',
  linear = false,
  opacity = 0.9,
}) {
  const curve = useMemo(() => {
    if (!points || points.length < 2) return null;
    if (linear) {
      const path = new THREE.CurvePath();
      for (let i = 1; i < points.length; i += 1) {
        path.add(new THREE.LineCurve3(points[i - 1], points[i]));
      }
      return path;
    }
    return new THREE.CatmullRomCurve3(points, false, 'centripetal');
  }, [points, linear]);

  void peelStartIndex;
  if (!curve) return null;

  return (
    <mesh frustumCulled={false}>
      <tubeGeometry
        args={[
          curve,
          Math.max(Math.min(points.length - 1, DEBUG_TUBE_SEGMENTS_MAX), 8),
          0.0015,
          DEBUG_TUBE_RADIAL_SEGMENTS,
          false,
        ]}
      />
      <meshBasicMaterial
        color={color}
        depthTest
        depthWrite={false}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

function matchesDiagnosticMode(segment, mode) {
  const style = segment.debug?.wrapStyle;
  if (mode === 'invalid') return Boolean(segment.debug?.clearanceExceeded);
  if (mode === 'wraps') return segment.role === TENDRIL_ROLE.WRAP;
  if (mode === 'attachments') {
    return segment.role === TENDRIL_ROLE.WRAP && (segment.debug?.attachmentPointCount ?? 0) > 1;
  }
  if (mode === 'surface-trunks') return style === 'surface-trunk';
  if (mode === 'ground-entries') return style === 'ground-entry';
  return true;
}

function diagnosticSegments(segment, mode) {
  const debug = segment.debug;
  if (!debug?.points?.length) return [];
  if (mode === 'invalid') {
    return [{ points: debug.points, color: '#ff1744', linear: true }];
  }
  if (debug.wrapStyle === 'ground-entry') {
    return mode === 'all' || mode === 'ground-entries'
      ? [{ points: debug.points, color: '#ffd166', linear: true }]
      : [];
  }
  if (debug.wrapStyle === 'surface-trunk') {
    return mode === 'all' || mode === 'surface-trunks'
      ? [{ points: debug.points, color: '#c77dff', linear: true }]
      : [];
  }
  if (segment.role !== TENDRIL_ROLE.WRAP) return [];

  const attachmentCount = debug.attachmentPointCount ?? 0;
  const attachmentPoints = attachmentCount > 1
    ? debug.points.slice(0, attachmentCount)
    : [];
  const wrapArcPoints = attachmentCount > 1
    ? debug.points.slice(attachmentCount - 1)
    : debug.points;
  const segments = [];
  if ((mode === 'all' || mode === 'attachments') && attachmentPoints.length > 1) {
    segments.push({ points: attachmentPoints, color: '#ff9f1c', linear: true });
  }
  if ((mode === 'all' || mode === 'wraps') && wrapArcPoints.length > 1) {
    segments.push({ points: wrapArcPoints, color: '#2ec4b6', linear: false });
  }
  return segments;
}

function HostBounds({ localBox, color }) {
  const { center, size } = useMemo(() => {
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    localBox.getCenter(c);
    localBox.getSize(s);
    return { center: c, size: s };
  }, [localBox]);

  return (
    <mesh position={center.toArray()} frustumCulled={false}>
      <boxGeometry args={[size.x, size.y, size.z]} />
      <meshBasicMaterial
        color={color}
        wireframe
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.35}
      />
    </mesh>
  );
}

function CapsuleHelper({ capsule, color = '#00ffcc' }) {
  const { arrowPosition, arrowQuaternion } = useMemo(() => {
    const direction = new THREE.Vector3().subVectors(capsule.b, capsule.a).normalize();
    return {
      arrowPosition: capsule.a.clone().lerp(capsule.b, 0.78),
      arrowQuaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction,
      ),
    };
  }, [capsule.a, capsule.b]);
  const markerRadius = Math.min(capsule.radius * 0.22, 0.012);

  return (
    <group>
      <SegmentLine a={capsule.a} b={capsule.b} color={color} opacity={1} />
      <mesh position={capsule.a.toArray()} frustumCulled={false}>
        <sphereGeometry args={[markerRadius, 10, 10]} />
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
        <sphereGeometry args={[markerRadius, 10, 10]} />
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
        position={arrowPosition.toArray()}
        quaternion={arrowQuaternion}
        frustumCulled={false}
      >
        <coneGeometry args={[markerRadius * 0.75, markerRadius * 1.8, 10]} />
        <meshBasicMaterial
          color="#ffffff"
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Climb path debug overlays.
 * yellow = ground roots and sampled wrap stations, magenta = route targets
 * teal = wrap samples on surface, orange = route-to-wrap attachments
 * green = climb dir, blue = orbit, red = outward
 * lime wire = limb capsules, cyan/pink boxes = body / backpack AABB
 */
export function ClimbDebug({ visible = false, ...props }) {
  // The overlay is always mounted, and the content's memos walk every wrap and
  // spread every capsule. Splitting the body keeps those hooks from existing at
  // all while it is hidden, which an early return inside them cannot do.
  if (!visible) return null;
  return <ClimbDebugContent {...props} />;
}

function ClimbDebugContent({
  surfaceOffset = 0.007,
  noiseAmount = 0,
  wraps = [],
  hosts = [],
  showSeeds = true,
  showStations = true,
  showRouteTargets = true,
  showHitch = true,
  showPaths = true,
  showDirs = true,
  showBounds = true,
  showCapsules = true,
  diagnosticMode = 'all',
  showClearanceMarkers = true,
  capsuleFilterId = null,
  pathCount = 24,
}) {
  const [clearanceVersion, setClearanceVersion] = useState(0);
  const clearanceRunRef = useRef(0);

  // Clearance is useful for invalid-path diagnostics, but it is expensive:
  // annotateWrapClearance performs about 121 BVH queries per wrap. Spread the
  // scan across animation frames so opening the overlay never blocks camera input.
  useEffect(() => {
    if (!wraps.length || (!showClearanceMarkers && diagnosticMode !== 'invalid')) {
      return undefined;
    }

    const runId = clearanceRunRef.current + 1;
    clearanceRunRef.current = runId;
    let nextIndex = 0;
    let frameId = 0;

    const scanNextChunk = () => {
      if (clearanceRunRef.current !== runId) return;
      const endIndex = Math.min(nextIndex + CLEARANCE_CHUNK_SIZE, wraps.length);
      annotateWrapClearance(wraps, hosts, {
        surfaceOffset,
        noiseAmount,
        startIndex: nextIndex,
        endIndex,
      });
      nextIndex = endIndex;

      if (nextIndex >= wraps.length) {
        setClearanceVersion((version) => version + 1);
        return;
      }
      frameId = window.requestAnimationFrame(scanNextChunk);
    };

    frameId = window.requestAnimationFrame(scanNextChunk);
    return () => {
      clearanceRunRef.current += 1;
      window.cancelAnimationFrame(frameId);
    };
  }, [
    wraps,
    hosts,
    surfaceOffset,
    noiseAmount,
    showClearanceMarkers,
    diagnosticMode,
  ]);

  const subset = useMemo(() => {
    if (!wraps.length) return [];
    const filtered = wraps.filter((wrap) => matchesDiagnosticMode(wrap, diagnosticMode));
    const n = Math.min(Math.max(pathCount, 0), filtered.length);
    if (n >= filtered.length) return filtered;
    const step = filtered.length / n;
    const list = [];
    for (let i = 0; i < n; i += 1) {
      list.push(filtered[Math.min(Math.floor(i * step), filtered.length - 1)]);
    }
    return list;
  }, [wraps, pathCount, diagnosticMode, clearanceVersion]);

  const debugCapsules = useMemo(() => {
    const list = [];
    for (const host of hosts) {
      for (const c of host.capsules ?? []) {
        if (capsuleFilterId && c.id !== capsuleFilterId) continue;
        list.push({
          ...c,
          key: `${host.id}:${c.id}`,
          color: host.id === 'body' ? '#95d5b2' : '#f72585',
        });
      }
    }
    return list;
  }, [hosts, capsuleFilterId]);

  const stationPoints = useMemo(() => subset
    .filter((wrap) => wrap.role === TENDRIL_ROLE.WRAP && wrap.debug?.coverageTarget)
    .map((wrap) => wrap.debug.coverageTarget), [subset]);
  const routeTargetPoints = useMemo(() => subset
    .filter((wrap) => wrap.role === TENDRIL_ROLE.WRAP && wrap.routeTargetId && wrap.debug?.hitch)
    .map((wrap) => wrap.debug.hitch), [subset]);

  return (
    <group name="ClimbDebug">
      {showBounds && hosts.map((host) => (
        <HostBounds
          key={`bounds-${host.id}`}
          localBox={host.localBox}
          color={host.id === 'body' ? '#4cc9f0' : '#f72585'}
        />
      ))}

      {showCapsules && debugCapsules.map((c) => (
        <CapsuleHelper
          key={c.key}
          capsule={c}
          color={c.color}
        />
      ))}

      {showStations && (
        <DebugMarkerBatch
          key={`stations-${stationPoints.length}`}
          points={stationPoints}
          radius={STATION_R}
          color={STATION_COLOR}
          wireframe
        />
      )}
      {showRouteTargets && (
        <DebugMarkerBatch
          key={`route-targets-${routeTargetPoints.length}`}
          points={routeTargetPoints}
          radius={HITCH_R}
          color={ROUTE_TARGET_COLOR}
        />
      )}

      {subset.map((wrap, i) => {
        const d = wrap.debug;
        if (!d) return null;
        const hitch = d.hitch;
        const segments = diagnosticSegments(wrap, diagnosticMode);
        return (
          <group key={`dbg-${wrap.hostId}-${wrap.seed}-${i}`}>
            {showSeeds && d.hitchPre && (
              <DebugMarker
                point={d.hitchPre}
                radius={SEED_R}
                color={STATION_COLOR}
                opacity={0.7}
              />
            )}
            {showSeeds && showHitch && hitch && (
              <DebugMarker
                point={hitch}
                radius={HITCH_R}
                color={ROUTE_TARGET_COLOR}
              />
            )}
            {showSeeds && showHitch && d.hitchPre && hitch && (
              <SegmentLine a={d.hitchPre} b={hitch} color="#ffd166" opacity={0.5} />
            )}
            {showPaths && segments.map((segment, segmentIndex) => (
              <PathPolyline
                key={`segment-${segmentIndex}`}
                points={segment.points}
                peelStartIndex={d.peelStartIndex}
                color={segment.color}
                linear={segment.linear}
              />
            ))}
            {showClearanceMarkers && d.clearanceExceeded && d.clearancePoint && (
              <mesh position={d.clearancePoint.toArray()} frustumCulled={false}>
                <sphereGeometry args={[0.018, 10, 10]} />
                <meshBasicMaterial
                  color="#ff1744"
                  depthTest={false}
                  depthWrite={false}
                />
              </mesh>
            )}
            {showDirs && hitch && d.bodyRight && (
              <DirArrow from={hitch} dir={d.bodyRight} length={AXIS_LEN * 1.1} color="#ffffff" />
            )}
            {showDirs && hitch && d.climbDir && (
              <DirArrow from={hitch} dir={d.climbDir} length={AXIS_LEN} color="#06d6a0" />
            )}
            {showDirs && hitch && d.orbit && (
              <DirArrow from={hitch} dir={d.orbit} length={AXIS_LEN * 0.85} color="#118ab2" />
            )}
            {showDirs && hitch && d.outward && (
              <DirArrow from={hitch} dir={d.outward} length={AXIS_LEN * 0.75} color="#ef476f" />
            )}
          </group>
        );
      })}
    </group>
  );
}
