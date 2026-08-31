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
const HOLD_SCALE = 1;
const POINTER_DAMPING = 1.8;
const SCRUB_DAMPING = 10;

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

function isHudTarget(target) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest('.theme-toggle') ||
        target.closest('.audio-button') ||
        target.closest('.camera-mode-toggle') ||
        target.closest('.flow-time-rail') ||
        target.closest('.flower-cull-hud'),
    )
  );
}

function isTouchPointer(event) {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function unitY(clientY) {
  return 1 - clientY / Math.max(window.innerHeight, 1);
}

function canWriteFlowTime() {
  const { isStarted, flowIntroDone, cameraMode } = useExperienceStore.getState();
  return isStarted && flowIntroDone && cameraMode === CAMERA_MODE.Flow;
}

/**
 * Writes the authored plant-time scale from camera mode.
 *
 * Camera motion is independent: this never reads orbit speed.
 * FLOW desktop: mouse Y (lower band = 0x, upper band = 8x; edges clamp early).
 * FLOW touch / pen: the TIME rail owns speed input, just like EXPLORE.
 * EXPLORE inherits the current scale and holds it unless the TIME rail changes.
 * FLOW holds 1x through the camera intro, then damps toward its active target.
 */
export function usePlantTimeScale({ enabled = true } = {}) {
  const cameraMode = useExperienceStore((state) => state.cameraMode);
  const flowIntroDone = useExperienceStore((state) => state.flowIntroDone);
  const setPlantTimeScale = useExperienceStore((state) => state.setPlantTimeScale);
  const plantTimeTarget = useExperienceStore((state) => state.plantTimeTarget);
  const setPlantTimeTarget = useExperienceStore(
    (state) => state.setPlantTimeTarget,
  );
  const isTimeScrubbing = useExperienceStore(
    (state) => state.isTimeScrubbing,
  );
  const smoothed = useRef(1);
  const previousMode = useRef(cameraMode);

  useEffect(() => {
    const enteringExplore =
      cameraMode === CAMERA_MODE.Explore &&
      previousMode.current !== CAMERA_MODE.Explore;
    previousMode.current = cameraMode;
    if (enteringExplore) setPlantTimeTarget(smoothed.current);
  }, [cameraMode, setPlantTimeTarget]);

  useEffect(() => {
    const writePointerTime = (clientY) => {
      const u = flowTimeUnit(unitY(clientY));
      setPlantTimeTarget(lerp(FLOW_TIME_MIN, FLOW_TIME_MAX, u));
    };

    const onPointerMove = (event) => {
      // Touch and pen input is reserved for the TIME rail. This prevents a
      // camera gesture from also changing FLOW speed across the whole canvas.
      if (isTouchPointer(event)) return;
      if (canWriteFlowTime() && !isHudTarget(event.target)) {
        writePointerTime(event.clientY);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [setPlantTimeTarget]);

  useFrame((_, delta) => {
    if (!enabled) {
      setAuthoredSimScale(0);
      setPlantTimeScale(0);
      return;
    }

    const dt = Math.min(delta, 0.1);

    if (cameraMode === CAMERA_MODE.Flow) {
      if (!flowIntroDone) {
        smoothed.current = 1;
        setAuthoredSimScale(1);
        setPlantTimeScale(1);
        return;
      }
    }

    if (
      cameraMode === CAMERA_MODE.Flow ||
      cameraMode === CAMERA_MODE.Explore
    ) {
      smoothed.current = THREE.MathUtils.damp(
        smoothed.current,
        plantTimeTarget,
        isTimeScrubbing ? SCRUB_DAMPING : POINTER_DAMPING,
        dt,
      );
      setAuthoredSimScale(smoothed.current);
      setPlantTimeScale(smoothed.current);
      return;
    }

    smoothed.current = HOLD_SCALE;
    setAuthoredSimScale(smoothed.current);
    setPlantTimeScale(smoothed.current);
  });
}
