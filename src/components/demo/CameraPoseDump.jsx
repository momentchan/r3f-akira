import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';

const round4 = (n) => Number(n.toFixed(4));

/** Publishes the live Canvas camera so you can copy a pose from DevTools. */
export function CameraPoseDump() {
  const camera = useThree((state) => state.camera);
  const dir = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());

  useFrame(() => {
    camera.getWorldDirection(dir.current);
    target.current.copy(camera.position).addScaledVector(dir.current, 3);
    window.__stillDemoCamera = {
      fov: camera.fov,
      position: camera.position.toArray().map(round4),
      target: target.current.toArray().map(round4),
    };
  });

  return null;
}
