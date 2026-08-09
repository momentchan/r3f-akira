import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as THREE from 'three/webgpu';
import { BODY_MESH_NAMES, BODY_TEXTURE_PATHS, DETAIL_TEXTURE_PATHS, MODEL_PATHS } from '../config';
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
  if (textures.normalMap) textures.normalMap.colorSpace = THREE.NoColorSpace;
  if (textures.aoMap) textures.aoMap.colorSpace = THREE.NoColorSpace;
  if (textures.metalnessMap) textures.metalnessMap.colorSpace = THREE.NoColorSpace;

  ['map', 'metalnessMap', 'aoMap', 'normalMap'].forEach((key) => {
    if (textures[key]) textures[key].flipY = false;
  });
  return textures;
};

const extractClip = (gltf: any, name: string): THREE.AnimationClip | null => {
  if (!gltf?.animations?.[0]) return null;
  const clip = gltf.animations[0].clone();
  clip.name = name;
  return clip;
};

function createLookMaterial(textures: { map?: THREE.Texture; aoMap?: THREE.Texture }) {
  return createToonNodeMaterial({
    textures: {
      map: textures.map,
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

export function useCharacterAssets() {
  const [meshData, idleAnim, walkAnim, runAnim, backAnim] = useGLTF(MODEL_PATHS);
  const mesh = meshData.scene;
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

      if (BODY_MESH_NAMES.includes(child.name)) {
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

    const anims = [
      { src: idleAnim, name: 'Idle' },
      { src: walkAnim, name: 'Walk' },
      { src: runAnim, name: 'Run' },
      { src: backAnim, name: 'Back' },
    ]
      .map(({ src, name }) => extractClip(src, name))
      .filter((clip): clip is THREE.AnimationClip => clip !== null);

    return { scene: clonedScene, animations: anims, bodyMat, detailMat, outlineMat };
  }, [mesh, idleAnim, walkAnim, runAnim, backAnim, bodyTex, detailTex]);

  return { scene, animations, bodyMat, detailMat, outlineMat };
}
