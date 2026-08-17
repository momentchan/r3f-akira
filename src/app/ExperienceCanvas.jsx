import { memo, Suspense, useCallback, useRef, useState } from 'react';
import { AdaptiveDpr, Environment } from '@react-three/drei';
import { CameraViewControl } from '../components/camera/CameraViewControl';
import { AsyncCompile, CanvasCapture } from '@core';
import { Canvas } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import { Character } from '../components/character/Character';
import { Backpack } from '../components/character/Backpack.tsx';
import { ClimbTendrils } from '../components/plants/climb/ClimbTendrils';
import { PlantField } from '../components/plants/field/PlantField';
import { GroundTendrils } from '../components/plants/groundTendrils/GroundTendrils';
import { usePlantWindControls } from '../components/plants/wind/usePlantWindControls';
import { DirectionalLight } from '../components/scene/DirectionalLight';
import Effects from '../components/scene/Effects';
import { ShadowCatcher } from '../components/scene/ShadowCatcher';
import { SCENE_DEFAULTS } from '../components/scene/sceneDefaults';
import { FLOW_START } from '../components/camera/cameraShots';
import { TIER1_TARGETS, useExperienceStore } from '../core/experienceStore';

function createWebGPURenderer(canvas) {
  const renderer = new THREE.WebGPURenderer({
    ...canvas,
    powerPreference: 'high-performance',
    antialias: true,
    alpha: false,
    stencil: false,
    shadowMap: true,
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  return renderer.init().then(() => renderer);
}

function SceneContent() {
  const fieldParentRef = useRef(null);
  const [bodyBounds, setBodyBounds] = useState(null);
  const [backpackBounds, setBackpackBounds] = useState(null);
  const onBodyBounds = useCallback((bounds) => {
    setBodyBounds(bounds);
  }, []);
  const onBackpackBounds = useCallback((bounds) => {
    setBackpackBounds(bounds);
  }, []);

  const { bgColor } = useControls('Scene', {
    bgColor: { value: SCENE_DEFAULTS.bgColor, label: 'background' },
  });
  const plantWind = usePlantWindControls();

  const setComponentReady = useExperienceStore((state) => state.setComponentReady);

  return (
    <>
      <group ref={fieldParentRef} position={[0, -1, 0]}>
        <Suspense fallback={null}>
          <AsyncCompile id={TIER1_TARGETS[0]} onReady={setComponentReady}>
            <Character
              mode="tableau"
              pose="Lay"
              position={[0, 0.6, 0]}
              scale={1.5}
              fieldParentRef={fieldParentRef}
              onBodyBounds={onBodyBounds}
            />
          </AsyncCompile>
          <AsyncCompile id={TIER1_TARGETS[1]} onReady={setComponentReady}>
            <Backpack
              position={[-1.8, 0.1, -0.5]}
              rotation={[
                THREE.MathUtils.degToRad(0),
                THREE.MathUtils.degToRad(200),
                THREE.MathUtils.degToRad(-5),
              ]}
              scale={1.5}
              fieldParentRef={fieldParentRef}
              onBounds={onBackpackBounds}
            />
          </AsyncCompile>
        </Suspense>
        <ShadowCatcher groundColor={bgColor} />
        {/* <Suspense fallback={null}>
          <PlantField
            bodyBounds={bodyBounds}
            wind={plantWind}
          />
        </Suspense> */}
        <Suspense fallback={null}>
          <ClimbTendrils
            bodyBounds={bodyBounds}
            backpackBounds={backpackBounds}
            wind={plantWind}
          />
        </Suspense>
        <Suspense fallback={null}>
          <GroundTendrils
            bodyBounds={bodyBounds}
            backpackBounds={backpackBounds}
            wind={plantWind}
          />
        </Suspense>
      </group>

      {/* Same value as ShadowCatcher's groundColor, so ground and sky are one
          flat tone and the plane's edge is never visible. */}
      <color attach="background" args={[bgColor]} />

      <AdaptiveDpr pixelated />
      <CameraViewControl />
      <CanvasCapture />
      <DirectionalLight />
      <Effects />
    </>
  );
}

export const ExperienceCanvas = memo(function ExperienceCanvas() {
  return (
    <Canvas
      shadows
      style={{ width: '100%', height: '100%' }}
      camera={{
        fov: 45,
        near: 0.1,
        far: 200,
        position: FLOW_START.position,
      }}
      gl={createWebGPURenderer}
      dpr={[1, 2]}
      performance={{ min: 0.5, max: 1 }}
    >
      <SceneContent />
    </Canvas>
  );
});
