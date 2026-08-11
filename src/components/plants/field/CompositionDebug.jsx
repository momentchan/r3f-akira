import { useEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';

function CircleRing({
  radius,
  y = 0.02,
  color = '#ff4d6d',
  opacity = 0.85,
  segments = 64,
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * radius;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(a) * radius;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [radius, segments]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (radius <= 0) return null;

  return (
    <lineLoop geometry={geometry} position={[0, y, 0]} frustumCulled={false}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
      />
    </lineLoop>
  );
}

function DiscFill({
  radius,
  y = 0.015,
  color = '#ff4d6d',
  opacity = 0.12,
}) {
  if (radius <= 0) return null;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y, 0]}
      frustumCulled={false}
    >
      <circleGeometry args={[radius, 48]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Visual guides for Surround composition knobs:
 * - magenta disc/dot = face clear pocket (helmet)
 * - orange ring = near / contact band
 * - teal ring = far / spread rim
 * - sample discs on +X = near bloom scale (small→large)
 */
export function CompositionDebug({
  visible = false,
  center = [0, 0],
  headLocal = null,
  faceClearRadius = 0,
  nearR = 0,
  farR = 0,
  nearSizeMin = 0.5,
  clearMargin = 0.12,
}) {
  if (!visible) return null;

  const [cx, cz] = center;
  const headX = headLocal?.x ?? cx;
  const headZ = headLocal?.z ?? cz;
  const headFound = Boolean(headLocal?.found ?? headLocal);

  const nearBloomR = 0.08 * nearSizeMin;
  const midT = 0.5;
  const midMul = nearSizeMin + (1 - nearSizeMin) * Math.pow(midT, 0.65);
  const midBloomR = 0.08 * midMul;
  const farBloomR = 0.08;
  const midR = nearR + (farR - nearR) * midT;

  return (
    <group>
      <group position={[headX, 0, headZ]}>
        <DiscFill radius={faceClearRadius} color="#ff4d6d" opacity={0.16} />
        <CircleRing radius={faceClearRadius} color="#ff4d6d" y={0.03} />
        <mesh position={[0, 0.06, 0]} frustumCulled={false}>
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshBasicMaterial
            color={headFound ? '#ff4d6d' : '#888888'}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      </group>

      <group position={[cx, 0, cz]}>
        <CircleRing radius={nearR} color="#ff9f1c" y={0.025} opacity={0.9} />
        <CircleRing radius={farR} color="#2ec4b6" y={0.025} opacity={0.75} />
        <CircleRing
          radius={Math.max(nearR * 0.55, clearMargin)}
          color="#ffffff"
          y={0.02}
          opacity={0.35}
        />

        <group position={[nearR, 0, 0]}>
          <DiscFill radius={nearBloomR} y={0.04} color="#ff9f1c" opacity={0.35} />
          <CircleRing radius={nearBloomR} y={0.045} color="#ff9f1c" />
        </group>
        <group position={[midR, 0, 0]}>
          <DiscFill radius={midBloomR} y={0.04} color="#ffd166" opacity={0.3} />
          <CircleRing radius={midBloomR} y={0.045} color="#ffd166" />
        </group>
        <group position={[farR, 0, 0]}>
          <DiscFill radius={farBloomR} y={0.04} color="#2ec4b6" opacity={0.3} />
          <CircleRing radius={farBloomR} y={0.045} color="#2ec4b6" />
        </group>
      </group>
    </group>
  );
}
