import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as THREE from 'three/webgpu';
import { Fn, oneMinus, texture, uv } from 'three/tsl';
import { BODY_MESH_NAMES, BODY_TEXTURE_PATHS, DETAIL_TEXTURE_PATHS, MODEL_PATHS } from '../config';
import { useKTX2Texture } from '@core';

const configureTextures = (textures: any) => {
  if (textures.map) textures.map.colorSpace = THREE.SRGBColorSpace;
  if (textures.normalMap) textures.normalMap.colorSpace = THREE.NoColorSpace; 
  if (textures.aoMap) textures.aoMap.colorSpace = THREE.NoColorSpace;
  if (textures.metalnessMap) textures.metalnessMap.colorSpace = THREE.NoColorSpace;
  
  ['map', 'metalnessMap', 'aoMap', 'normalMap'].forEach(key => {
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

export function useCharacterAssets() {
  const [meshData, idleAnim, walkAnim, runAnim, backAnim] = useGLTF(MODEL_PATHS);

  const mesh = meshData.scene;

  const bodyTex = configureTextures(useKTX2Texture(BODY_TEXTURE_PATHS))
  const detailTex = configureTextures(useKTX2Texture(DETAIL_TEXTURE_PATHS));

  const { scene, animations } = useMemo((): { scene: THREE.Object3D | null; animations: THREE.AnimationClip[] } => {
    
    if (!mesh || !bodyTex.map || !detailTex.map) return { scene: null, animations: [] };

    const clonedScene = SkeletonUtils.clone(mesh as any);

    // --- Material Setup ---
    const bodyMat = new THREE.MeshStandardNodeMaterial({
      map: bodyTex.map,
      aoMap: bodyTex.aoMap,
      normalMap: bodyTex.normalMap,
      metalnessMap: bodyTex.metalnessMap,
      metalness: 1,
    });
    bodyMat.roughnessNode = Fn(() => oneMinus(texture(bodyTex.metalnessMap, uv())))();

    const detailMat = new THREE.MeshStandardNodeMaterial({
      map: detailTex.map,
      aoMap: detailTex.aoMap,
      normalMap: detailTex.normalMap,
      metalnessMap: detailTex.metalnessMap,
      metalness: 1,
    })

    detailMat.roughnessNode = Fn(() => oneMinus(texture(detailTex.metalnessMap, uv())))();

    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.frustumCulled = false;

        if (BODY_MESH_NAMES.includes(child.name)) {
          child.material = bodyMat;
        } else if (!child.name.includes('Person')) {
          child.material = detailMat;
        } else {
          child.visible = false;
        }
      }
    });

    // --- Animations Setup ---
    const animConfig = [
      { src: idleAnim, name: 'Idle' },
      { src: walkAnim, name: 'Walk' },
      { src: runAnim,  name: 'Run'  },
      { src: backAnim, name: 'Back' },
    ];

    const anims = animConfig
      .map(({ src, name }) => extractClip(src, name))
      .filter((clip): clip is THREE.AnimationClip => clip !== null);

    return { scene: clonedScene, animations: anims };
  }, [
    mesh,
    idleAnim,
    walkAnim,
    runAnim,
    backAnim,
    bodyTex,
    detailTex,
  ]);

  return { scene, animations };
}
