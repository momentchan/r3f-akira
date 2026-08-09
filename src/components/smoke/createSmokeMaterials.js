import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  acos,
  atan,
  cross,
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
  time,
  transformNormal,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { SMOKE_DEFAULTS } from './smokeDefaults';

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

const surfaceLightStrokes = Fn(([
  surfaceNormal,
  lightDirection,
  seed,
  scale,
  density,
  thickness,
  rotationAmount,
  startMin,
  startMax,
  lengthMin,
  lengthMax,
  fade,
]) => {
  const n = vec3(surfaceNormal).normalize().toVar();
  const l = vec3(lightDirection).normalize().toVar();
  const facing = clamp(dot(n, l), -0.999, 0.999).toVar();
  const tangentRaw = n.sub(l.mul(facing)).toVar();
  const tangentLenSq = dot(tangentRaw, tangentRaw).toVar();
  const fallbackAxis = l.y
    .abs()
    .lessThan(0.95)
    .select(vec3(0, 1, 0), vec3(1, 0, 0));
  const lightRight = cross(fallbackAxis, l).normalize().toVar();
  const lightUp = cross(l, lightRight).normalize().toVar();
  const tangent = tangentLenSq
    .greaterThan(float(1e-6))
    .select(tangentRaw.normalize(), lightUp)
    .toVar();

  const bAngle = atan(dot(tangent, lightUp), dot(tangent, lightRight)).toVar();
  const angle01 = bAngle.div(Math.PI * 2).add(0.5).toVar();
  const phi = acos(clamp(dot(n, l), -0.999, 0.999))
    .div(Math.PI)
    .toVar();
  const lineCount = max(scale, 1.0).toVar();
  const baseCoord = angle01
    .mul(lineCount)
    .add(seed.mul(2.31))
    .toVar();
  const angleCell = floor(baseCoord).toVar();
  const strokeStart = mix(
    startMin,
    startMax,
    hash3(vec3(angleCell, seed, 2.3)),
  ).toVar();
  const strokeLength = mix(
    lengthMin,
    lengthMax,
    hash3(vec3(angleCell, seed, 4.7)),
  ).toVar();
  const strokeEnd = strokeStart.add(strokeLength)
    .toVar();
  const strokeSpan = max(strokeEnd.sub(strokeStart), 0.001).toVar();
  const strokeCenter = strokeStart.add(strokeEnd).mul(0.5).toVar();
  const strokeProgress = clamp(
    phi.sub(strokeStart).div(strokeSpan),
    0.0,
    1.0,
  ).toVar();
  const curveSign = hash3(vec3(angleCell, seed, 12.7))
    .sub(0.5)
    .mul(2.0)
    .toVar();
  const curveAmount = curveSign
    .mul(mix(0.55, 1.35, hash3(vec3(angleCell, seed, 18.3))))
    .toVar();
  const curveOffset = pow(strokeProgress, 1.65)
    .mul(0.)
    .toVar();
  const surfaceWobble = fbm3(vec3(angle01.mul(5.0), phi.mul(4.0), seed))
    .sub(0.5)
    .mul(0.08)
    .mul(strokeProgress)
    .toVar();
  const angleCoord = baseCoord.sub(curveOffset).add(surfaceWobble).toVar();
  const angleLocal = fract(angleCoord).sub(0.5).toVar();
  const lengthLocal = phi.sub(strokeCenter).mul(lineCount).toVar();
  const halfLength = strokeSpan.mul(lineCount).mul(0.5).toVar();
  const lineRotation = hash3(vec3(angleCell, seed, 21.9))
    .sub(0.5)
    .mul(2.0)
    .mul(rotationAmount)
    .toVar();
  const rotationCos = cos(lineRotation).toVar();
  const rotationSin = sin(lineRotation).toVar();
  const rotatedX = angleLocal
    .mul(rotationCos)
    .sub(lengthLocal.mul(rotationSin))
    .abs()
    .toVar();
  const rotatedY = angleLocal
    .mul(rotationSin)
    .add(lengthLocal.mul(rotationCos))
    .toVar();
  const lineSoftness = thickness.mul(0.45).add(0.006).toVar();
  const thinLine = float(1.0)
    .sub(smoothstep(thickness, thickness.add(lineSoftness), rotatedX))
    .toVar();
  const fadeLocal = fade.mul(lineCount).toVar();
  const startEdge = float(0.0).sub(halfLength).toVar();
  const endEdge = halfLength.toVar();
  const startMask = smoothstep(startEdge, startEdge.add(fadeLocal), rotatedY)
    .toVar();
  const endMask = float(1.0)
    .sub(smoothstep(endEdge, endEdge.add(fadeLocal), rotatedY))
    .toVar();
  const lengthMask = startMask.mul(endMask).toVar();
  const active = step(
    float(1.0).sub(density),
    hash3(vec3(angleCell, seed, 9.1)),
  ).toVar();

  // return lengthMask;
  return thinLine.mul(lengthMask).mul(active);
});

