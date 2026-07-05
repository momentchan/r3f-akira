import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  createVATSampleUV,
  sampleVATNormalFrameBlended,
  sampleVATPosition,
} from '@core/vat';
import { createFlowerVertexColorMaterial } from '../flower/createFlowerMaterials';

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

function createVatDeformation(posTex, nrmTex, meta, frameUniform) {
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

  return { vatPosition, vatNormalLocal };
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
  const deformation = createVatDeformation(posTex, nrmTex, meta, frameUniform);

  // One merged ABC mesh: flower=(1,0,0), stem=(0,0,0) via COLOR_0.
  const material = createFlowerVertexColorMaterial(
    flowerUniforms,
    outlineUniforms,
    maskUniforms,
    maskTexture,
    veinTexture,
    { normalSource: deformation.vatNormalLocal },
  );
  material.positionNode = deformation.vatPosition;

  return { material, frameUniform };
}
