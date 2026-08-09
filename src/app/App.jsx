import { AdaptiveDpr, CameraControls } from "@react-three/drei";
import { CanvasCapture } from "@core";
import { LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three/webgpu";
import { DirectionalLight } from "../components/scene/DirectionalLight";
import Effects from "../components/scene/Effects";
import { PlantField } from "../components/plants/field/PlantField";
import { ShadowCatcher } from "../components/scene/ShadowCatcher";
import { ProceduralSmoke } from "../components/smoke/ProceduralSmoke";
import { Character } from "../components/character/Character";
import { Environment } from "@react-three/drei";
import { SCENE_DEFAULTS } from "../components/scene/sceneDefaults";

export default function App() {
  const { bgColor } = useControls("Scene", {
    bgColor: { value: SCENE_DEFAULTS.bgColor, label: "background" },
  });

  return (
    <>
      <LevaWrapper />

      <Canvas
        shadows
        camera={{
          fov: 45,
          near: 0.1,
          far: 200,
          position: [0, 0, 3],
        }}
        gl={(canvas) => {
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
        }}
        dpr={[1, 2]}
        performance={{ min: 0.5, max: 1 }}
      >
        <group position={[0, -1, 0]}>
          {/* <Character /> */}
          <ShadowCatcher groundColor={bgColor} />
          <PlantField />
          {/* <ProceduralSmoke position={[0, 0.1, 0]} /> */}
        </group>

        <color attach="background" args={[bgColor]} />
        <Environment preset="sunset" />

        <AdaptiveDpr pixelated />
        <CameraControls makeDefault />
        <CanvasCapture />
        <DirectionalLight />
        <Effects />
      </Canvas>
    </>
  );
}
