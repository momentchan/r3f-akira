import { AdaptiveDpr, CameraControls, Environment } from "@react-three/drei";
import { CanvasCapture } from "@core";
import { LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { Character } from "../components/character/Character";
import { DirectionalLight } from "../components/DirectionalLight";
import Effects from "../components/Effects";

export default function App() {
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
          const renderer = new WebGPURenderer({
            ...canvas,
            powerPreference: "high-performance",
            antialias: true,
            alpha: false,
            stencil: false,
            shadowMap: true,
            preserveDrawingBuffer: true,
          });
          return renderer.init().then(() => renderer);
        }}
        dpr={[1, 2]}
        performance={{ min: 0.5, max: 1 }}
      >
        <group position={[0, -1, 0]}>
          <Character />
          <mesh rotation-x={-Math.PI / 2} scale={10} receiveShadow>
            <planeGeometry args={[2, 2]} />
            <meshStandardMaterial color="color" />
          </mesh>
        </group>

        <AdaptiveDpr pixelated />
        <CameraControls makeDefault />
        <CanvasCapture />
        <Environment preset="city"  environmentIntensity={0.2} />
        <DirectionalLight />
        <Effects />
      </Canvas>
    </>
  );
}
