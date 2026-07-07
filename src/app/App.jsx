import { AdaptiveDpr, CameraControls } from "@react-three/drei";
import { CanvasCapture } from "@core";
import { LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three/webgpu";
import { DirectionalLight } from "../components/DirectionalLight";
import Effects from "../components/Effects";
import { DahliaVAT } from "../components/dahlia-vat/DahliaVAT";
import { DahliaGeoNodes } from "../components/dahlia-geo/DahliaGeoNodes";
import { Flower } from "../components/Flower";
import { ProceduralSmoke } from "../components/ProceduralSmoke";
import { Character } from "../components/character/Character";
import { Environment } from "@react-three/drei";

export default function App() {
  const { bgColor } = useControls("Scene", {
    bgColor: { value: "#ede4d3", label: "background" },
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
          {/* <mesh rotation-x={-Math.PI / 2} scale={10} receiveShadow>
            <planeGeometry args={[2, 2]} />
            <meshStandardMaterial color="#eeeeee" />
          </mesh> */}
          {/* <DahliaVAT /> */}
          <DahliaGeoNodes position={[0, 1, 0]} />
          {/* <Flower /> */}
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
