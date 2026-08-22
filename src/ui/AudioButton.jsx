import { useEffect } from 'react';
import * as THREE from 'three/webgpu';
import { DistortedCircle, WebGPUCanvas } from '@core';
import { useShortcut } from '@core/hooks/useShortcut';
import { useExperienceStore } from '../core/experienceStore';

export const BGM_TRACKS = [
  { id: 'slow-moving-waves', url: '/audio/slow-moving-waves.m4a', volume: 1.25 },
];

const RADIUS = 10;
const SIZE = 45;

export function AudioButton() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const isSoundOn = useExperienceStore((state) => state.isSoundOn);
  const setIsSoundOn = useExperienceStore((state) => state.setIsSoundOn);

  useEffect(() => {
    if (isStarted) setIsSoundOn(true);
  }, [isStarted, setIsSoundOn]);

  useShortcut('m', () => {
    setIsSoundOn(!isSoundOn);
  });

  if (!isStarted) return null;

  return (
    <WebGPUCanvas
      width={SIZE}
      height={SIZE}
      style={{ position: 'fixed', bottom: 0, right: 0, zIndex: 40 }}
    >
      <mesh
        onClick={() => setIsSoundOn(!isSoundOn)}
        onPointerOver={() => {
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
        renderOrder={1}
      >
        <circleGeometry args={[RADIUS * 1.2, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <group>
        {[12.35, 0.58, 3.67].map((seed) => (
          <DistortedCircle
            key={seed}
            radius={RADIUS}
            distortionStrength={isSoundOn ? 1 : 0}
            seed={seed}
            color="#000000"
          />
        ))}
      </group>
    </WebGPUCanvas>
  );
}