const getDisplacedPosition = Fn(([
  localPosition,
  localNormal,
  seed,
  age,
  deformBig,
  deformSmall,
  distortBigScale,
  distortSmallScale,
  distortBigSpeed,
  distortSmallSpeed,
  outlineWidth,
]) => {
  const samplePosition = vec3(localPosition).toVar();
  const sampleNormal = vec3(localNormal).normalize().toVar();
  const bigFlow = time.mul(distortBigSpeed).toVar();
  const smallFlow = time.mul(distortSmallSpeed).toVar();
  const lifeMask = smoothstep(0.0, 0.18, age)
    .mul(float(1.0).sub(smoothstep(0.86, 1.0, age)))
    .add(0.35)
    .toVar();

  const bigNoise = noise3(
    samplePosition
      .mul(distortBigScale)
      .add(vec3(bigFlow.mul(0.37), bigFlow, bigFlow.mul(0.19)))
      .add(vec3(seed)),
  );

  const smallNoise = noise3(
    samplePosition
      .mul(distortSmallScale)
      .add(vec3(smallFlow, smallFlow.mul(0.23), smallFlow.mul(0.41)))
      .add(vec3(float(seed).mul(3.1))),
  );

  const deform = bigNoise.sub(0.5).mul(deformBig)
    .add(smallNoise.sub(0.5).mul(deformSmall))
    .mul(lifeMask)
    .add(outlineWidth);

  return samplePosition.add(sampleNormal.mul(deform));
});

const getDistortedPosition = Fn(([
  seed,
  age,
  deformBig,
  deformSmall,
  distortBigScale,
  distortSmallScale,
  distortBigSpeed,
  distortSmallSpeed,
  outlineWidth,
]) => {
  return getDisplacedPosition(
    positionLocal,
    normalLocal,
    seed,
    age,
    deformBig,
    deformSmall,
    distortBigScale,
    distortSmallScale,
    distortBigSpeed,
    distortSmallSpeed,
    outlineWidth,
  );
});

