import { useEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';

// Invisible ground that renders ONLY the shadow cast onto it. Uses the WebGPU
// ShadowNodeMaterial (transparent everywhere except where a shadow falls), so
// the plane itself doesn't show — just the stems' shadows.
export function ShadowCatcher({
  size = 10,
  opacity = 0.35,
  color = 0x000000,
  ...props
}) {
  const material = useMemo(
    () => new THREE.ShadowNodeMaterial({ color, opacity }),
    [color, opacity],
  );
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh rotation-x={-Math.PI / 2} scale={size} receiveShadow material={material} {...props}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
