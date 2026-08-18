import { useEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';

const ROLE_STYLE = {
  hero: { color: '#45e7c2', opacity: 1, radius: 0.0042 },
  nearby: { color: '#ffd65a', opacity: 0.85, radius: 0.0034 },
  guide: { color: '#ff5fb7', opacity: 0.24, radius: 0.0018 },
};

function roleStyle(path) {
  return ROLE_STYLE[path.groundRole] ?? ROLE_STYLE.guide;
}

export function GroundTendrilDebug({ visible, paths }) {
  const debugPaths = useMemo(() => {
    if (!visible) return [];
    return paths.map((path) => {
      const style = roleStyle(path);
      return {
        id: path.id,
        groundRole: path.groundRole,
        style,
        geometry: new THREE.TubeGeometry(path.curve, 28, style.radius, 3, false),
      };
    });
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
            color={path.style.color}
            transparent={path.style.opacity < 1}
            opacity={path.style.opacity}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {paths.filter((path) => path.root).map((path) => (
        <mesh key={`${path.id}:root`} position={path.root} renderOrder={21}>
          <sphereGeometry args={[0.024, 8, 6]} />
          <meshBasicMaterial
            color={roleStyle(path).color}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {paths.filter((path) => path.junction).map((path) => (
        <mesh key={`${path.id}:joint`} position={path.junction} renderOrder={21}>
          <sphereGeometry args={[0.017, 8, 6]} />
          <meshBasicMaterial
            color={roleStyle(path).color}
            transparent={!path.renderGroundTendril}
            opacity={path.renderGroundTendril ? 1 : 0.24}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
