import { useEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';

const DEPTH_COLORS = ['#45e7c2', '#ffd65a', '#ff6b9d', '#b58cff'];

export function GroundTendrilDebug({ visible, paths }) {
  const debugPaths = useMemo(() => {
    if (!visible) return [];
    return paths.map((path) => ({
      id: path.id,
      depth: path.depth,
      geometry: new THREE.TubeGeometry(path.curve, 28, 0.0032, 3, false),
    }));
  }, [visible, paths]);

  useEffect(() => () => {
    debugPaths.forEach((path) => path.geometry.dispose());
  }, [debugPaths]);

  if (!visible) return null;

  return (
    <group name="GroundTendrilDebug" renderOrder={20}>
      {debugPaths.map((path) => (
        <mesh
          key={path.id}
          geometry={path.geometry}
          frustumCulled={false}
          renderOrder={20}
        >
          <meshBasicMaterial
            color={DEPTH_COLORS[path.depth % DEPTH_COLORS.length]}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {paths.filter((path) => path.root).map((path) => (
        <mesh key={`${path.id}:root`} position={path.root} renderOrder={21}>
          <sphereGeometry args={[0.024, 8, 6]} />
          <meshBasicMaterial color="#45e7c2" depthTest={false} toneMapped={false} />
        </mesh>
      ))}
      {paths.filter((path) => path.junction).map((path) => (
        <mesh key={`${path.id}:joint`} position={path.junction} renderOrder={21}>
          <sphereGeometry args={[0.017, 8, 6]} />
          <meshBasicMaterial
            color={DEPTH_COLORS[path.depth % DEPTH_COLORS.length]}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
