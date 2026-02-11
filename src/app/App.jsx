import { AdaptiveDpr, CameraControls, Environment } from "@react-three/drei";
import { CanvasCapture } from "@core";
import { LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { Character } from "../components/character/Character";

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
        <Character position={[0, -1, 0]} />
        <AdaptiveDpr pixelated />
        <CameraControls makeDefault />
        <CanvasCapture />
        <directionalLight position={[10, 10, 10]} intensity={1} />
        <Environment preset="city" />
      </Canvas>
    </>
  );
}
