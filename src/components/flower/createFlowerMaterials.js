import * as THREE from 'three/webgpu';
import {
  Discard,
  Fn,
  If,
  Loop,
  abs,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  modelViewPosition,
  normalLocal,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  transformNormal,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { FLOWER_DEFAULTS } from './flowerDefaults';

const hash3 = Fn(([p]) => {
  const point = vec3(p);
  return fract(sin(dot(point, vec3(127.1, 311.7, 191.9))).mul(43758.5453));
});

const noise3 = Fn(([p]) => {
  const point = vec3(p).toVar();
  const cell = floor(point).toVar();
  const local = fract(point).toVar();
  const fade = local.mul(local).mul(vec3(3.0).sub(local.mul(2.0))).toVar();

  const n000 = hash3(cell.add(vec3(0.0, 0.0, 0.0)));
  const n100 = hash3(cell.add(vec3(1.0, 0.0, 0.0)));
  const n010 = hash3(cell.add(vec3(0.0, 1.0, 0.0)));
  const n110 = hash3(cell.add(vec3(1.0, 1.0, 0.0)));
  const n001 = hash3(cell.add(vec3(0.0, 0.0, 1.0)));
  const n101 = hash3(cell.add(vec3(1.0, 0.0, 1.0)));
  const n011 = hash3(cell.add(vec3(0.0, 1.0, 1.0)));
  const n111 = hash3(cell.add(vec3(1.0, 1.0, 1.0)));

  const nx00 = mix(n000, n100, fade.x);
  const nx10 = mix(n010, n110, fade.x);
  const nx01 = mix(n001, n101, fade.x);
  const nx11 = mix(n011, n111, fade.x);
  const nxy0 = mix(nx00, nx10, fade.y);
  const nxy1 = mix(nx01, nx11, fade.y);

  return mix(nxy0, nxy1, fade.z);
});

const fbm3 = Fn(([p]) => {
  const point = vec3(p).toVar();
  const value = float(0.0).toVar();
  const amplitude = float(0.5).toVar();

  Loop(4, () => {
    value.addAssign(amplitude.mul(noise3(point)));
    point.mulAssign(2.03);
    amplitude.mulAssign(0.5);
  });

  return value;
});

function applyPaperGrain(color, grainUniforms) {
  const grainCoord = positionWorld.xy
    .add(positionWorld.yz.mul(0.37))
    .mul(grainUniforms.scale)
    .toVar();
  const grainSample = hash3(vec3(grainCoord, 0.0))
    .mul(2.0)
    .sub(1.0)
    .mul(grainUniforms.strength)
    .toVar();

  return clamp(color.mul(float(1.0).add(grainSample)), 0.0, 1.0);
}

function createVeinLinesFromTextureFn(veinTexture, veinUniforms) {
  return Fn(([uvCoord, petalId]) => {
    // petalId is vertex color G in 0–1; offsets distortion and coverage only.
    const petalSeed = petalId.mul(veinUniforms.petalVariation).toVar();
    const petalOffset = vec2(petalSeed, petalSeed.add(0.37)).toVar();

    const centered = uvCoord.sub(0.5).toVar();
    const rotationCos = cos(veinUniforms.rotation).toVar();
    const rotationSin = sin(veinUniforms.rotation).toVar();
    const rotated = vec2(
      centered.x.mul(rotationCos).sub(centered.y.mul(rotationSin)),
      centered.x.mul(rotationSin).add(centered.y.mul(rotationCos)),
    ).add(0.5).toVar();

    // Hand-drawn wobble: push the lookup UV around with low-frequency noise
    // so the printed strokes stop being perfectly clean texture lines.
    const distortCoord = uvCoord
      .mul(veinUniforms.distortionScale)
      .add(petalOffset)
      .toVar();
    const wobble = vec2(
      noise3(vec3(distortCoord, 1.7)).sub(0.5),
      noise3(vec3(distortCoord, 9.2)).sub(0.5),
    ).mul(veinUniforms.distortion).toVar();

    const veinUV = rotated.mul(veinUniforms.scale).add(wobble).toVar();
    const sample = texture(veinTexture, veinUV);
    const veinLine = float(1.0).sub(sample.r);
    const stroke = step(veinUniforms.threshold, veinLine).toVar();

    // Organic coverage: a soft noise mask fades strokes in and out in
    // patches instead of showing every vein at full strength everywhere.
    const coverageNoise = noise3(
      vec3(uvCoord.mul(veinUniforms.coverageScale).add(petalOffset), petalSeed),
    ).toVar();
    const cutoff = float(1.0).sub(veinUniforms.coverage).toVar();
    const visibility = smoothstep(
      cutoff.sub(0.15),
      cutoff.add(0.15),
      coverageNoise,
    ).toVar();

    return stroke.mul(visibility);
  });
}

function createMaskAlphaFn(maskTexture) {
  return Fn(([uvCoord]) => {
    const sample = texture(maskTexture, uvCoord);
    return float(1.0).sub(sample.r);
  });
}

function createMaskEdgeFn(maskAlphaFn) {
  return Fn(([uvCoord, threshold, width]) => {
    const center = maskAlphaFn(uvCoord).toVar();
    const inside = step(threshold, center).toVar();
    const edge = float(0.0).toVar();

    Loop(8, ({ i }) => {
      const angle = float(i).mul(Math.PI * 0.25);
      const offset = vec2(cos(angle), sin(angle)).mul(width);
      const neighbor = maskAlphaFn(uvCoord.add(offset));
      edge.assign(
        max(edge, inside.mul(float(1.0).sub(step(threshold, neighbor)))),
      );
    });

    Loop(8, ({ i }) => {
      const angle = float(i).mul(Math.PI * 0.25);
      const offset = vec2(cos(angle), sin(angle)).mul(width.mul(1.6));
      const neighbor = maskAlphaFn(uvCoord.add(offset));
      edge.assign(
        max(edge, inside.mul(float(1.0).sub(step(threshold, neighbor)))),
      );
    });

    return clamp(edge, 0.0, 1.0);
  });
}

function applyMaskDiscard(maskAlphaFn, maskUniforms) {
  const maskAlpha = maskAlphaFn(uv()).toVar();
  If(maskAlpha.lessThan(maskUniforms.threshold), () => {
    Discard();
  });
}

export function createFlowerUniforms() {
  const { petal, vein, stem, grain } = FLOWER_DEFAULTS;
  const lightDir = uniform(new THREE.Vector3(0, 3, 5).normalize());

  return {
    lightDir,
    grain: {
      scale: uniform(grain.scale),
      strength: uniform(grain.strength),
    },
    petal: {
      lightDir,
      colorLevels: uniform(petal.colorLevels),
      gradientLevels: uniform(petal.gradientLevels),
      gradientBandStrength: uniform(petal.gradientBandStrength),
      shadowTint: uniform(new THREE.Color(petal.shadowTint)),
      highlightTint: uniform(new THREE.Color(petal.highlightTint)),
      rimStrength: uniform(petal.rimStrength),
      rimThreshold: uniform(petal.rimThreshold),
      rimPower: uniform(petal.rimPower),
      thresholdLow: uniform(petal.thresholdLow),
      thresholdHigh: uniform(petal.thresholdHigh),
      thresholdNoiseScale: uniform(petal.thresholdNoiseScale),
      thresholdNoiseStrength: uniform(petal.thresholdNoiseStrength),
      baseColor: uniform(new THREE.Color(petal.baseColor)),
      midColor: uniform(new THREE.Color(petal.midColor)),
      tipColor: uniform(new THREE.Color(petal.tipColor)),
    },
    vein: {
      scale: uniform(vein.scale),
      rotation: uniform(vein.rotation),
      threshold: uniform(vein.threshold),
      distortion: uniform(vein.distortion),
      distortionScale: uniform(vein.distortionScale),
      coverage: uniform(vein.coverage),
      coverageScale: uniform(vein.coverageScale),
      petalVariation: uniform(vein.petalVariation),
    },
    stem: {
      lightDir,
      colorLevels: uniform(stem.colorLevels),
      shadowColor: uniform(new THREE.Color(stem.shadowColor)),
      highlightColor: uniform(new THREE.Color(stem.highlightColor)),
      edgeColor: uniform(new THREE.Color(stem.edgeColor)),
      edgeThreshold: uniform(stem.edgeThreshold),
      edgeSoftness: uniform(stem.edgeSoftness),
      rimStrength: uniform(stem.rimStrength),
      rimThreshold: uniform(stem.rimThreshold),
      rimPower: uniform(stem.rimPower),
      thresholdLow: uniform(stem.thresholdLow),
      thresholdHigh: uniform(stem.thresholdHigh),
      thresholdNoiseScale: uniform(stem.thresholdNoiseScale),
      thresholdNoiseStrength: uniform(stem.thresholdNoiseStrength),
    },
  };
}

export function createFlowerMaskUniforms() {
  const { mask } = FLOWER_DEFAULTS;

  return {
    threshold: uniform(mask.threshold),
    edgeWidth: uniform(mask.edgeWidth),
  };
}

export function createFlowerOutlineUniforms() {
  const { outline } = FLOWER_DEFAULTS;

  return {
    outlineColor: uniform(new THREE.Color(outline.outlineColor)),
    outlineWidth: uniform(outline.outlineWidth),
  };
}

function buildQuantizedShade(shading, normalSource = normalLocal) {
  const N = transformNormal(normalSource).normalize().toVar();
  const V = cameraPosition.sub(positionWorld).normalize().toVar();
  const L = vec3(shading.lightDir).normalize().toVar();
  const ndl = max(dot(N, L), 0.0).toVar();

  const thresholdNoise = fbm3(
    positionWorld.mul(shading.thresholdNoiseScale),
  )
    .sub(0.5)
    .mul(shading.thresholdNoiseStrength)
    .toVar();

  const rimRaw = pow(
    float(1.0).sub(max(dot(N, V), 0.0)),
    shading.rimPower,
  ).toVar();
  const rimLift = step(shading.rimThreshold, rimRaw).mul(shading.rimStrength).toVar();

  const thresholdWidth = max(
    shading.thresholdHigh.sub(shading.thresholdLow),
    0.001,
  ).toVar();
  const levelSteps = max(shading.colorLevels.sub(1.0), 1.0).toVar();
  const shade = clamp(
    ndl
      .add(rimLift)
      .sub(shading.thresholdLow.add(thresholdNoise))
      .div(thresholdWidth),
    0.0,
    1.0,
  ).toVar();

  return {
    quantizedShade: floor(shade.mul(levelSteps).add(0.5)).div(levelSteps),
  };
}

function buildPetalGradient(petal, uvCoord) {
  const gradientT = float(1.0).sub(uvCoord.y).toVar();

  // Posterize the base->tip gradient toward flat woodblock-style zones.
  // Blended with the smooth gradient so band edges don't read as hard cuts.
  const levels = max(float(petal.gradientLevels), 1.0).toVar();
  const zone = clamp(floor(gradientT.mul(levels)), 0.0, levels.sub(1.0));
  const banded = zone.div(max(levels.sub(1.0), 1.0));
  gradientT.assign(mix(
    gradientT,
    banded,
    clamp(float(petal.gradientBandStrength), 0.0, 1.0),
  ));

  const midBand = smoothstep(0.08, 0.62, gradientT).toVar();
  const tipBand = smoothstep(0.42, 1.0, gradientT).toVar();
  const baseToMid = mix(vec3(petal.baseColor), vec3(petal.midColor), midBand);
  return mix(baseToMid, vec3(petal.tipColor), tipBand);
}

function buildPetalColor(
  petal,
  veinUniforms,
  veinLinesFn,
  outlineUniforms,
  grainUniforms,
  normalSource = normalLocal,
  petalId = float(0.0),
) {
  const uvCoord = uv();
  const { quantizedShade } = buildQuantizedShade(petal, normalSource);
  const gradient = buildPetalGradient(petal, uvCoord).toVar();

  const litColor = mix(
    gradient.mul(vec3(petal.shadowTint)),
    gradient.mul(vec3(petal.highlightTint)),
    quantizedShade,
  ).toVar();

  const strokes = veinLinesFn(uvCoord, petalId).toVar();

  litColor.assign(
    mix(litColor, vec3(outlineUniforms.outlineColor), clamp(strokes, 0.0, 1.0)),
  );
  litColor.assign(applyPaperGrain(litColor, grainUniforms));

  return { color: litColor, uvCoord };
}

function buildStemColor(stem, grainUniforms, normalSource = normalLocal) {
  const { quantizedShade } = buildQuantizedShade(stem, normalSource);
  const color = mix(
    vec3(stem.shadowColor),
    vec3(stem.highlightColor),
    quantizedShade,
  ).toVar();

  // Ink-line silhouette: fragments facing away from the camera at grazing
  // angles get pulled to the edge color, reading as a drawn outline.
  const N = transformNormal(normalSource).normalize().toVar();
  const V = cameraPosition.sub(positionWorld).normalize().toVar();
  const facing = abs(dot(N, V)).toVar();
  const edge = float(1.0).sub(
    smoothstep(
      stem.edgeThreshold,
      stem.edgeThreshold.add(max(stem.edgeSoftness, 0.001)),
      facing,
    ),
  ).toVar();
  color.assign(mix(color, vec3(stem.edgeColor), edge));

  return applyPaperGrain(color, grainUniforms);
}

/** Vertex color tags: flower = (1, petal_id, 0), stem = (0, 0, 0). */
export function isFlowerVertexColor(vertexColor) {
  return step(float(0.5), vertexColor.r);
}

/** Normalized petal id from vertex color G channel (0–1). */
export function getPetalIdFromVertexColor(vertexColor) {
  return vertexColor.g;
}

export function createFlowerVertexColorMaterial(
  flowerUniforms,
  outlineUniforms,
  maskUniforms,
  maskTexture,
  veinTexture,
  options = {},
) {
  const { normalSource = normalLocal } = options;
  const petal = flowerUniforms.petal;
  const stem = flowerUniforms.stem;
  const veinLinesFn = createVeinLinesFromTextureFn(veinTexture, flowerUniforms.vein);
  const maskAlphaFn = createMaskAlphaFn(maskTexture);
  const maskEdgeFn = createMaskEdgeFn(maskAlphaFn);

  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    transparent: false,
    alphaTest: FLOWER_DEFAULTS.mask.threshold,
    depthWrite: true,
    depthTest: true,
  });

  material.fragmentNode = Fn(() => {
    const vertexPart = attribute('color', 'vec3');
    const isFlower = isFlowerVertexColor(vertexPart);
    const result = vec4(0.0, 0.0, 0.0, 1.0).toVar();

    If(isFlower.greaterThan(float(0.5)), () => {
      applyMaskDiscard(maskAlphaFn, maskUniforms);

      const petalId = getPetalIdFromVertexColor(vertexPart);
      const { color, uvCoord } = buildPetalColor(
        petal,
        flowerUniforms.vein,
        veinLinesFn,
        outlineUniforms,
        flowerUniforms.grain,
        normalSource,
        petalId,
      );
      const maskEdge = maskEdgeFn(
        uvCoord,
        maskUniforms.threshold,
        maskUniforms.edgeWidth,
      ).toVar();

      result.assign(vec4(
        clamp(mix(color, vec3(outlineUniforms.outlineColor), maskEdge), 0.0, 1.0),
        1.0,
      ));
    }).Else(() => {
      const stemColor = buildStemColor(stem, flowerUniforms.grain, normalSource);
      result.assign(vec4(clamp(stemColor, 0.0, 1.0), 1.0));
    });

    return result;
  })();

  return material;
}

export function createFlowerStemMaterial(flowerUniforms, options = {}) {
  const { normalSource = normalLocal } = options;
  const stem = flowerUniforms.stem;
  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  material.fragmentNode = Fn(() => {
    const color = buildStemColor(stem, flowerUniforms.grain, normalSource);
    return vec4(clamp(color, 0.0, 1.0), 1.0);
  })();

  return material;
}

