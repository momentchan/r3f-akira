import { useMemo } from 'react';
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
import { CHARACTER_LOOK_DEFAULTS } from '../look/characterDefaults';
import {
  createOutlineMaterial,
  createToonNodeMaterial,
  type CharacterOutlineMaterial,
  type CharacterToonMaterial,
} from '../materials/createToonNodeMaterial';

const configureTextures = (textures: any) => {
  if (textures.map) textures.map.colorSpace = THREE.SRGBColorSpace;
  if (textures.dirtMap) textures.dirtMap.colorSpace = THREE.SRGBColorSpace;
  if (textures.normalMap) textures.normalMap.colorSpace = THREE.NoColorSpace;
  if (textures.aoMap) textures.aoMap.colorSpace = THREE.NoColorSpace;
  if (textures.metalnessMap) textures.metalnessMap.colorSpace = THREE.NoColorSpace;

  ['map', 'dirtMap', 'metalnessMap', 'aoMap', 'normalMap'].forEach((key) => {
    if (textures[key]) textures[key].flipY = false;
  });
  return textures;
};

function createLookMaterial(textures: {
  map?: THREE.Texture;
  dirtMap?: THREE.Texture;
  aoMap?: THREE.Texture;
}) {
  return createToonNodeMaterial({
    textures: {
      map: textures.map,
      dirtMap: textures.dirtMap,
      aoMap: textures.aoMap,
    },
    ...CHARACTER_LOOK_DEFAULTS,
    lightDir: new THREE.Vector3(...CHARACTER_LOOK_DEFAULTS.lightDir),
  });
}

function attachOutlineClone(source: THREE.Mesh, outlineMat: CharacterOutlineMaterial) {
  let outline: THREE.Mesh;

  if ((source as THREE.SkinnedMesh).isSkinnedMesh) {
    const skinned = source as THREE.SkinnedMesh;
    const outlineSkinned = new THREE.SkinnedMesh(skinned.geometry, outlineMat);
    outlineSkinned.bind(skinned.skeleton, skinned.bindMatrix);
    outlineSkinned.bindMode = skinned.bindMode;
    outline = outlineSkinned;
  } else {
    outline = new THREE.Mesh(source.geometry, outlineMat);
  }

  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = (source.renderOrder ?? 0) - 1;
  outline.frustumCulled = false;
  outline.name = `${source.name}_Outline`;
  source.parent?.add(outline);
  return outline;
}

function cloneEmbeddedClips(gltf: { animations?: THREE.AnimationClip[] }) {
  return (gltf.animations ?? []).map((clip) => {
    const cloned = clip.clone();
    // Keep Blender clip names (Lay / Fetal / Drift).
    return cloned;
  });
}

export function useCharacterAssets() {
  const gltf = useGLTF(CHARACTER_MODEL_PATH);
  const mesh = gltf.scene;
  const bodyTex = configureTextures(useKTX2Texture(BODY_TEXTURE_PATHS));
  const detailTex = configureTextures(useKTX2Texture(DETAIL_TEXTURE_PATHS));

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
    const outlineMat = createOutlineMaterial({
      edgeColor: CHARACTER_LOOK_DEFAULTS.edgeColor,
      outlineWidth: CHARACTER_LOOK_DEFAULTS.outlineWidth,
    });

    const fillMeshes: THREE.Mesh[] = [];

    clonedScene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      child.frustumCulled = false;
      child.castShadow = true;
      child.receiveShadow = true;

      // Blender may suffix duplicates with ".001"
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

    fillMeshes.forEach((m) => attachOutlineClone(m, outlineMat));

    return {
      scene: clonedScene,
      animations: cloneEmbeddedClips(gltf),
      bodyMat,
      detailMat,
      outlineMat,
    };
  }, [mesh, gltf, bodyTex, detailTex]);

  return { scene, animations, bodyMat, detailMat, outlineMat };
}

useGLTF.preload(CHARACTER_MODEL_PATH);
