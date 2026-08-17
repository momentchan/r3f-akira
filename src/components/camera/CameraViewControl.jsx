import { CameraControls } from '@react-three/drei';
import { useControls } from 'leva';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { useExperienceStore } from '../../core/experienceStore';
import { CAMERA_DEFAULTS } from './cameraDefaults';
import { createCameraControlsSchema } from './cameraControls';
import { CAMERA_MODE } from './cameraModes';
import { buildFlowPath } from './cameraShots';
import { useExploreStillness } from './hooks/useExploreStillness';
import { useFlowCamera } from './hooks/useFlowCamera';
import { useFrameCamera } from './hooks/useFrameCamera';

export function CameraViewControl() {
  const controlsRef = useRef(null);
  const [flowGeneration, setFlowGeneration] = useState(0);
  const isStarted = useExperienceStore((state) => state.isStarted);
  const cameraMode = useExperienceStore((state) => state.cameraMode);
  const setCameraMode = useExperienceStore((state) => state.setCameraMode);
  const frameIndex = useExperienceStore((state) => state.frameIndex);
  const setFrameIndex = useExperienceStore((state) => state.setFrameIndex);

  const schema = useMemo(
    () =>
      createCameraControlsSchema(CAMERA_DEFAULTS, {
        onModeChange: setCameraMode,
        onFrameChange: setFrameIndex,
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
    [setCameraMode, setFrameIndex],
  );

  const [params, setParams] = useControls('Camera', () => schema, { collapsed: true });

  useEffect(() => {
    if (params.mode !== cameraMode) setParams({ mode: cameraMode });
  }, [cameraMode, params.mode, setParams]);

  useEffect(() => {
    if (params.frame !== frameIndex) setParams({ frame: frameIndex });
  }, [frameIndex, params.frame, setParams]);

  const tx = params.target[0];
  const ty = params.target[1];
  const tz = params.target[2];

  const flowPath = useMemo(
    () =>
      buildFlowPath({
        target: [tx, ty, tz],
        startAngle: params.startAngle,
        turns: params.turns,
        startRadius: params.startRadius,
        endRadius: params.endRadius,
        startHeight: params.startHeight,
        endHeight: params.endHeight,
        spiralSteps: params.spiralSteps,
        spiralDuration: params.spiralDuration,
        orbitSteps: params.orbitSteps,
        orbitDuration: params.orbitDuration,
      }),
    [
      params.endHeight,
      params.endRadius,
      params.orbitDuration,
      params.orbitSteps,
      params.spiralDuration,
      params.spiralSteps,
      params.startAngle,
      params.startHeight,
      params.startRadius,
      params.turns,
      tx,
      ty,
      tz,
    ],
  );

  const flowEnabled = isStarted && cameraMode === CAMERA_MODE.Flow;
  const framesEnabled = isStarted && cameraMode === CAMERA_MODE.Frames;
  const exploreEnabled = isStarted && cameraMode === CAMERA_MODE.Explore;

  useFlowCamera({
    controlsRef,
    enabled: flowEnabled,
    shots: flowPath.shots,
    loopFrom: flowPath.loopFrom,
    restartKey: flowGeneration,
  });
  useFrameCamera({ controlsRef, enabled: framesEnabled, frameIndex });
  useExploreStillness({ controlsRef, enabled: exploreEnabled });

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      enabled={exploreEnabled}
      maxPolarAngle={params.maxPolarAngle}
      minDistance={params.minDistance}
      maxDistance={params.maxDistance}
      smoothTime={params.exploreSmoothTime}
      draggingSmoothTime={0.12}
    />
  );
}
