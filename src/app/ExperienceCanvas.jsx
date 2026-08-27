import {
  useLayoutEffect,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { PerformanceMonitor } from "@react-three/drei";
import { CameraViewControl } from "../components/camera/CameraViewControl";
import { AsyncCompile, AudioManager, Bgm, CanvasCapture } from "@core";
import { Canvas, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three/webgpu";
import { Character } from "../components/character/Character";
import { Backpack } from "../components/character/Backpack.tsx";
import { ClimbTendrils } from "../components/plants/climb/ClimbTendrils";
import { PlantField } from "../components/plants/field/PlantField";
import { usePlantWindControls } from "../components/plants/wind/usePlantWindControls";
import { useFlowerCullControls } from "../components/plants/vat/useFlowerCullControls";
import { DirectionalLight } from "../components/scene/DirectionalLight";
import Effects from "../components/scene/Effects";
import { ShadowCatcher } from "../components/scene/ShadowCatcher";
import { setSimSpeedMul } from "../components/plants/lifecycle/simSpeed";
import { useLifecyclePauseHotkey } from "../components/plants/lifecycle/useLifecyclePauseHotkey";
import { getLiveThemeColors } from "../components/scene/themeTween";
import { FLOW_OVERHEAD } from "../components/camera/cameraShots";
import { TIER1_TARGETS, useExperienceStore } from "../core/experienceStore";
import { BGM_TRACKS } from "../ui/AudioButton";
import { Demo } from "../components/demo/Demo";

function createWebGPURenderer(canvas) {
  const renderer = new THREE.WebGPURenderer({
    ...canvas,
    powerPreference: "high-performance",
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

function SceneBgm() {
  const listener = useExperienceStore((state) => state.audioListener);
  const isSoundOn = useExperienceStore((state) => state.isSoundOn);
  return <Bgm listener={listener} active={isSoundOn} tracks={BGM_TRACKS} />;
}

function SceneBackground() {
  const scene = useThree((state) => state.scene);
  useLayoutEffect(() => {
    scene.background = getLiveThemeColors().bg;
    return () => {
      scene.background = null;
    };
  }, [scene]);
  return null;
}

function SceneContent() {
  const fieldParentRef = useRef(null);
  const [bodyBounds, setBodyBounds] = useState(null);
  const [backpackBounds, setBackpackBounds] = useState(null);
  useLifecyclePauseHotkey();

  const { simSpeed } = useControls("Sim", {
    simSpeed: { value: 1, min: 0, max: 12, step: 0.1, label: "simSpeed ×" },
  });
  useEffect(() => {
    setSimSpeedMul(simSpeed);
  }, [simSpeed]);

  const plantWind = usePlantWindControls();
  const flowerCull = useFlowerCullControls();

  const setComponentReady = useExperienceStore(
    (state) => state.setComponentReady,
  );
  const setAudioListener = useExperienceStore(
    (state) => state.setAudioListener,
  );

  return (
    <>
      <group ref={fieldParentRef} position={[0, -1, 0]}>
        {/* <Suspense fallback={null}>
          <AsyncCompile id={TIER1_TARGETS[0]} onReady={setComponentReady}>
            <Character
              position={[0, 0.6, 0]}
              scale={1.5}
              fieldParentRef={fieldParentRef}
              onBounds={setBodyBounds}
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
              onBounds={setBackpackBounds}
            />
          </AsyncCompile>
        </Suspense>
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
        </Suspense> */}

        <Suspense fallback={null}>
          <Demo />
        </Suspense>
        
        <ShadowCatcher />
      </group>

      <SceneBackground />

      <AudioManager onListenerCreated={setAudioListener} />
      <Suspense fallback={null}>
        <SceneBgm />
      </Suspense>
      <CameraViewControl />
      <CanvasCapture />
      <DirectionalLight />
      {/* <Effects /> */}
    </>
  );
}

// Isolates the WebGPU canvas from App re-renders (intro progress).
export const ExperienceCanvas = memo(function ExperienceCanvas() {
  const [dpr, setDpr] = useState(2);

  return (
    <Canvas
      shadows
      style={{ width: "100%", height: "100%" }}
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
        }}
      />

      <SceneContent />
    </Canvas>
  );
});
