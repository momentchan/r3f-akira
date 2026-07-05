import * as THREE from 'three/webgpu';
import {
  Discard,
  Fn,
  If,
  Loop,
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

function createVeinLinesFromTextureFn(veinTexture) {
  return Fn(([uvCoord, scale, rotation, threshold]) => {
    const centered = uvCoord.sub(0.5).toVar();
    const rotationCos = cos(rotation).toVar();
    const rotationSin = sin(rotation).toVar();
    const rotated = vec2(
      centered.x.mul(rotationCos).sub(centered.y.mul(rotationSin)),
      centered.x.mul(rotationSin).add(centered.y.mul(rotationCos)),
    ).add(0.5).toVar();
    const veinUV = rotated.mul(scale).toVar();
    const sample = texture(veinTexture, veinUV);
    const veinLine = float(1.0).sub(sample.r);
    return step(threshold, veinLine);
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
    },
    stem: {
      lightDir,
      colorLevels: uniform(stem.colorLevels),
      shadowColor: uniform(new THREE.Color(stem.shadowColor)),
      highlightColor: uniform(new THREE.Color(stem.highlightColor)),
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
) {
  const uvCoord = uv();
  const { quantizedShade } = buildQuantizedShade(petal, normalSource);
  const gradient = buildPetalGradient(petal, uvCoord).toVar();

  const litColor = mix(
    gradient.mul(vec3(petal.shadowTint)),
    gradient.mul(vec3(petal.highlightTint)),
    quantizedShade,
  ).toVar();

  const strokes = veinLinesFn(
    uvCoord,
    veinUniforms.scale,
    veinUniforms.rotation,
    veinUniforms.threshold,
  ).toVar();

  litColor.assign(
    mix(litColor, vec3(outlineUniforms.outlineColor), step(float(0.5), strokes)),
  );
  litColor.assign(applyPaperGrain(litColor, grainUniforms));

  return { color: litColor, uvCoord };
}

function buildStemColor(stem, grainUniforms) {
  const { quantizedShade } = buildQuantizedShade(stem);
  const color = mix(
    vec3(stem.shadowColor),
    vec3(stem.highlightColor),
    quantizedShade,
  ).toVar();

  return applyPaperGrain(color, grainUniforms);
}

export function createFlowerPetalMaterial(
  flowerUniforms,
  outlineUniforms,
  maskUniforms,
  maskTexture,
  veinTexture,
  options = {},
) {
  const { normalSource = normalLocal } = options;
  const petal = flowerUniforms.petal;
  const veinLinesFn = createVeinLinesFromTextureFn(veinTexture);
  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: FLOWER_DEFAULTS.mask.threshold,
    depthWrite: true,
    depthTest: true,
  });

  const maskAlphaFn = createMaskAlphaFn(maskTexture);
  const maskEdgeFn = createMaskEdgeFn(maskAlphaFn);

  material.fragmentNode = Fn(() => {
    applyMaskDiscard(maskAlphaFn, maskUniforms);

    const { color, uvCoord } = buildPetalColor(
      petal,
      flowerUniforms.vein,
      veinLinesFn,
      outlineUniforms,
      flowerUniforms.grain,
      normalSource,
    );
    const maskEdge = maskEdgeFn(
      uvCoord,
      maskUniforms.threshold,
      maskUniforms.edgeWidth,
    ).toVar();

    const finalColor = mix(color, vec3(outlineUniforms.outlineColor), maskEdge);
    return vec4(clamp(finalColor, 0.0, 1.0), 1.0);
  })();

  return material;
}

export function createFlowerMaterial(
  flowerUniforms,
  maskUniforms,
  outlineUniforms,
  maskTexture,
  veinTexture,
) {
  return createFlowerPetalMaterial(
    flowerUniforms,
    outlineUniforms,
    maskUniforms,
    maskTexture,
    veinTexture,
  );
}

export function createFlowerStemMaterial(flowerUniforms) {
  const stem = flowerUniforms.stem;
  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  material.fragmentNode = Fn(() => {
    const color = buildStemColor(stem, flowerUniforms.grain);
    return vec4(clamp(color, 0.0, 1.0), 1.0);
  })();

  return material;
}

export function createFlowerOutlineMaterial(
  outlineUniforms,
  maskUniforms,
  maskTexture,
  options = {},
) {
  const { basePosition = positionLocal, baseNormal = normalLocal } = options;
  const material = new THREE.MeshBasicNodeMaterial({
    depthWrite: true,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
    transparent: false,
    alphaTest: maskUniforms ? FLOWER_DEFAULTS.mask.threshold : 0,
  });

  const distanceScale = modelViewPosition.z.negate().mul(0.0008).add(1.0);
  material.positionNode = basePosition.add(
    baseNormal.normalize().mul(outlineUniforms.outlineWidth.mul(distanceScale)),
  );

  if (maskUniforms && maskTexture) {
    const maskAlphaFn = createMaskAlphaFn(maskTexture);
    material.fragmentNode = Fn(() => {
      applyMaskDiscard(maskAlphaFn, maskUniforms);
      return vec4(outlineUniforms.outlineColor, 1.0);
    })();
  } else {
    material.fragmentNode = vec4(outlineUniforms.outlineColor, 1.0);
  }

  return material;
}

function shouldUseMask(name = '') {
  return !/stem|stamen|stalk|center|core|pistil|mech|wire/i.test(name);
}

export function applyCartoonMaterials(
  sourceScene,
  maskedFillMaterial,
  maskedOutlineMaterial,
  stemFillMaterial,
  stemOutlineMaterial,
) {
  const fillScene = sourceScene.clone(true);
  const outlineScene = sourceScene.clone(true);
  const maskedMeshPairs = [];
  const fillMaskedMeshes = [];
  const outlineMaskedMeshes = [];

  fillScene.traverse((child) => {
    if (!child.isMesh) return;

    const useMask = shouldUseMask(child.name);
    child.material = useMask ? maskedFillMaterial : stemFillMaterial;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;
    child.renderOrder = 1;

    if (useMask) {
      fillMaskedMeshes.push(child);
    }
  });

  outlineScene.traverse((child) => {
    if (!child.isMesh) return;

    const useMask = shouldUseMask(child.name);
    child.material = useMask ? maskedOutlineMaterial : stemOutlineMaterial;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;
    child.renderOrder = 0;

    if (useMask) {
      outlineMaskedMeshes.push(child);
    }
  });

  fillMaskedMeshes.forEach((fillMesh, index) => {
    maskedMeshPairs.push({
      fill: fillMesh,
      outline: outlineMaskedMeshes[index],
    });
  });

  return { fillScene, outlineScene, maskedMeshPairs };
}
