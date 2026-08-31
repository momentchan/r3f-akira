import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { useExperienceStore } from '../../core/experienceStore';
import { usePlantTimeScale } from '../plants/lifecycle/usePlantTimeScale';
import {
  CAMERA_DEFAULTS,
  PUBLIC_EXPLORE_DEFAULTS,
} from './cameraDefaults';
import { createCameraControlsSchema } from './cameraControls';
import { CAMERA_MODE, EXPLORE_PROFILE } from './cameraModes';
import { useFlowCamera } from './hooks/useFlowCamera';

function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const el = target;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

const PUBLIC_EXPLORE_COAST_SECONDS = 0.9;

function getOppositeCameraMode(mode) {
  if (mode === CAMERA_MODE.Flow) return CAMERA_MODE.Explore;
  return CAMERA_MODE.Flow;
}

function getMouseAndTouchActions(publicExplore, ACTION) {
  if (publicExplore) {
    return {
      middleMouse: ACTION.NONE,
      rightMouse: ACTION.NONE,
      twoFinger: ACTION.TOUCH_DOLLY_ROTATE,
      threeFinger: ACTION.NONE,
    };
  }

  return {
    middleMouse: ACTION.DOLLY,
    rightMouse: ACTION.TRUCK,
    twoFinger: ACTION.TOUCH_DOLLY_TRUCK,
    threeFinger: ACTION.TOUCH_TRUCK,
  };
}

function getCameraLimits(publicExplore, params) {
  if (publicExplore) return PUBLIC_EXPLORE_DEFAULTS;

  return {
    minPolarAngle: 0,
    maxPolarAngle: params.maxPolarAngle,
    minDistance: params.minDistance,
    maxDistance: params.maxDistance,
  };
}

export function CameraViewControl() {
  const controlsRef = useRef(null);
  const exploreCoastRef = useRef({ active: false, elapsed: 0 });
  const [flowGeneration, setFlowGeneration] = useState(0);
  const isStarted = useExperienceStore((state) => state.isStarted);
  const cameraMode = useExperienceStore((state) => state.cameraMode);
  const setCameraMode = useExperienceStore((state) => state.setCameraMode);
  const exploreProfile = useExperienceStore((state) => state.exploreProfile);
  const setExploreProfile = useExperienceStore(
    (state) => state.setExploreProfile,
  );

  const [params] = useControls(
    'Camera',
    () =>
      createCameraControlsSchema(CAMERA_DEFAULTS, {
        onLogLookAt: () => {
          const controls = controlsRef.current;
          if (!controls) return;
          const position = new THREE.Vector3();
          const target = new THREE.Vector3();
          controls.getPosition(position);
          controls.getTarget(target);
          console.log('[camera lookAt]', {
            position: position.toArray().map((n) => Number(n.toFixed(3))),
            target: target.toArray().map((n) => Number(n.toFixed(3))),
          });
        },
        onRestartFlow: () => setFlowGeneration((n) => n + 1),
      }),
    { collapsed: true },
  );

  useEffect(() => {
    if (!isStarted) return undefined;
    const onKey = (event) => {
      if (event.code !== 'KeyD' || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      const next = getOppositeCameraMode(
        useExperienceStore.getState().cameraMode,
      );
      if (next === CAMERA_MODE.Explore) {
        setExploreProfile(EXPLORE_PROFILE.Developer);
      }
      setCameraMode(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStarted, setCameraMode, setExploreProfile]);

  const flowEnabled = cameraMode === CAMERA_MODE.Flow;
  const exploreEnabled = isStarted && cameraMode === CAMERA_MODE.Explore;
  const publicExplore =
    exploreEnabled && exploreProfile === EXPLORE_PROFILE.Public;

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const { ACTION } = CameraControlsImpl;
    const actions = getMouseAndTouchActions(publicExplore, ACTION);
    controls.mouseButtons.left = ACTION.ROTATE;
    controls.mouseButtons.middle = actions.middleMouse;
    controls.mouseButtons.right = actions.rightMouse;
    controls.mouseButtons.wheel = ACTION.DOLLY;
    controls.touches.one = ACTION.TOUCH_ROTATE;
    controls.touches.two = actions.twoFinger;
    controls.touches.three = actions.threeFinger;
  }, [publicExplore]);

  useEffect(() => {
    const coast = exploreCoastRef.current;
    coast.active = publicExplore;
    coast.elapsed = 0;
    if (!publicExplore) return undefined;

    const controls = controlsRef.current;
    if (!controls) return undefined;
    const cancelCoast = () => {
      coast.active = false;
    };
    controls.addEventListener('controlstart', cancelCoast);
    return () => controls.removeEventListener('controlstart', cancelCoast);
  }, [publicExplore]);

  useFrame((_, delta) => {
    const coast = exploreCoastRef.current;
    const controls = controlsRef.current;
    if (!publicExplore || !coast.active || !controls) return;

    const dt = Math.min(delta, 0.1);
    const p = THREE.MathUtils.clamp(
      coast.elapsed / PUBLIC_EXPLORE_COAST_SECONDS,
      0,
      1,
    );
    const speedScale = (1 - p) * (1 - p);
    controls.rotate(params.orbitSpeed * speedScale * dt, 0, false);
    coast.elapsed += dt;
    if (coast.elapsed >= PUBLIC_EXPLORE_COAST_SECONDS) {
      coast.active = false;
    }
  }, -2);

  usePlantTimeScale({ enabled: isStarted });
  useFlowCamera({
    controlsRef,
    enabled: flowEnabled,
    isStarted,
    target: params.target,
    radius: params.radius,
    radiusAmp: params.radiusAmp,
    radiusCycles: params.radiusCycles,
    height: params.height,
    heightAmp: params.heightAmp,
    heightCycles: params.heightCycles,
    orbitSpeed: params.orbitSpeed,
    startAngle: params.startAngle,
    overheadHeight: params.overheadHeight,
    overheadRadius: params.overheadRadius,
    restartKey: flowGeneration,
    smoothResume: exploreProfile === EXPLORE_PROFILE.Public,
  });

  const cameraLimits = getCameraLimits(publicExplore, params);

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      enabled={exploreEnabled}
      {...cameraLimits}
      smoothTime={params.exploreSmoothTime}
      draggingSmoothTime={0.12}
    />
  );
}
