import { useEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';

const AXIS_LEN = 0.09;
const SEED_R = 0.012;
const HITCH_R = 0.008;

function SegmentLine({ a, b, color = '#ffffff', opacity = 0.85 }) {
  const geometry = useMemo(() => {
    if (!a || !b) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([
        a.x, a.y, a.z,
        b.x, b.y, b.z,
      ]), 3),
    );
    return geo;
  }, [a, b]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;

  return (
    <line geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={opacity}
      />
    </line>
  );
}

function DirArrow({ from, dir, length, color }) {
  const to = useMemo(() => {
    if (!from || !dir) return null;
    return from.clone().addScaledVector(dir, length);
  }, [from, dir, length]);
  return <SegmentLine a={from} b={to} color={color} opacity={0.95} />;
}

function PathPolyline({ points, peelStartIndex = -1 }) {
  const geos = useMemo(() => {
    if (!points?.length) return { wrap: null, peel: null };
    const wrapEnd = peelStartIndex > 0 ? peelStartIndex : points.length;
    const wrapPts = points.slice(0, Math.max(wrapEnd, 2));
    const wrap = new Float32Array(wrapPts.length * 3);
    for (let i = 0; i < wrapPts.length; i += 1) {
      wrap[i * 3] = wrapPts[i].x;
      wrap[i * 3 + 1] = wrapPts[i].y;
      wrap[i * 3 + 2] = wrapPts[i].z;
    }
    const wrapGeo = new THREE.BufferGeometry();
    wrapGeo.setAttribute('position', new THREE.BufferAttribute(wrap, 3));

    let peelGeo = null;
    if (peelStartIndex > 0 && peelStartIndex < points.length) {
      const peelPts = points.slice(peelStartIndex - 1);
      const peel = new Float32Array(peelPts.length * 3);
      for (let i = 0; i < peelPts.length; i += 1) {
        peel[i * 3] = peelPts[i].x;
        peel[i * 3 + 1] = peelPts[i].y;
        peel[i * 3 + 2] = peelPts[i].z;
      }
      peelGeo = new THREE.BufferGeometry();
      peelGeo.setAttribute('position', new THREE.BufferAttribute(peel, 3));
    }
    return { wrap: wrapGeo, peel: peelGeo };
  }, [points, peelStartIndex]);

  useEffect(() => () => {
    geos.wrap?.dispose();
    geos.peel?.dispose();
  }, [geos]);

  return (
    <group>
      {geos.wrap && (
        <line geometry={geos.wrap} frustumCulled={false}>
          <lineBasicMaterial
            color="#2ec4b6"
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.85}
          />
        </line>
      )}
      {geos.peel && (
        <line geometry={geos.peel} frustumCulled={false}>
          <lineBasicMaterial
            color="#ff9f1c"
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.9}
          />
        </line>
      )}
    </group>
  );
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

function CapsuleHelper({ capsule, color = '#b8f2e6' }) {
  const { mid, quat, length } = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(capsule.b, capsule.a);
    const length = Math.max(dir.length(), 1e-4);
    dir.multiplyScalar(1 / length);
    const mid = new THREE.Vector3().addVectors(capsule.a, capsule.b).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir,
    );
    return { mid, quat, length };
  }, [capsule]);

  return (
    <group position={mid.toArray()} quaternion={quat}>
      <mesh frustumCulled={false}>
        <cylinderGeometry args={[capsule.radius, capsule.radius, length, 12, 1, true]} />
        <meshBasicMaterial
          color={color}
          wireframe
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.45}
        />
      </mesh>
      <mesh position={[0, length * 0.5, 0]} frustumCulled={false}>
        <sphereGeometry args={[capsule.radius, 10, 8]} />
        <meshBasicMaterial
          color={color}
          wireframe
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.35}
        />
      </mesh>
      <mesh position={[0, -length * 0.5, 0]} frustumCulled={false}>
        <sphereGeometry args={[capsule.radius, 10, 8]} />
        <meshBasicMaterial
          color={color}
          wireframe
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.35}
        />
      </mesh>
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
  showSeeds = true,
  showPaths = true,
  showDirs = true,
  showBounds = true,
  showCapsules = true,
  pathCount = 24,
  capsuleRadiusScale = 1,
}) {
  const subset = useMemo(() => {
    if (!wraps.length) return [];
    const n = Math.min(Math.max(pathCount, 0), wraps.length);
    if (n >= wraps.length) return wraps;
    const step = wraps.length / n;
    const list = [];
    for (let i = 0; i < n; i += 1) {
      list.push(wraps[Math.min(Math.floor(i * step), wraps.length - 1)]);
    }
    return list;
  }, [wraps, pathCount]);

  const debugCapsules = useMemo(() => {
    const list = [];
    for (const host of hosts) {
      for (const c of host.capsules ?? []) {
        list.push({
          ...c,
          radius: c.radius * capsuleRadiusScale,
          key: `${host.id}:${c.id}`,
          color: host.id === 'body' ? '#95d5b2' : '#f72585',
        });
      }
    }
    return list;
  }, [hosts, capsuleRadiusScale]);

  if (!visible) return null;

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
        <CapsuleHelper key={c.key} capsule={c} color={c.color} />
      ))}

      {subset.map((wrap, i) => {
        const d = wrap.debug;
        if (!d) return null;
        const hitch = d.hitch;
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
            {showSeeds && hitch && (
              <mesh position={hitch.toArray()} frustumCulled={false}>
                <sphereGeometry args={[HITCH_R, 8, 8]} />
                <meshBasicMaterial
                  color="#ff006e"
                  depthTest={false}
                  depthWrite={false}
                />
              </mesh>
            )}
            {showSeeds && d.hitchPre && hitch && (
              <SegmentLine a={d.hitchPre} b={hitch} color="#ffd166" opacity={0.5} />
            )}
            {showPaths && d.points && (
              <PathPolyline
                points={d.points}
                peelStartIndex={d.peelStartIndex}
              />
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
