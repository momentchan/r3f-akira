import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { CAMERA_MODE } from '../../camera/cameraModes';
import { useExperienceStore } from '../../../core/experienceStore';
import { setAuthoredSimScale } from './simSpeed';

export const FLOW_TIME_MIN = 0;
export const FLOW_TIME_MAX = 8;
/** Inset from window top/bottom before speed hits min/max. */
const FLOW_Y_PAD = 0.2;
const EXPLORE_MIN = 1;
const EXPLORE_MAX = 8;
const HOLD_SCALE = 1;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function flowTimeUnit(pointerY) {
  return THREE.MathUtils.clamp(
    (pointerY - FLOW_Y_PAD) / Math.max(1 - FLOW_Y_PAD * 2, 1e-3),
    0,
    1,
  );
}

/** Raw window Y that maps to 1x, so FLOW starts at normal speed until the mouse moves. */
const FLOW_REST_Y = FLOW_Y_PAD
  + ((1 - FLOW_TIME_MIN) / (FLOW_TIME_MAX - FLOW_TIME_MIN)) * (1 - FLOW_Y_PAD * 2);

/**
 * Writes the authored plant-time scale from camera mode.
 *
 * Camera motion is independent: this never reads orbit speed.
 * FLOW maps pointer Y (lower band = 0x, upper band = 8x; edges clamp early).
 * Explore (D) maps stillness. Other modes hold 1x.
 */
export function usePlantTimeScale({ enabled = true } = {}) {
  const cameraMode = useExperienceStore((state) => state.cameraMode);
  const stillness = useExperienceStore((state) => state.stillness);
  const setPlantTimeScale = useExperienceStore((state) => state.setPlantTimeScale);
  const pointerY = useRef(FLOW_REST_Y);
  const smoothed = useRef(1);

  useEffect(() => {
    const onMove = (event) => {
      pointerY.current = 1 - event.clientY / Math.max(window.innerHeight, 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useFrame((_, delta) => {
    if (!enabled) {
      setAuthoredSimScale(1);
      setPlantTimeScale(1);
      return;
    }

    const dt = Math.min(delta, 0.1);

    if (cameraMode === CAMERA_MODE.Flow) {
      const u = flowTimeUnit(pointerY.current);
      const target = lerp(FLOW_TIME_MIN, FLOW_TIME_MAX, u);
      smoothed.current = THREE.MathUtils.damp(smoothed.current, target, 4, dt);
      setAuthoredSimScale(smoothed.current);
      setPlantTimeScale(smoothed.current);
      return;
    }

    if (cameraMode === CAMERA_MODE.Explore) {
      const explore = lerp(EXPLORE_MIN, EXPLORE_MAX, stillness);
      setAuthoredSimScale(explore);
      setPlantTimeScale(explore);
      return;
    }

    setAuthoredSimScale(HOLD_SCALE);
    setPlantTimeScale(HOLD_SCALE);
  });
}
