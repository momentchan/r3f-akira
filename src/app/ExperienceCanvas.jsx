import { memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PerformanceMonitor } from '@react-three/drei';
import { CameraViewControl } from '../components/camera/CameraViewControl';
import { AsyncCompile, CanvasCapture } from '@core';
import { Canvas } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import { Character } from '../components/character/Character';
import { Backpack } from '../components/character/Backpack.tsx';
import { ClimbTendrils } from '../components/plants/climb/ClimbTendrils';
import { PlantField } from '../components/plants/field/PlantField';
import { usePlantWindControls } from '../components/plants/wind/usePlantWindControls';
import { useFlowerCullControls } from '../components/plants/vat/useFlowerCullControls';
import { DirectionalLight } from '../components/scene/DirectionalLight';
import Effects from '../components/scene/Effects';
import { ShadowCatcher } from '../components/scene/ShadowCatcher';
import { setSimSpeedMul } from '../components/plants/lifecycle/simSpeed';
import { SCENE_DEFAULTS } from '../components/scene/sceneDefaults';
import { FLOW_OVERHEAD } from '../components/camera/cameraShots';
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
  const { simSpeed } = useControls('Sim', {
    simSpeed: { value: 1, min: 0, max: 12, step: 0.1, label: 'simSpeed ×' },
  });
  useEffect(() => { setSimSpeedMul(simSpeed); }, [simSpeed]);
  const plantWind = usePlantWindControls();
  const flowerCull = useFlowerCullControls();

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
        <Suspense fallback={null}>
          <PlantField
            bodyBounds={bodyBounds}
            backpackBounds={backpackBounds}
            wind={plantWind}
            cullControls={flowerCull}
          />
        </Suspense>
        <Suspense fallback={null}>
          <ClimbTendrils
            bodyBounds={bodyBounds}
            backpackBounds={backpackBounds}
            wind={plantWind}
          />
        </Suspense>
      </group>

      {/* Same value as ShadowCatcher's groundColor, so ground and sky are one
          flat tone and the plane's edge is never visible. */}
      <color attach="background" args={[bgColor]} />

      <CameraViewControl />
      <CanvasCapture />
      <DirectionalLight />
      <Effects />
    </>
  );
}

export const ExperienceCanvas = memo(function ExperienceCanvas() {
  const [dpr, setDpr] = useState(1.5);

  return (
    <Canvas
      shadows
      style={{ width: '100%', height: '100%' }}
      camera={{
        fov: 45,
        near: 0.1,
        far: 200,
        position: FLOW_OVERHEAD.position,
      }}
      gl={createWebGPURenderer}
      dpr={dpr}
    >
      <PerformanceMonitor
        bounds={() => [28, 32]}
        onFallback={() => setDpr(1)}
        onChange={({ factor }) => {
          setDpr(1 + factor);
          console.log('dpr', dpr);
        }}
      />
      <SceneContent />
    </Canvas>
  );
});
