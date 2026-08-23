import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import { useKTX2Texture } from '@core';
import { useBindPlantShadow, usePlantShadowLight } from '../scene/plantShadowLayer';
import {
  BACKPACK_MODEL_PATH,
  DETAIL_TEXTURE_PATHS,
} from './config';
import {
  attachOutline,
  configureLookTextures,
  createLookMaterial,
  createLookOutlineMaterial,
} from './look/createLookMaterial';
import { useCharacterLook } from './hooks/useCharacterLook';
import {
  useWrapHostBounds,
  type WrapHostBoundsPayload,
} from './hooks/useWrapHostBounds';

type Props = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  fieldParentRef?: RefObject<THREE.Object3D | null>;
  onBounds?: (bounds: WrapHostBoundsPayload | null) => void;
};

export function Backpack({
  position = [0.55, 0, 0.35],
  rotation = [0, 0.6, 0],
  scale = 1,
  fieldParentRef,
  onBounds,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF(BACKPACK_MODEL_PATH);
  const detailTex = configureLookTextures(
    useKTX2Texture(DETAIL_TEXTURE_PATHS) as Record<string, THREE.Texture | undefined>,
  );

  const boundsKey = `${position.join(',')}:${rotation.join(',')}:${scale}`;
  useWrapHostBounds({
    groupRef,
    fieldParentRef,
    enabled: Boolean(onBounds),
    revisionKey: boundsKey,
    onBounds,
  });

  const { scene, lookMat, outlineMat } = useMemo(() => {
    if (!gltf.scene || !detailTex.map) {
      return { scene: null, lookMat: null, outlineMat: null };
    }

    const lookMat = createLookMaterial(detailTex);
    const outlineMat = createLookOutlineMaterial();
    const root = gltf.scene.clone(true);
    root.name = 'Backpack';

    const fillMeshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.frustumCulled = false;
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = lookMat;
      fillMeshes.push(child);
    });
    fillMeshes.forEach((m) => attachOutline(m, outlineMat));

    return { scene: root, lookMat, outlineMat };
  }, [gltf.scene, detailTex]);

  const plantShadowLight = usePlantShadowLight();
  useBindPlantShadow(plantShadowLight, lookMat);
  useCharacterLook(outlineMat, fieldParentRef, lookMat);

  useEffect(() => () => {
    lookMat?.dispose();
    outlineMat?.dispose();
  }, [lookMat, outlineMat]);

  if (!scene) return null;

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale} dispose={null}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(BACKPACK_MODEL_PATH);
