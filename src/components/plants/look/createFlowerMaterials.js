import * as THREE from 'three/webgpu';
import {
  Discard,
  Fn,
  If,
  Loop,
  abs,
  attribute,
  cameraPosition,
  ceil,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  fwidth,
  max,
  mix,
  modelViewPosition,
  mx_hsvtorgb,
  mx_rgbtohsv,
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
    const veinLine = float(1.0).sub(sample.r).toVar();
    const fw = max(fwidth(veinLine), float(1e-5)).toVar();
    const width = fw.mul(max(veinUniforms.strokeWidth, float(0.001))).toVar();
    const stroke = smoothstep(
      veinUniforms.threshold.sub(width),
      veinUniforms.threshold.add(fw),
      veinLine,
    ).toVar();

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

function applySaturation(color, saturation) {
  const luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), color, saturation);
}

/** Match THREE.Color.offsetHSL(h, 0, l) via HSV (close enough for petal variation). */
function applyHueLightShift(color, hueShift, lightShift) {
  const hsv = mx_rgbtohsv(color).toVar();
  hsv.assign(vec3(
    fract(hsv.x.add(hueShift)),
    hsv.y,
    clamp(hsv.z.add(lightShift), 0.0, 1.0),
  ));
  return mx_hsvtorgb(hsv);
}

function createMaskAlphaFn(maskTexture) {
  return Fn(([uvCoord]) => {
    const sample = texture(maskTexture, uvCoord);
    return float(1.0).sub(sample.r);
  });
}

function createMaskEdgeFn(maskAlphaFn) {
  return Fn(([uvCoord, threshold, edgePx]) => {
    const m = maskAlphaFn(uvCoord).toVar();
    const fw = max(fwidth(m), float(1e-5)).toVar();
    const width = fw.mul(max(edgePx, float(0.001))).toVar();
    const inside = smoothstep(threshold.sub(fw), threshold.add(fw), m).toVar();
    const rim = float(1.0).sub(smoothstep(float(0.0), width, m.sub(threshold))).toVar();
    return clamp(inside.mul(rim), 0.0, 1.0);
  });
}

function applyMaskDiscard(maskAlphaFn, maskUniforms) {
  const maskAlpha = maskAlphaFn(uv()).toVar();
  If(maskAlpha.lessThan(maskUniforms.threshold), () => {
    Discard();
  });
}

