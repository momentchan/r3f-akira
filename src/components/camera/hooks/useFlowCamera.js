import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { useExperienceStore } from '../../../core/experienceStore';
import { CAMERA_DEFAULTS } from '../cameraDefaults';
import { pointOnOrbit } from '../cameraShots';

function alongPath(angle, amp, cycles) {
  return amp * Math.sin(angle * cycles);
}

const WHEEL_TO_RADIUS = 0.0025;

/**
 * Slow continuous orbit along a fixed path. Height and radius breathe as
 * functions of orbit angle, so one `orbitSpeed` is the only tempo.
 *
 * Wall-clock only: plant time-lapse must not change how fast the camera moves.
 * Wheel dolly: scroll up closer, scroll down farther.
 */
export function useFlowCamera({
  controlsRef,
  enabled,
  target = CAMERA_DEFAULTS.target,
  radius = CAMERA_DEFAULTS.radius,
  height = CAMERA_DEFAULTS.height,
  startAngle = CAMERA_DEFAULTS.startAngle,
  orbitSpeed = CAMERA_DEFAULTS.orbitSpeed,
  heightAmp = CAMERA_DEFAULTS.heightAmp,
  heightCycles = CAMERA_DEFAULTS.heightCycles,
  radiusAmp = CAMERA_DEFAULTS.radiusAmp,
  radiusCycles = CAMERA_DEFAULTS.radiusCycles,
  radiusMin = CAMERA_DEFAULTS.radiusMin,
  radiusMax = CAMERA_DEFAULTS.radiusMax,
  restartKey = 0,
}) {
  const setStillness = useExperienceStore((state) => state.setStillness);
  const angleRef = useRef(startAngle);
  const liveRadiusRef = useRef(radius);
  const smoothRadiusRef = useRef(radius);

  useEffect(() => {
    liveRadiusRef.current = radius;
    smoothRadiusRef.current = radius;
  }, [radius, restartKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    setStillness(1);
    angleRef.current = startAngle;
    controlsRef.current?.stop?.();
    return undefined;
  }, [controlsRef, enabled, restartKey, setStillness, startAngle]);

  useEffect(() => {
    if (!enabled) return undefined;

    const onWheel = (event) => {
      event.preventDefault();
      const next = liveRadiusRef.current + event.deltaY * WHEEL_TO_RADIUS;
      liveRadiusRef.current = THREE.MathUtils.clamp(next, radiusMin, radiusMax);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [enabled, radiusMin, radiusMax]);

  useFrame((_, delta) => {
    if (!enabled) return;
    const controls = controlsRef.current;
    if (!controls) return;

    const dt = Math.min(delta, 0.1);
    angleRef.current += orbitSpeed * dt;
    const angle = angleRef.current;
    const elev = height + alongPath(angle, heightAmp, heightCycles);
    smoothRadiusRef.current = THREE.MathUtils.damp(
      smoothRadiusRef.current,
      liveRadiusRef.current,
      6,
      dt,
    );
    const r = Math.max(
      radiusMin,
      smoothRadiusRef.current + alongPath(angle, radiusAmp, radiusCycles),
    );
    const look = Array.isArray(target) ? target : CAMERA_DEFAULTS.target;
    const pos = pointOnOrbit(angle, r, elev, look);
    controls.setLookAt(pos[0], pos[1], pos[2], look[0], look[1], look[2], false);
  });
}
