import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  createVATSampleUV,
  sampleVATNormalFrameBlended,
  sampleVATPosition,
} from '@core/vat';
import { createFlowerPetalMaterial } from '../flower/createFlowerMaterials';

export function configureVatTexture(texture) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // EXR data textures are already bottom-up; browser-decoded PNGs are
  // top-down and need the flip to match.
  texture.flipY = !texture.isDataTexture;
  texture.needsUpdate = true;
  return texture;
}

export function createVatFlowerMaterials(
  posTex,
  nrmTex,
  meta,
  flowerUniforms,
  outlineUniforms,
  maskUniforms,
  maskTexture,
  veinTexture,
) {
  const frameUniform = uniform(0);
  const sampleUV = createVATSampleUV(frameUniform, meta);
  const vatPosition = sampleVATPosition(posTex, sampleUV);
  // Decode-then-blend across frames; blending raw oct-encoded texels
  // produces broken normals between frames (color flicker).
  const vatNormalLocal = sampleVATNormalFrameBlended(
    nrmTex,
    frameUniform,
    meta,
    meta.compressNormal ?? true,
  );

  // Single merged VAT mesh: inverted-hull outline backfaces stack at petal
  // overlaps. Use mask-edge outline in the petal fragment shader instead.
  const fillMaterial = createFlowerPetalMaterial(
    flowerUniforms,
    outlineUniforms,
    maskUniforms,
    maskTexture,
    veinTexture,
    { normalSource: vatNormalLocal },
  );
  fillMaterial.positionNode = vatPosition;

  return { fillMaterial, frameUniform };
}
