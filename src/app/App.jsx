import { useCallback, useRef, useState } from "react";
import { AdaptiveDpr, CameraControls, Environment } from "@react-three/drei";
import { CanvasCapture, LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three/webgpu";
import { Character } from "../components/character/Character";
import { Backpack } from "../components/character/Backpack.tsx";
import { ClimbTendrils } from "../components/plants/climb/ClimbTendrils";
import { PlantField } from "../components/plants/field/PlantField";
import { DirectionalLight } from "../components/scene/DirectionalLight";
import Effects from "../components/scene/Effects";
import { ShadowCatcher } from "../components/scene/ShadowCatcher";
import { SCENE_DEFAULTS } from "../components/scene/sceneDefaults";

export default function App() {
  const fieldParentRef = useRef(null);
  const [bodyBounds, setBodyBounds] = useState(null);
  const [backpackBounds, setBackpackBounds] = useState(null);
  const [contactPoints, setContactPoints] = useState([]);
  const onBodyBounds = useCallback((bounds) => {
    setBodyBounds(bounds);
  }, []);
  const onBackpackBounds = useCallback((bounds) => {
    setBackpackBounds(bounds);
  }, []);
  const onStemBases = useCallback((bases) => {
    setContactPoints(bases);
  }, []);

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
          // Slight overhead three-quarter on the flower bed
          position: [1.4, 1.6, 2.2],
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
        <group ref={fieldParentRef} position={[0, -1, 0]}>
          <Character
            mode="tableau"
            pose="Lay"
            position={[0, 0.6, 0]}
            scale={1.5}
            fieldParentRef={fieldParentRef}
            onBodyBounds={onBodyBounds}
            contactPoints={contactPoints}
          />
          {/* <Backpack
            position={[-1.8, 0.1, -0.5]}
            rotation={[THREE.MathUtils.degToRad(0), THREE.MathUtils.degToRad(200), THREE.MathUtils.degToRad(-5)]}
            scale={1.5}
            fieldParentRef={fieldParentRef}
            contactPoints={contactPoints}
            onBounds={onBackpackBounds}
          /> */}
          <ShadowCatcher groundColor={bgColor} />
          {/* <PlantField bodyBounds={bodyBounds} onStemBases={onStemBases} /> */}
          <ClimbTendrils bodyBounds={bodyBounds} backpackBounds={backpackBounds} />
        </group>

        <color attach="background" args={[bgColor]} />
        <Environment preset="sunset" />

        <AdaptiveDpr pixelated />
        <CameraControls makeDefault maxPolarAngle={Math.PI / 2.5} />
        <CanvasCapture />
        <DirectionalLight />
        <Effects />
      </Canvas>
    </>
  );
}