export function createFlowerUniforms() {
  const { petal, vein, stem } = FLOWER_DEFAULTS;
  const lightDir = uniform(new THREE.Vector3(0, 3, 5).normalize());

  return {
    lightDir,
    petal: {
      lightDir,
      colorLevels: uniform(petal.colorLevels),
      gradientLevels: uniform(petal.gradientLevels),
      gradientBandStrength: uniform(petal.gradientBandStrength),
      shadowTint: uniform(new THREE.Color(petal.shadowTint)),
      highlightTint: uniform(new THREE.Color(petal.highlightTint)),
      thresholdLow: uniform(petal.thresholdLow),
      thresholdHigh: uniform(petal.thresholdHigh),
      thresholdNoiseScale: uniform(petal.thresholdNoiseScale),
      thresholdNoiseStrength: uniform(petal.thresholdNoiseStrength),
      baseColor: uniform(new THREE.Color(petal.baseColor)),
      midColor: uniform(new THREE.Color(petal.midColor)),
      tipColor: uniform(new THREE.Color(petal.tipColor)),
      saturation: uniform(petal.saturation ?? 1),
      hueRange: uniform(petal.hueRange),
      lightRange: uniform(petal.lightRange),
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
      strokeWidth: uniform(vein.strokeWidth ?? 2),
    },
    stem: {
      lightDir,
      colorLevels: uniform(stem.colorLevels),
      shadowColor: uniform(new THREE.Color(stem.shadowColor)),
      highlightColor: uniform(new THREE.Color(stem.highlightColor)),
      edgeColor: uniform(new THREE.Color(stem.edgeColor)),
      edgeThreshold: uniform(stem.edgeThreshold),
      edgeSoftness: uniform(stem.edgeSoftness),
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
    edgeColor: uniform(new THREE.Color(mask.edgeColor)),
  };
}

function buildQuantizedShade(shading, normalSource = normalLocal) {
  const N = transformNormal(normalSource).normalize().toVar();
  const L = vec3(shading.lightDir).normalize().toVar();
  const ndl = max(dot(N, L), 0.0).toVar();

  const thresholdNoise = fbm3(
    positionWorld.mul(shading.thresholdNoiseScale),
  )
    .sub(0.5)
    .mul(shading.thresholdNoiseStrength)
    .toVar();

  const thresholdWidth = max(
    shading.thresholdHigh.sub(shading.thresholdLow),
    0.001,
  ).toVar();
  const levelSteps = max(shading.colorLevels.sub(1.0), 1.0).toVar();
  const shade = clamp(
    ndl
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
  inkColor,
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
    mix(litColor, vec3(inkColor), clamp(strokes, 0.0, 1.0)),
  );

  return { color: litColor, uvCoord };
}

function buildStemColor(stem, normalSource = normalLocal) {
  const { quantizedShade } = buildQuantizedShade(stem, normalSource);
  const color = mix(
    vec3(stem.shadowColor),
    vec3(stem.highlightColor),
    quantizedShade,
  ).toVar();

  const N = transformNormal(normalSource).normalize().toVar();
  const V = cameraPosition.sub(positionWorld).normalize().toVar();
  const facing = abs(dot(N, V)).toVar();
  const fw = max(fwidth(facing), float(1e-5)).toVar();
  const width = fw.mul(max(stem.edgeSoftness, float(0.001))).toVar();
  const start = max(facing.sub(stem.edgeThreshold), float(0.0)).toVar();
  const edge = float(1.0).sub(smoothstep(float(0.0), width, start)).toVar();
  color.assign(mix(color, vec3(stem.edgeColor), edge));

  return color;
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
  maskUniforms,
  maskTexture,
  veinTexture,
  options = {},
) {
  const {
    normalSource = normalLocal,
    usePetalCutout = true,
    useMaskEdge = true,
    useVeins = true,
    /** Optional TSL nodes: instance unit × look-range uniforms. */
    colorVariation = null,
    /** Uniform 0..1 — mixes heads toward debugTintColor so GPU-drawn instances are obvious. */
    debugTint = null,
    /** Optional vec3 TSL node — defaults to magenta when debugTint is set. */
    debugTintColor = null,
  } = options;
  const useMask = usePetalCutout || useMaskEdge;
  const petal = flowerUniforms.petal;
  const stem = flowerUniforms.stem;
  const veinLinesFn = useVeins
    ? createVeinLinesFromTextureFn(veinTexture, flowerUniforms.vein)
    : Fn(() => float(0.0));
  const maskAlphaFn = useMask ? createMaskAlphaFn(maskTexture) : null;
  const maskEdgeFn = useMaskEdge ? createMaskEdgeFn(maskAlphaFn) : null;

  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    transparent: false,
    alphaTest: usePetalCutout ? FLOWER_DEFAULTS.mask.threshold : 0,
    depthWrite: true,
    depthTest: true,
  });

  material.fragmentNode = Fn(() => {
    const vertexPart = attribute('color', 'vec3');
    const isFlower = isFlowerVertexColor(vertexPart);
    const result = vec4(0.0, 0.0, 0.0, 1.0).toVar();

    If(isFlower.greaterThan(float(0.5)), () => {
      if (usePetalCutout) {
        applyMaskDiscard(maskAlphaFn, maskUniforms);
      }

      const petalId = getPetalIdFromVertexColor(vertexPart);
      const { color, uvCoord } = buildPetalColor(
        petal,
        flowerUniforms.vein,
        veinLinesFn,
        maskUniforms.edgeColor,
        normalSource,
        petalId,
      );

      const shaded = color.toVar();

      if (colorVariation) {
        shaded.assign(applyHueLightShift(
          shaded,
          colorVariation.hueShift,
          colorVariation.lightShift,
        ));
      }

      shaded.assign(applySaturation(shaded, petal.saturation));

      if (useMaskEdge) {
        const maskEdge = maskEdgeFn(
          uvCoord,
          maskUniforms.threshold,
          maskUniforms.edgeWidth,
        ).toVar();
        shaded.assign(
          mix(shaded, vec3(maskUniforms.edgeColor), maskEdge),
        );
      }

      result.assign(vec4(clamp(shaded, 0.0, 1.0), 1.0));
    }).Else(() => {
      const stemColor = buildStemColor(stem, normalSource);
      result.assign(vec4(clamp(stemColor, 0.0, 1.0), 1.0));
    });

    if (debugTint) {
      const tintRgb = debugTintColor ?? vec3(1.0, 0.12, 0.82);
      result.assign(vec4(mix(result.xyz, tintRgb, debugTint), result.w));
    }

    return result;
  })();

  return material;
}

export function createFlowerStemMaterial(flowerUniforms, options = {}) {
  const { normalSource = normalLocal, wind = null, radius = null } = options;
  const stem = flowerUniforms.stem;
  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  material.fragmentNode = Fn(() => {
    const color = buildStemColor(stem, normalSource);
    return vec4(clamp(color, 0.0, 1.0), 1.0);
  })();

  let posNode = null;

  // Growth radius (computed on the GPU): scale each vertex's offset from its
  // baked centerline point by a life-based factor — thin sprout (startScale) →
  // full radius (1) as the stem grows. `grow` is the raw 0→1 growth progress.
  if (radius) {
    const center = attribute('center', 'vec3');
    const s0 = radius.startScale;
    const rScale = float(s0).add(radius.grow.mul(1 - s0));
    posNode = center.add(positionLocal.sub(center).mul(rScale));
  }

  // Height-masked wind sway: TubeGeometry's uv.x is the along-length parameter
  // (0 at the base → 1 at the tip), so the base stays planted and the tip bends.
  if (wind) {
    const base = posNode || positionLocal;
    const mask = pow(uv().x, float(wind.maskPow));
    posNode = base.add(vec3(wind.sway.x, 0.0, wind.sway.y).mul(mask));
  }

  if (posNode) {
    material.positionNode = posNode;
  }

  return material;
}