export function createPuffMaterial() {
  const { distortion, shading } = SMOKE_DEFAULTS;
  const puffSeed = attribute('smokeSeed', 'float');
  const puffAge = attribute('smokeAge', 'float');
  const uniforms = {
    deformBig: uniform(distortion.deformBig),
    deformSmall: uniform(distortion.deformSmall),
    distortBigScale: uniform(distortion.distortBigScale),
    distortSmallScale: uniform(distortion.distortSmallScale),
    distortBigSpeed: uniform(distortion.distortBigSpeed),
    distortSmallSpeed: uniform(distortion.distortSmallSpeed),
    lightDir: uniform(new THREE.Vector3(0, 5, 5).normalize()),
    colorLevels: uniform(shading.colorLevels),
    shadowColor: uniform(new THREE.Color(shading.shadowColor)),
    highlightColor: uniform(new THREE.Color(shading.highlightColor)),
    normalEpsilon: uniform(distortion.normalEpsilon),
    rimStrength: uniform(shading.rimStrength),
    rimThreshold: uniform(shading.rimThreshold),
    rimPower: uniform(shading.rimPower),
    surfaceInkColor: uniform(new THREE.Color(shading.surfaceInkColor)),
    surfaceInkStrength: uniform(shading.surfaceInkStrength),
    surfaceLineScale: uniform(shading.surfaceLineScale),
    surfaceLineDensity: uniform(shading.surfaceLineDensity),
    surfaceLineThickness: uniform(shading.surfaceLineThickness),
    surfaceLineRotation: uniform(shading.surfaceLineRotation),
    surfaceLineStartMin: uniform(shading.surfaceLineStartMin),
    surfaceLineStartMax: uniform(shading.surfaceLineStartMax),
    surfaceLineLengthMin: uniform(shading.surfaceLineLengthMin),
    surfaceLineLengthMax: uniform(shading.surfaceLineLengthMax),
    surfaceLineFade: uniform(shading.surfaceLineFade),
    thresholdLow: uniform(shading.thresholdLow),
    thresholdHigh: uniform(shading.thresholdHigh),
    thresholdNoiseScale: uniform(shading.thresholdNoiseScale),
    thresholdNoiseStrength: uniform(shading.thresholdNoiseStrength),
  };

  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
  });

  material.positionNode = getDistortedPosition(
    puffSeed,
    puffAge,
    uniforms.deformBig,
    uniforms.deformSmall,
    uniforms.distortBigScale,
    uniforms.distortSmallScale,
    uniforms.distortBigSpeed,
    uniforms.distortSmallSpeed,
    0.0,
  );

  material.fragmentNode = Fn(() => {
    // Instance matrices scale and translate only, so this stays aligned with the top light.
    const N = transformNormal(normalLocal).normalize().toVar();
    const V = cameraPosition.sub(positionWorld).normalize().toVar();
    const L = vec3(uniforms.lightDir).normalize().toVar();
    const age = puffAge.toVar();
    const ndl = max(dot(N, L), 0.0).toVar();
    const birth = smoothstep(0.0, 0.14, age).toVar();
    const bandTerm = ndl.mul(birth).toVar();

    const thresholdNoise = fbm3(
      positionWorld
        .mul(uniforms.thresholdNoiseScale)
        .add(vec3(puffSeed, puffSeed.mul(1.73), puffSeed.mul(0.41))),
    ).sub(0.5).mul(uniforms.thresholdNoiseStrength).toVar();

    const rimRaw = pow(
      float(1.0).sub(max(dot(N, V), 0.0)),
      uniforms.rimPower,
    ).toVar();
    const rimBand = step(uniforms.rimThreshold, rimRaw);
    const rimLift = rimBand.mul(uniforms.rimStrength).toVar();

    const thresholdWidth = max(uniforms.thresholdHigh.sub(uniforms.thresholdLow), 0.001).toVar();
    const levelSteps = max(uniforms.colorLevels.sub(1.0), 1.0).toVar();
    const shade = clamp(
      bandTerm
        .add(rimLift)
        .sub(uniforms.thresholdLow.add(thresholdNoise))
        .div(thresholdWidth),
      0.0,
      1.0,
    ).toVar();
    const quantizedShade = floor(shade.mul(levelSteps).add(0.5)).div(levelSteps).toVar();
    const color = mix(
      vec3(uniforms.shadowColor),
      vec3(uniforms.highlightColor),
      quantizedShade,
    ).toVar();
    const strokes = surfaceLightStrokes(
      N,
      L,
      puffSeed,
      uniforms.surfaceLineScale,
      uniforms.surfaceLineDensity,
      uniforms.surfaceLineThickness,
      uniforms.surfaceLineRotation,
      uniforms.surfaceLineStartMin,
      uniforms.surfaceLineStartMax,
      uniforms.surfaceLineLengthMin,
      uniforms.surfaceLineLengthMax,
      uniforms.surfaceLineFade,
    ).toVar();

    color.assign(
      mix(
        color,
        vec3(uniforms.surfaceInkColor),
        clamp(strokes.mul(uniforms.surfaceInkStrength), 0.0, 1.0),
      ),
    );

    // return strokes;
    return vec4(clamp(color, 0.0, 1.0), 1.0);
  })();

  return { material, uniforms };
}

export function createOutlineMaterial() {
  const { distortion, outline } = SMOKE_DEFAULTS;
  const puffSeed = attribute('smokeSeed', 'float');
  const puffAge = attribute('smokeAge', 'float');
  const uniforms = {
    deformBig: uniform(distortion.deformBig),
    deformSmall: uniform(distortion.deformSmall),
    distortBigScale: uniform(distortion.distortBigScale),
    distortSmallScale: uniform(distortion.distortSmallScale),
    distortBigSpeed: uniform(distortion.distortBigSpeed),
    distortSmallSpeed: uniform(distortion.distortSmallSpeed),
    outlineColor: uniform(new THREE.Color(outline.outlineColor)),
    outlineWidth: uniform(outline.outlineWidth),
  };

  const material = new THREE.MeshBasicNodeMaterial({
    depthWrite: true,
    side: THREE.BackSide,
    toneMapped: false,
  });

  const distanceScale = modelViewPosition.z.negate().mul(0.0008).add(1.0);
  material.positionNode = getDistortedPosition(
    puffSeed,
    puffAge,
    uniforms.deformBig,
    uniforms.deformSmall,
    uniforms.distortBigScale,
    uniforms.distortSmallScale,
    uniforms.distortBigSpeed,
    uniforms.distortSmallSpeed,
    uniforms.outlineWidth.mul(distanceScale),
  );

  material.fragmentNode = vec4(uniforms.outlineColor, 1.0);

  return { material, uniforms };
}
