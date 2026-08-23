import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as THREE from 'three/webgpu';
import {
  BODY_MESH_NAMES,
  BODY_TEXTURE_PATHS,
  CHARACTER_MODEL_PATH,
  DETAIL_TEXTURE_PATHS,
} from '../config';
import { useKTX2Texture } from '@core';
import {
  attachOutline,
  configureLookTextures,
  createLookMaterial,
  createLookOutlineMaterial,
} from '../look/createLookMaterial';
import type {
  CharacterOutlineMaterial,
  CharacterToonMaterial,
} from '../materials/createToonNodeMaterial';

export function useCharacterAssets() {
  const gltf = useGLTF(CHARACTER_MODEL_PATH);
  const mesh = gltf.scene;
  const bodyTex = configureLookTextures(useKTX2Texture(BODY_TEXTURE_PATHS));
  const detailTex = configureLookTextures(useKTX2Texture(DETAIL_TEXTURE_PATHS));

  const { scene, animations, bodyMat, detailMat, outlineMat } = useMemo((): {
    scene: THREE.Object3D | null;
    animations: THREE.AnimationClip[];
    bodyMat: CharacterToonMaterial | null;
    detailMat: CharacterToonMaterial | null;
    outlineMat: CharacterOutlineMaterial | null;
  } => {
    if (!mesh || !bodyTex.map || !detailTex.map) {
      return {
        scene: null,
        animations: [],
        bodyMat: null,
        detailMat: null,
        outlineMat: null,
      };
    }

    const clonedScene = SkeletonUtils.clone(mesh as any);
    const bodyMat = createLookMaterial(bodyTex);
    const detailMat = createLookMaterial(detailTex);
    const outlineMat = createLookOutlineMaterial();

    const fillMeshes: THREE.Mesh[] = [];

    clonedScene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      child.frustumCulled = false;
      child.castShadow = true;
      child.receiveShadow = true;

      const baseName = child.name.replace(/\.\d+$/, '');

      if (
        BODY_MESH_NAMES.includes(child.name) ||
        BODY_MESH_NAMES.includes(baseName)
      ) {
        child.material = bodyMat;
        fillMeshes.push(child);
      } else if (!child.name.includes('Person')) {
        child.material = detailMat;
        fillMeshes.push(child);
      } else {
        child.visible = false;
      }
    });

    fillMeshes.forEach((m) => attachOutline(m, outlineMat));

    return {
      scene: clonedScene,
      animations: (gltf.animations ?? []).map((clip) => clip.clone()),
      bodyMat,
      detailMat,
      outlineMat,
    };
  }, [mesh, gltf, bodyTex, detailTex]);

  useEffect(() => () => {
    bodyMat?.dispose();
    detailMat?.dispose();
    outlineMat?.dispose();
  }, [bodyMat, detailMat, outlineMat]);

  return { scene, animations, bodyMat, detailMat, outlineMat };
}

useGLTF.preload(CHARACTER_MODEL_PATH);