/** Rotate a node vector about +Y (matches THREE.Vector3.applyAxisAngle(Y, a)). */
export const rotateYNode = (v, angle) => {
  const c = cos(angle);
  const s = sin(angle);
  return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
};

/**
 * One-draw field stems: per-vertex `plantId` indexes a Float RGBA DataTexture
 *   row 0: R = stemGrow, G = swayX, B = swayZ, A = unused
 *   row 1 (only when `texRows` >= 2): RGB = world offset, A = yaw
 * With a transform row the tube is baked in plant-local space and placed on the
 * GPU, so a plant can be moved/turned at runtime (respawn shuffle) without
 * rebuilding the merged geometry. Vertices above the grow tip collapse onto the
 * local centerline.
 */
export function createBatchedStemMaterial(flowerUniforms, options = {}) {
  const {
    normalSource = normalLocal,
    plantDataTexture,
    texWidth,
    texRows = 1,
    maskPow = 2,
    startScale = 0.1,
    growthSegments = 24,
  } = options;
  const stem = flowerUniforms.stem;
  const uTexWidth = uniform(texWidth);
  const rows = Math.max(1, texRows);
  const hasTransformRow = rows >= 2;
  // Row centre in v; with rows = 1 this is the original 0.5.
  const dataUVAt = (plantId, row) => vec2(
    plantId.add(0.5).div(uTexWidth),
    float((row + 0.5) / rows),
  );
  const segmentCount = float(Math.max(1, growthSegments));
  const quantizeGrowthFront = (grow) => clamp(
    ceil(grow.mul(segmentCount)).div(segmentCount),
    0.0,
    1.0,
  );

  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  material.fragmentNode = Fn(() => {
    const plantId = attribute('plantId', 'float');
    const grow = texture(plantDataTexture, dataUVAt(plantId, 0)).r;
    const growthFront = quantizeGrowthFront(grow);
    If(uv().x.greaterThan(growthFront), () => {
      Discard();
    });
    // The normal must turn with the plant, or a shuffled stem lights wrongly.
    const shadeNormal = hasTransformRow
      ? rotateYNode(normalSource, texture(plantDataTexture, dataUVAt(plantId, 1)).a)
      : normalSource;
    const color = buildStemColor(stem, shadeNormal);
    return vec4(clamp(color, 0.0, 1.0), 1.0);
  })();

  material.positionNode = Fn(() => {
    const plantId = attribute('plantId', 'float');
    const center = attribute('center', 'vec3');
    const previousPosition = attribute('previousPosition', 'vec3');
    const previousCenter = attribute('previousCenter', 'vec3');
    const data = texture(plantDataTexture, dataUVAt(plantId, 0));
    const grow = data.r.toVar();
    const growthFront = quantizeGrowthFront(grow).toVar();
    const sway = vec2(data.g, data.b);

    const s0 = float(startScale);
    const rScale = s0.add(grow.mul(1.0 - startScale));
    const along = uv().x.toVar();
    const segmentSize = float(1.0).div(segmentCount);
    const segmentStart = growthFront.sub(segmentSize);
    const frontAlpha = clamp(grow.sub(segmentStart).mul(segmentCount), 0.0, 1.0);
    const visible = step(along, growthFront);
    const grown = center.add(positionLocal.sub(center).mul(rScale));
    const previousGrown = previousCenter.add(
      previousPosition.sub(previousCenter).mul(rScale),
    );
    // Move only the boundary ring continuously through its active segment. The
    // fragment cutoff stays on that complete ring, avoiding both wedge and step.
    const isBoundary = float(1.0).sub(step(
      segmentSize.mul(0.5),
      abs(along.sub(growthFront)),
    ));
    const smoothFront = mix(grown, mix(previousGrown, grown, frontAlpha), isBoundary);
    const base = mix(center, smoothFront, visible);
    const motionAlong = mix(along, grow, isBoundary);
    const mask = pow(motionAlong, float(maskPow));
    // Turn + place the plant-local tube (respawn shuffle), then apply the
    // world-space wind sway on top so gust direction stays global.
    let placed = base;
    if (hasTransformRow) {
      const xform = texture(plantDataTexture, dataUVAt(plantId, 1));
      placed = rotateYNode(base, xform.a).add(xform.xyz);
    }
    return placed.add(vec3(sway.x, 0.0, sway.y).mul(mask.mul(visible)));
  })();

  return material;
}

