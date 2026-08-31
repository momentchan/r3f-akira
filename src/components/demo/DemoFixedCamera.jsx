import { useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DEMO_CAMERA } from './demoCamera';
import { usePlantTimeScale } from '../plants/lifecycle/usePlantTimeScale';

/** Holds the Canvas camera on DEMO_CAMERA so FLOW orbit cannot move it. */
export function DemoFixedCamera() {
  const camera = useThree((state) => state.camera);
  usePlantTimeScale({enabled:true})

  const apply = () => {
    const { position, target, fov } = DEMO_CAMERA;
    if (typeof fov === 'number') {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target[0], target[1], target[2]);
  };

  useLayoutEffect(() => {
    apply();
  });

  useFrame(() => {
    apply();
  });

  return null;
}
