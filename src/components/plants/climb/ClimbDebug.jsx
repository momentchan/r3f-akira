import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three/webgpu';

const AXIS_LEN = 0.09;
const SEED_R = 0.012;
const HITCH_R = 0.008;

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
      <tubeGeometry args={[curve, Math.max(points.length - 1, 8), 0.0015, 3, false]} />
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

function matchesDiagnosticMode(wrap, mode) {
  const style = wrap.debug?.wrapStyle;
  if (mode === 'invalid') return Boolean(wrap.debug?.clearanceExceeded);
  if (mode === 'rings') return wrap.role === 'ring';
  if (mode === 'attachments') {
    return wrap.role === 'ring' && (wrap.debug?.attachmentPointCount ?? 0) > 1;
  }
  if (mode === 'surface-trunks') return style === 'surface-trunk';
  if (mode === 'ground-entries') return style === 'ground-entry';
  return true;
}

function diagnosticSegments(wrap, mode) {
  const debug = wrap.debug;
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
  if (wrap.role !== 'ring') return [];

  const attachmentCount = debug.attachmentPointCount ?? 0;
  const attachmentPoints = attachmentCount > 1
    ? debug.points.slice(0, attachmentCount)
    : [];
  const ringPoints = attachmentCount > 1
    ? debug.points.slice(attachmentCount - 1)
    : debug.points;
  const segments = [];
  if ((mode === 'all' || mode === 'attachments') && attachmentPoints.length > 1) {
    segments.push({ points: attachmentPoints, color: '#ff9f1c', linear: true });
  }
  if ((mode === 'all' || mode === 'rings') && ringPoints.length > 1) {
    segments.push({ points: ringPoints, color: '#2ec4b6', linear: false });
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

function CapsuleHelper({ capsule, color = '#00ffcc', label = '', showLabel = false }) {
  const { mid, arrowPosition, arrowQuaternion } = useMemo(() => {
    const direction = new THREE.Vector3().subVectors(capsule.b, capsule.a).normalize();
    return {
      mid: new THREE.Vector3().addVectors(capsule.a, capsule.b).multiplyScalar(0.5),
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
      {showLabel && label && (
        <Html
          position={mid.toArray()}
          center
          distanceFactor={8}
          pointerEvents="none"
          style={{
            color: '#00ffcc',
            fontSize: 11,
            fontFamily: 'monospace',
            background: 'rgba(0,0,0,0.7)',
            padding: '2px 5px',
            borderRadius: 2,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {label} a -&gt; b
        </Html>
      )}
    </group>
  );
}

/**
 * Climb path debug overlays.
 * yellow = hitch before BVH snap, magenta = after snap
 * teal = wrap samples on surface, orange = peel tip
 * green = climb dir, blue = orbit, red = outward
 * lime wire = limb capsules, cyan/pink boxes = body / backpack AABB
 */
export function ClimbDebug({
  visible = false,
  wraps = [],
  hosts = [],
  requestedTendrilCount = 0,
  showSeeds = true,
  showHitch = true,
  showPaths = true,
  showDirs = true,
  showBounds = true,
  showCapsules = true,
  showCapsuleLabels = true,
  showDiagnostics = true,
  diagnosticMode = 'all',
  showClearanceMarkers = true,
  showPathLabels = true,
  capsuleFilterId = null,
  pathCount = 24,
}) {
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
  }, [wraps, pathCount, diagnosticMode]);

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

  const bodyHost = hosts.find((host) => host.id === 'body');
  const diagnostics = bodyHost?.capsuleDiagnostics ?? null;
  const wrapStats = useMemo(() => {
    const ringsByHost = {};
    let rings = 0;
    let feeders = 0;
    for (const wrap of wraps) {
      if (wrap.role === 'feeder') {
        feeders += 1;
        continue;
      }
      rings += 1;
      ringsByHost[wrap.hostId] = (ringsByHost[wrap.hostId] ?? 0) + 1;
    }
    return { rings, feeders, ringsByHost };
  }, [wraps]);
  const diagnosticPosition = useMemo(() => {
    if (!bodyHost?.localBox) return new THREE.Vector3(0, 0.8, 0);
    const point = new THREE.Vector3();
    bodyHost.localBox.getCenter(point);
    point.y = bodyHost.localBox.max.y + 0.18;
    return point;
  }, [bodyHost]);

  if (!visible) return null;

  const capsuleCount = debugCapsules.length;

  return (
    <group name="ClimbDebug">
      {showDiagnostics && (
        <Html
          center
          position={diagnosticPosition.toArray()}
          pointerEvents="none"
          style={{
            color: diagnostics && diagnostics.found === diagnostics.expected
              ? '#80ed99'
              : '#ff6b6b',
            fontSize: 12,
            fontFamily: 'monospace',
            background: 'rgba(0,0,0,0.75)',
            padding: '4px 8px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {!bodyHost && 'Waiting for posed body bounds'}
          {bodyHost && !diagnostics && `No wrap diagnostics (${capsuleCount} regions)`}
          {diagnostics && (
            <>
              <div style={{ color: '#f8f9fa' }}>
                rings {wrapStats.rings}/{requestedTendrilCount}
                {' | '}body {wrapStats.ringsByHost.body ?? 0}
                {' | '}backpack {wrapStats.ringsByHost.backpack ?? 0}
                {' | '}feeders {wrapStats.feeders}
              </div>
              Wrap regions {diagnostics.found}/{diagnostics.expected}
              {' | '}bones {diagnostics.boneCount}
              {diagnostics.issues.length > 0 && (
                <div>
                  {diagnostics.issues.map((issue) => (
                    <div key={issue.id}>
                      {issue.id}: {issue.reason}
                      {issue.missing?.length ? ` (${issue.missing.join(', ')})` : ''}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#ffd166' }}>yellow a = start</div>
              <div style={{ color: '#06d6a0' }}>green b = toward torso</div>
            </>
          )}
        </Html>
      )}
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
          label={c.id}
          showLabel={showCapsuleLabels}
        />
      ))}

      {subset.map((wrap, i) => {
        const d = wrap.debug;
        if (!d) return null;
        const hitch = d.hitch;
        const segments = diagnosticSegments(wrap, diagnosticMode);
        return (
          <group key={`dbg-${wrap.hostId}-${wrap.seed}-${i}`}>
            {showSeeds && d.hitchPre && (
              <mesh position={d.hitchPre.toArray()} frustumCulled={false}>
                <sphereGeometry args={[SEED_R, 8, 8]} />
                <meshBasicMaterial
                  color="#ffd166"
                  depthTest={false}
                  depthWrite={false}
                  transparent
                  opacity={0.7}
                />
              </mesh>
            )}
            {showSeeds && showHitch && hitch && (
              <mesh position={hitch.toArray()} frustumCulled={false}>
                <sphereGeometry args={[HITCH_R, 8, 8]} />
                <meshBasicMaterial
                  color="#ff006e"
                  depthTest={false}
                  depthWrite={false}
                />
              </mesh>
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
            {showSeeds && showPathLabels && hitch && d.u != null && (
              <Html
                position={[hitch.x, hitch.y + 0.04, hitch.z]}
                center
                distanceFactor={10}
                pointerEvents="none"
                style={{
                  color: '#ffd166',
                  fontSize: 9,
                  fontFamily: 'monospace',
                  background: 'rgba(0,0,0,0.5)',
                  padding: '1px 3px',
                  pointerEvents: 'none',
                }}
              >
                {d.capsuleId} u={d.u.toFixed(2)}
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
