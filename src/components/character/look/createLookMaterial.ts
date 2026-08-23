import * as THREE from 'three/webgpu';
import { CHARACTER_LOOK_DEFAULTS } from './characterDefaults';
import {
  createOutlineMaterial,
  createToonNodeMaterial,
  type CharacterOutlineMaterial,
  type CharacterToonMaterial,
} from '../materials/createToonNodeMaterial';

export function configureLookTextures(
  textures: Record<string, THREE.Texture | undefined>,
) {
  for (const tex of [textures.map, textures.dirtMap]) {
    if (!tex) continue;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
  }
  return textures;
}

export function createLookMaterial(textures: {
  map?: THREE.Texture;
  dirtMap?: THREE.Texture;
}): CharacterToonMaterial {
  return createToonNodeMaterial({
    textures: {
      map: textures.map,
      dirtMap: textures.dirtMap,
    },
    ...CHARACTER_LOOK_DEFAULTS,
    lightDir: new THREE.Vector3(...CHARACTER_LOOK_DEFAULTS.lightDir),
  });
}

export function createLookOutlineMaterial(): CharacterOutlineMaterial {
  return createOutlineMaterial({
    edgeColor: CHARACTER_LOOK_DEFAULTS.edgeColor,
    outlineWidth: CHARACTER_LOOK_DEFAULTS.outlineWidth,
  });
}

export function attachOutline(
  source: THREE.Mesh,
  outlineMat: CharacterOutlineMaterial,
) {
  const skinned = source as THREE.SkinnedMesh;
  const outline = skinned.isSkinnedMesh
    ? new THREE.SkinnedMesh(skinned.geometry, outlineMat)
    : new THREE.Mesh(source.geometry, outlineMat);

  if (skinned.isSkinnedMesh) {
    (outline as THREE.SkinnedMesh).bind(skinned.skeleton, skinned.bindMatrix);
    (outline as THREE.SkinnedMesh).bindMode = skinned.bindMode;
  }

  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = (source.renderOrder ?? 0) - 1;
  outline.frustumCulled = false;
  outline.name = `${source.name}_Outline`;
  if (skinned.isSkinnedMesh) source.parent?.add(outline);
  else source.add(outline);
  return outline;
}
