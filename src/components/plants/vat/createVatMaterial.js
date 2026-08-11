import * as THREE from 'three/webgpu';
import {
  attribute,
  cross,
  float,
  Fn,
  max,
  sqrt,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import {
  createVATSampleUV,
  sampleVATNormalFrameBlended,
  sampleVATPosition,
} from '@core/vat';
import { createFlowerVertexColorMaterial } from '../look/createFlowerMaterials';

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

/** Rotate vector v by unit quaternion q (xyzw). */
const rotateByQuat = Fn(([v, q]) => {
  const qvec = vec3(q.x, q.y, q.z);
  const t = cross(qvec, v).mul(2.0);
  return v.add(t.mul(q.w)).add(cross(qvec, t));
});

export function createVatFlowerMaterials(
  posTex,
  nrmTex,
  meta,
  flowerUniforms,
  maskUniforms,
  maskTexture,
  veinTexture,
  options = {},
) {
  const { usePetalCutout = true, useMaskEdge = true } = options;
  const frameUniform = uniform(0);
  const deformation = createVatDeformation(posTex, nrmTex, meta, frameUniform);

  // One merged ABC mesh: flower=(1,0,0), stem=(0,0,0) via COLOR_0.
  const material = createFlowerVertexColorMaterial(
    flowerUniforms,
    maskUniforms,
    maskTexture,
    veinTexture,
    {
      normalSource: deformation.vatNormalLocal,
      usePetalCutout,
      useMaskEdge,
    },
  );
  material.positionNode = deformation.vatPosition;

  return { material, frameUniform };
}

/**
 * Instanced VAT flowers.
 *
 * WebGPU caps vertex buffers at 8. VAT mesh already uses several
 * (position/uv/uv1/color…), so tip TRS + frame pack into two vec4s:
 *   aTip0 = (pos.xyz, scale)
 *   aTip1 = (quat.xyz, frame)  — quat.w = +sqrt(1-|q|^2)
 * (setFromUnitVectors keeps w ≥ 0 for our tip alignment.)
 */
export function createInstancedVatFlowerMaterials(
  posTex,
  nrmTex,
  meta,
  flowerUniforms,
  maskUniforms,
  maskTexture,
  veinTexture,
  options = {},
) {
  const { usePetalCutout = true, useMaskEdge = true } = options;
  const tip0 = attribute('aTip0', 'vec4'); // xyz pos, w scale
  const tip1 = attribute('aTip1', 'vec4'); // xyz quat, w frame
  const colorVar = attribute('aColorVar', 'vec2'); // hueShift, lightShift

  const frame = tip1.w;
  const deformation = createVatDeformation(posTex, nrmTex, meta, frame);
  const tipQuat4 = vec4(
    tip1.xyz,
    sqrt(max(float(1).sub(tip1.xyz.dot(tip1.xyz)), float(0))),
  );

  const material = createFlowerVertexColorMaterial(
    flowerUniforms,
    maskUniforms,
    maskTexture,
    veinTexture,
    {
      normalSource: rotateByQuat(deformation.vatNormalLocal, tipQuat4),
      usePetalCutout,
      useMaskEdge,
      colorVariation: {
        hueShift: colorVar.x,
        lightShift: colorVar.y,
      },
    },
  );

  material.positionNode = Fn(() => {
    const q4 = vec4(
      tip1.xyz,
      sqrt(max(float(1).sub(tip1.xyz.dot(tip1.xyz)), float(0))),
    );
    const local = deformation.vatPosition.mul(tip0.w);
    return rotateByQuat(local, q4).add(tip0.xyz);
  })();

  return { material };
}

/**
 * Strip attributes we don't sample so instanced tip packs fit WebGPU's
 * 8-vertex-buffer limit.
 */
export function prepareInstancedVatGeometry(geometry) {
  const geo = geometry.clone();
  // Normals come from the VAT texture, not the rest-pose attribute.
  geo.deleteAttribute('normal');
  geo.deleteAttribute('tangent');
  geo.deleteAttribute('uv2');
  geo.deleteAttribute('skinIndex');
  geo.deleteAttribute('skinWeight');
  return geo;
}
