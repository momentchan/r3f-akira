'use client';

import { useEffect } from 'react';
import * as THREE from 'three/webgpu';
import { DistortedCircle, WebGPUCanvas } from '@core';
import { useShortcut } from '@core/hooks/useShortcut';
import { TIER1_TARGETS, useExperienceStore } from '../core/experienceStore';
import { getLiveThemeColors } from '../components/scene/themeTween';
import './audioButton.css';

export const BGM_TRACKS = [
  { id: 'slow-moving-waves', url: '/audio/slow-moving-waves.m4a', volume: 1.25 },
];

const RADIUS = 10;
const SIZE = 45;

function AudioButtonScene() {
  const isSoundOn = useExperienceStore((state) => state.isSoundOn);
  const setIsSoundOn = useExperienceStore((state) => state.setIsSoundOn);
  const audioColor = getLiveThemeColors().audio;

  return (
    <>
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
            color={audioColor}
            blending={THREE.NormalBlending}
          />
        ))}
      </group>
    </>
  );
}

export function AudioButton() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const setIsSoundOn = useExperienceStore((state) => state.setIsSoundOn);
  const sceneReady = useExperienceStore((state) =>
    TIER1_TARGETS.every((id) => state.readyStatus[id]),
  );

  useEffect(() => {
    if (isStarted) setIsSoundOn(false);
  }, [isStarted, setIsSoundOn]);

  useShortcut('m', () => {
    const { isSoundOn, setIsSoundOn: setSound } = useExperienceStore.getState();
    setSound(!isSoundOn);
  });

  if (!isStarted || !sceneReady) return null;

  return (
    <WebGPUCanvas
      width={SIZE}
      height={SIZE}
      className="audio-button"
    >
      <AudioButtonScene />
    </WebGPUCanvas>
  );
}
