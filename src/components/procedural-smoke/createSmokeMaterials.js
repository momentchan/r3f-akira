import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  modelViewPosition,
  normalGeometry,
  normalLocal,
  positionGeometry,
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
import { SMOKE_DEFAULTS } from './proceduralSmokeDefaults';

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

const getDistortedNormal = Fn(([
  seed,
  age,
  deformBig,
  deformSmall,
  distortBigScale,
  distortSmallScale,
  distortBigSpeed,
  distortSmallSpeed,
  normalEpsilon,
]) => {
  const basePosition = vec3(positionGeometry).toVar();
  const baseNormal = vec3(normalGeometry).normalize().toVar();
  const helperAxis = baseNormal.y
    .abs()
    .lessThan(0.95)
    .select(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0))
    .toVar();
  const tangent = helperAxis.cross(baseNormal).normalize().toVar();
  const bitangent = baseNormal.cross(tangent).normalize().toVar();
  const p0 = getDisplacedPosition(
    basePosition,
    baseNormal,
    seed,
    age,
    deformBig,
    deformSmall,
    distortBigScale,
    distortSmallScale,
    distortBigSpeed,
    distortSmallSpeed,
    0.0,
  ).toVar();
  const p1 = getDisplacedPosition(
    basePosition.add(tangent.mul(normalEpsilon)),
    baseNormal,
    seed,
    age,
    deformBig,
    deformSmall,
    distortBigScale,
    distortSmallScale,
    distortBigSpeed,
    distortSmallSpeed,
    0.0,
  ).toVar();
  const p2 = getDisplacedPosition(
    basePosition.add(bitangent.mul(normalEpsilon)),
    baseNormal,
    seed,
    age,
    deformBig,
    deformSmall,
    distortBigScale,
    distortSmallScale,
    distortBigSpeed,
    distortSmallSpeed,
    0.0,
  ).toVar();
  const localNormal = p1.sub(p0).cross(p2.sub(p0)).normalize().toVar();

  return transformNormal(localNormal).normalize();
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
    shadowColor: uniform(new THREE.Color(shading.shadowColor)),
    midColor: uniform(new THREE.Color(shading.midColor)),
    highlightColor: uniform(new THREE.Color(shading.highlightColor)),
    normalEpsilon: uniform(distortion.normalEpsilon),
    rimStrength: uniform(shading.rimStrength),
    rimThreshold: uniform(shading.rimThreshold),
    rimPower: uniform(shading.rimPower),
    midThreshold: uniform(shading.midThreshold),
    highThreshold: uniform(shading.highThreshold),
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

    const midBand = step(
      uniforms.midThreshold.add(thresholdNoise).sub(rimLift),
      bandTerm,
    );
    const highBand = step(
      uniforms.highThreshold.add(thresholdNoise).sub(rimLift),
      bandTerm,
    );
    const color = mix(vec3(uniforms.shadowColor), vec3(uniforms.midColor), midBand).toVar();

    color.assign(mix(color, vec3(uniforms.highlightColor), highBand));

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
