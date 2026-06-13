import * as THREE from 'three/webgpu';
import {
  Fn,
  cos,
  deltaTime,
  float,
  instanceIndex,
  mat4,
  mix,
  mod,
  sin,
  smoothstep,
  storage,
  time,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { SMOKE_DEFAULTS } from './proceduralSmokeDefaults';

function randomFromSeed(seed) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSmokeSimulation(count, seed) {
  const rand = randomFromSeed(seed);
  const seeds = new Float32Array(count);
  const ages = new Float32Array(count);
  const ageState = new Float32Array(count);
  const matrices = new Float32Array(count * 16);
  const motion = new Float32Array(count * 4);
  const shape = new Float32Array(count * 4);
  const rotation = new Float32Array(count * 4);
  const spin = new Float32Array(count * 4);
  const squash = new Float32Array(count * 4);

  for (let index = 0; index < count; index += 1) {
    const isEdgePuff = rand() > 0.82;
    const lifetime = 4.8 + rand() * 3.0;
    const age = rand() * lifetime;
    const scaleVariation = isEdgePuff
      ? rand() * 0.42
      : 0.28 + Math.pow(rand(), 0.7) * 0.72;
    const offset4 = index * 4;
    const offset16 = index * 16;
    const riseSpeed = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.94, 0.66, scaleVariation) + (rand() - 0.5) * 0.12,
      0.58,
      1.02,
    );

    seeds[index] = rand() * 100;
    ages[index] = age / lifetime;
    ageState[index] = age;

    motion[offset4 + 0] = lifetime;
    motion[offset4 + 1] = riseSpeed;
    motion[offset4 + 2] = 1.02 + scaleVariation * 0.32 + rand() * 0.26;
    motion[offset4 + 3] = scaleVariation;

    shape[offset4 + 0] = isEdgePuff ? 0.30 + rand() * 0.34 : 0.12 + rand() * 0.32;
    shape[offset4 + 1] = 0.45 + rand() * 2.4;
    shape[offset4 + 2] = rand() * Math.PI * 2;
    shape[offset4 + 3] = rand() * Math.PI * 2;

    rotation[offset4 + 0] = rand() * Math.PI;
    rotation[offset4 + 1] = rand() * Math.PI;
    rotation[offset4 + 2] = rand() * Math.PI;
    rotation[offset4 + 3] = 0;

    spin[offset4 + 0] = 0.16 + rand() * 0.72;
    spin[offset4 + 1] = (rand() - 0.5) * (0.16 + rand() * 0.28);
    spin[offset4 + 2] = (rand() - 0.5) * (0.12 + rand() * 0.22);
    spin[offset4 + 3] = (rand() - 0.5) * (0.18 + rand() * 0.30);

    squash[offset4 + 0] = 0.88 + rand() * 0.24;
    squash[offset4 + 1] = 0.90 + rand() * 0.24;
    squash[offset4 + 2] = 0.88 + rand() * 0.24;
    squash[offset4 + 3] = 0;

    matrices[offset16 + 0] = 1;
    matrices[offset16 + 5] = 1;
    matrices[offset16 + 10] = 1;
    matrices[offset16 + 15] = 1;
  }

  const seedAttribute = new THREE.InstancedBufferAttribute(seeds, 1);
  const ageAttribute = new THREE.StorageInstancedBufferAttribute(ages, 1);
  const ageStateAttribute = new THREE.StorageInstancedBufferAttribute(ageState, 1);
  const matrixAttribute = new THREE.StorageInstancedBufferAttribute(matrices, 16);
  const motionAttribute = new THREE.StorageInstancedBufferAttribute(motion, 4);
  const shapeAttribute = new THREE.StorageInstancedBufferAttribute(shape, 4);
  const rotationAttribute = new THREE.StorageInstancedBufferAttribute(rotation, 4);
  const spinAttribute = new THREE.StorageInstancedBufferAttribute(spin, 4);
  const squashAttribute = new THREE.StorageInstancedBufferAttribute(squash, 4);
  const uniforms = {
    curlScale: uniform(1.0),
    driftScale: uniform(1.0),
    heightScale: uniform(1.0),
    radiusScale: uniform(1.0),
    scale: uniform(1.0),
    scaleMin: uniform(SMOKE_DEFAULTS.shape.scaleMin),
    scaleMax: uniform(SMOKE_DEFAULTS.shape.scaleMax),
    speedScale: uniform(1.0),
  };

  const ageNode = storage(ageAttribute, 'float', count);
  const ageStateNode = storage(ageStateAttribute, 'float', count);
  const matrixNode = storage(matrixAttribute, 'mat4', count);
  const motionNode = storage(motionAttribute, 'vec4', count).toReadOnly();
  const shapeNode = storage(shapeAttribute, 'vec4', count).toReadOnly();
  const rotationNode = storage(rotationAttribute, 'vec4', count).toReadOnly();
  const spinNode = storage(spinAttribute, 'vec4', count).toReadOnly();
  const squashNode = storage(squashAttribute, 'vec4', count).toReadOnly();

  const computeNode = Fn(() => {
    const index = instanceIndex;
    const motionData = motionNode.element(index).toVar();
    const shapeData = shapeNode.element(index).toVar();
    const rotationData = rotationNode.element(index).toVar();
    const spinData = spinNode.element(index).toVar();
    const squashData = squashNode.element(index).toVar();

    const age = mod(
      ageStateNode.element(index).add(deltaTime.mul(motionData.y).mul(uniforms.speedScale)),
      motionData.x,
    ).toVar();
    const life = age.div(motionData.x).toVar();
    const birthScale = smoothstep(0.0, 0.08, life).toVar();
    const deathScale = float(1.0).sub(smoothstep(0.78, 1.0, life)).toVar();
    const body = smoothstep(0.08, 0.68, life).toVar();
    const ease = float(1.0).sub(
      float(1.0).sub(life).mul(float(1.0).sub(life)).mul(float(1.0).sub(life)),
    ).toVar();
    const driftEnvelope = body.mul(deathScale).toVar();
    const radiusBreath = sin(
      time.mul(spinData.x.mul(0.18).add(0.11)).add(shapeData.w),
    ).mul(0.08).mul(driftEnvelope).add(1.0).toVar();
    const radius = body
      .mul(0.20)
      .add(0.02)
      .mul(shapeData.x)
      .mul(uniforms.radiusScale)
      .mul(radiusBreath)
      .toVar();
    const curl = shapeData.z
      .add(life.mul(shapeData.y).mul(uniforms.curlScale))
      .add(sin(time.mul(0.12).add(shapeData.z)).mul(0.15))
      .add(sin(time.mul(spinData.x.mul(0.21).add(0.17)).add(shapeData.w)).mul(0.08))
      .toVar();
    const driftX = sin(time.mul(spinData.x).add(shapeData.w))
      .mul(0.007)
      .add(sin(time.mul(spinData.x.mul(0.43).add(0.09)).add(rotationData.x)).mul(0.006))
      .mul(driftEnvelope)
      .mul(uniforms.driftScale)
      .toVar();
    const driftZ = sin(time.mul(spinData.x.mul(0.67).add(0.13)).add(rotationData.z))
      .mul(0.008)
      .add(cos(time.mul(spinData.x.mul(0.31).add(0.07)).add(shapeData.z)).mul(0.005))
      .mul(driftEnvelope)
      .mul(uniforms.driftScale)
      .toVar();
    const bob = sin(time.mul(spinData.x.mul(0.27).add(0.16)).add(shapeData.w))
      .mul(0.018)
      .mul(driftEnvelope)
      .mul(uniforms.heightScale)
      .toVar();
    const topSwell = smoothstep(0.55, 0.90, life).mul(0.18).add(1.0).toVar();
    const scalePulse = sin(time.mul(spinData.x.mul(0.38).add(0.19)).add(shapeData.z))
      .mul(0.035)
      .mul(driftEnvelope)
      .add(1.0)
      .toVar();
    const targetScale = mix(uniforms.scaleMin, uniforms.scaleMax, motionData.w).toVar();
    const scale = mix(uniforms.scaleMin, targetScale, ease)
      .mul(topSwell)
      .mul(scalePulse)
      .mul(birthScale)
      .mul(deathScale)
      .mul(uniforms.scale)
      .toVar();
    const zCurl = curl.add(sin(time.mul(0.10).add(shapeData.w)).mul(0.10).mul(driftEnvelope)).toVar();
    const position = vec3(
      cos(curl).mul(radius).add(driftX),
      life.mul(motionData.z).mul(uniforms.heightScale).add(bob),
      sin(zCurl.mul(0.83)).mul(radius).mul(0.52).add(driftZ),
    ).toVar();
    const squashPulse = sin(time.mul(spinData.x.mul(0.44).add(0.23)).add(rotationData.x))
      .mul(0.035)
      .mul(driftEnvelope)
      .toVar();
    const scaleX = scale.mul(squashData.x).mul(squashPulse.add(1.0)).toVar();
    const scaleY = scale.mul(squashData.y).mul(float(1.0).sub(squashPulse.mul(0.35))).toVar();
    const scaleZ = scale.mul(squashData.z).mul(float(1.0).sub(squashPulse.mul(0.55))).toVar();

    ageStateNode.element(index).assign(age);
    ageNode.element(index).assign(life);
    // Keep puff matrices rotation-free so toon lighting reads from one shared direction.
    matrixNode.element(index).assign(mat4(
      vec4(scaleX, 0.0, 0.0, 0.0),
      vec4(0.0, scaleY, 0.0, 0.0),
      vec4(0.0, 0.0, scaleZ, 0.0),
      vec4(position, 1.0),
    ));
  })().compute(count);

  return {
    ageAttribute,
    computeNode,
    matrixAttribute,
    seedAttribute,
    uniforms,
  };
}
