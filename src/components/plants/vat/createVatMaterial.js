import * as THREE from 'three/webgpu';
import {
  attribute,
  clamp,
  cross,
  float,
  floor,
  Fn,
  fract,
  length,
  max,
  mix,
  sin,
  sqrt,
  step,
  uniform,
  vec2,
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

/** Live-tunable petal shed (death) settings. */
export function createPetalShedUniforms(defaults = {}) {
  return {
    rise: uniform(defaults.rise ?? 2), // multiples of the plant's stem length
    riseVariance: uniform(defaults.riseVariance ?? 0.5), // ± per-petal height spread
    spread: uniform(defaults.spread ?? 0.35),
    stagger: uniform(defaults.stagger ?? 0.55),
  };
}

/** Cheap stable hash of a petal id in 0..1. */
const petalHash = (petalId, salt) => fract(sin(petalId.mul(127.1).add(salt)).mul(43758.5453));

/**
 * Petal shed: each petal shrinks toward ITS OWN centre while floating upward, so
 * the flower comes apart petal by petal instead of the whole head scaling down.
 *
 * The pivot is recovered from COLOR_0.b (a vertex index written by
 * assignPetalSegments) rebuilt into a VAT texel with the same layout
 * setupVATGeometry uses, then sampled at the current frame — so the pivot follows
 * the animation rather than sitting at the rest pose.
 *
 * Returns the shrunk LOCAL position plus the world-space lift height. The lift is
 * kept out of local space on purpose: local units are scaled by the tiny per-tip
 * scale, so expressing "rise ~2x the stem length" is only meaningful in world.
 */
function applyPetalShed(basePos, vertexColor, shed, frame, posTex, meta, shedUniforms) {
  const petalId = vertexColor.g;
  const pivotIndex = vertexColor.b;

  const texW = float(meta.textureWidth);
  const texH = float(meta.textureHeight);
  const frameStride = float(meta.frameCount + (meta.padding ?? 2));
  const column = floor(pivotIndex.div(texH));
  const row = pivotIndex.sub(column.mul(texH));
  const frameIndex = float(meta.frameCount - 1).mul(frame);
  const pivot = sampleVATPosition(posTex, vec2(
    column.mul(frameStride).add(0.5).add(frameIndex).div(texW),
    row.add(0.5).div(texH),
  ));

  // Independent per-petal randoms: when it leaves, and how far it gets.
  const startJitter = petalHash(petalId, float(0.0));
  const heightJitter = petalHash(petalId, float(7.13));

  // Stagger start times so petals leave a few at a time, not all together.
  const span = max(float(1).sub(shedUniforms.stagger), float(0.05));
  const t = clamp(shed.sub(startJitter.mul(shedUniforms.stagger)).div(span), 0.0, 1.0);
  // Smoothstep the whole departure so it eases in and settles out — a linear ramp
  // reads as a mechanical slide, this drifts.
  const ease = t.mul(t).mul(float(3).sub(t.mul(2)));

  // Shrink about the petal's own centre.
  const isPetal = step(float(0.5), vertexColor.r);
  const shrunk = pivot.add(basePos.sub(pivot).mul(ease.oneMinus()));
  const local = mix(basePos, shrunk, isPetal);

  // Height varies per petal around the configured multiple of stem length.
  const heightMul = float(1).add(heightJitter.sub(0.5).mul(2.0).mul(shedUniforms.riseVariance));
  const lift = shedUniforms.rise.mul(max(heightMul, float(0))).mul(ease).mul(isPetal);

  // Outward direction from the flower axis, still in local space — the caller
  // rotates it with the head so the fan follows however the bloom is tilted.
  const radial = vec3(pivot.x, 0.0, pivot.z);
  const outward = radial.div(max(length(radial), float(1e-4)));
  const spreadAmount = shedUniforms.spread.mul(ease).mul(isPetal);

  return { local, lift, outward, spreadAmount };
}

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
  const { usePetalCutout = true, useMaskEdge = true, shedDefaults } = options;
  const tip0 = attribute('aTip0', 'vec4'); // xyz pos, w scale
  const tip1 = attribute('aTip1', 'vec4'); // xyz quat, w frame
  // hueShift, lightShift, shed progress, stem length (world units, for the lift)
  const colorVar = attribute('aColorVar', 'vec4');
  const vertexColor = attribute('color', 'vec3'); // r part tag, g petalId, b pivot idx
  const shedUniforms = createPetalShedUniforms(shedDefaults);

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
    const shedPos = applyPetalShed(
      deformation.vatPosition,
      vertexColor,
      colorVar.z,
      frame,
      posTex,
      meta,
      shedUniforms,
    );
    const local = shedPos.local.mul(tip0.w);
    const world = rotateByQuat(local, q4).add(tip0.xyz);
    // Lift and fan in WORLD space, both in multiples of this plant's stem length,
    // so the two are directly comparable and the petals clear the flower whatever
    // its tilt or scale. (Spread in local units was swamped by the world rise.)
    const stemLen = colorVar.w;
    const fan = rotateByQuat(shedPos.outward, q4).mul(shedPos.spreadAmount.mul(stemLen));
    return world
      .add(vec3(0.0, 1.0, 0.0).mul(shedPos.lift.mul(stemLen)))
      .add(fan);
  })();

  return { material, shedUniforms };
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
