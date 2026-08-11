import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useGLTF } from '@react-three/drei';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import { useKTX2Texture } from '@core';
import {
  BACKPACK_MODEL_PATH,
  DETAIL_TEXTURE_PATHS,
} from './config';
import { CHARACTER_LOOK_DEFAULTS } from './look/characterDefaults';
import {
  createCharacterControlsSchema,
  syncCharacterControls,
} from './look/characterControls';
import {
  createOutlineMaterial,
  createToonNodeMaterial,
  type CharacterOutlineMaterial,
} from './materials/createToonNodeMaterial';
import { bakeContactDirt } from './utils/bakeContactDirt';

type StemBaseXZ = { x: number; z: number };

type Props = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  fieldParentRef?: RefObject<THREE.Object3D | null>;
  contactPoints?: StemBaseXZ[];
};

function configureTextures(textures: Record<string, THREE.Texture | undefined>) {
  if (textures.map) textures.map.colorSpace = THREE.SRGBColorSpace;
  if (textures.dirtMap) textures.dirtMap.colorSpace = THREE.SRGBColorSpace;
  if (textures.aoMap) textures.aoMap.colorSpace = THREE.NoColorSpace;
  ['map', 'dirtMap', 'aoMap'].forEach((key) => {
    if (textures[key]) textures[key]!.flipY = false;
  });
  return textures;
}

function attachOutline(source: THREE.Mesh, outlineMat: CharacterOutlineMaterial) {
  const outline = new THREE.Mesh(source.geometry, outlineMat);
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = (source.renderOrder ?? 0) - 1;
  outline.frustumCulled = false;
  outline.name = `${source.name}_Outline`;
  source.add(outline);
}

/**
 * Ground backpack prop — Details toon + contact dirt + outline.
 * Expects a clean Blender export (origin at pivot, applied scale/rot, at 0,0,0).
 */
export function Backpack({
  position = [0.55, 0, 0.35],
  rotation = [0, 0.6, 0],
  scale = 1,
  fieldParentRef,
  contactPoints,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF(BACKPACK_MODEL_PATH);
  const detailTex = configureTextures(useKTX2Texture(DETAIL_TEXTURE_PATHS) as any);

  const schema = useMemo(
    () => createCharacterControlsSchema(CHARACTER_LOOK_DEFAULTS),
    [],
  );
  const controls = useControls('Character', schema, { collapsed: true });

  const { scene, lookMat, outlineMat } = useMemo(() => {
    if (!gltf.scene || !detailTex.map) {
      return { scene: null, lookMat: null, outlineMat: null };
    }

    const lookMat = createToonNodeMaterial({
      textures: {
        map: detailTex.map,
        dirtMap: detailTex.dirtMap,
        aoMap: detailTex.aoMap,
      },
      ...CHARACTER_LOOK_DEFAULTS,
      lightDir: new THREE.Vector3(...CHARACTER_LOOK_DEFAULTS.lightDir),
    });
    const outlineMat = createOutlineMaterial({
      edgeColor: CHARACTER_LOOK_DEFAULTS.edgeColor,
      outlineWidth: CHARACTER_LOOK_DEFAULTS.outlineWidth,
    });

    const root = gltf.scene.clone(true);
    root.name = 'Backpack';
    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    for (const child of meshes) {
      child.frustumCulled = false;
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = lookMat;

      const pos = child.geometry?.getAttribute?.('position');
      if (pos && !child.geometry.getAttribute('aContactDirt')) {
        child.geometry.setAttribute(
          'aContactDirt',
          new THREE.BufferAttribute(new Float32Array(pos.count), 1),
        );
      }
      attachOutline(child, outlineMat);
    }

    return { scene: root, lookMat, outlineMat };
  }, [gltf.scene, detailTex]);

  useEffect(() => {
    if (!lookMat) return;
    syncCharacterControls(
      controls,
      [lookMat.userData.toonUniforms],
      outlineMat?.userData.outlineUniforms,
    );
  }, [lookMat, outlineMat, controls]);

  useEffect(() => {
    if (!groupRef.current || !fieldParentRef?.current || !scene) return;
    bakeContactDirt(
      groupRef.current,
      fieldParentRef.current,
      contactPoints ?? [],
      { inner: 0.1, outer: 0.55 },
    );
  }, [contactPoints, fieldParentRef, scene]);

  useEffect(() => () => {
    lookMat?.dispose();
    outlineMat?.dispose();
  }, [lookMat, outlineMat]);

  if (!scene) return null;

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(BACKPACK_MODEL_PATH);
