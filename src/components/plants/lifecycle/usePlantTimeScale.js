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

function isHudTarget(target) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest('.theme-toggle') ||
        target.closest('.audio-button') ||
        target.closest('.flower-cull-hud'),
    )
  );
}

function isHeldPointer(event) {
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
 * FLOW touch: one-finger vertical drag; lift keeps the last speed.
 * Explore (D) maps stillness. Frozen at 0 until ENTER.
 * FLOW holds 1x through the camera intro, then damps toward pointer Y.
 */
export function usePlantTimeScale({ enabled = true } = {}) {
  const cameraMode = useExperienceStore((state) => state.cameraMode);
  const stillness = useExperienceStore((state) => state.stillness);
  const flowIntroDone = useExperienceStore((state) => state.flowIntroDone);
  const setPlantTimeScale = useExperienceStore((state) => state.setPlantTimeScale);
  const pointerY = useRef(FLOW_REST_Y);
  const smoothed = useRef(1);

  useEffect(() => {
    const heldIds = new Set();
    let dragId = null;
    let dragOrigin = null;
    let dragging = false;

    const endDrag = () => {
      dragId = null;
      dragOrigin = null;
      dragging = false;
    };

    const onPointerDown = (event) => {
      if (!isHeldPointer(event)) return;
      heldIds.add(event.pointerId);
      if (heldIds.size !== 1 || !canWriteFlowTime() || isHudTarget(event.target)) {
        endDrag();
        return;
      }
      dragId = event.pointerId;
      dragOrigin = { x: event.clientX, y: event.clientY };
      dragging = false;
    };

    const onPointerMove = (event) => {
      if (!isHeldPointer(event)) {
        pointerY.current = unitY(event.clientY);
        return;
      }
      if (dragId !== event.pointerId || heldIds.size !== 1 || !canWriteFlowTime()) {
        return;
      }
      if (!dragging && dragOrigin) {
        const dx = event.clientX - dragOrigin.x;
        const dy = event.clientY - dragOrigin.y;
        if (dx * dx + dy * dy < 64) return;
        dragging = true;
      }
      if (dragging) pointerY.current = unitY(event.clientY);
    };

    const onPointerUp = (event) => {
      if (!isHeldPointer(event)) return;
      heldIds.delete(event.pointerId);
      if (event.pointerId === dragId) endDrag();
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

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
      const u = flowTimeUnit(pointerY.current);
      const target = lerp(FLOW_TIME_MIN, FLOW_TIME_MAX, u);
      smoothed.current = THREE.MathUtils.damp(smoothed.current, target, 1.8, dt);
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
