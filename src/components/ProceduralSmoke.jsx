import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { folder, useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  attribute,
  cameraPosition,
  clamp,
  cos,
  deltaTime,
  dot,
  float,
  floor,
  fract,
  instanceIndex,
  mat4,
  max,
  mix,
  modelViewPosition,
  mod,
  normalLocal,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  storage,
  step,
  time,
  transformNormal,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';

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
  outlineWidth,
]) => {
  const samplePosition = vec3(localPosition).toVar();
  const sampleNormal = vec3(localNormal).normalize().toVar();
  const lifeMask = smoothstep(0.0, 0.18, age)
    .mul(float(1.0).sub(smoothstep(0.86, 1.0, age)))
    .add(0.35)
    .toVar();

  const bigNoise = noise3(
    samplePosition
      .mul(distortBigScale)
      .add(vec3(0.0, time.mul(0.25), 0.0))
      .add(vec3(seed)),
  );

  const smallNoise = noise3(
    samplePosition
      .mul(distortSmallScale)
      .add(vec3(time.mul(0.8), 0.0, 0.0))
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
  normalEpsilon,
]) => {
  const basePosition = vec3(positionLocal).toVar();
  const baseNormal = vec3(normalLocal).normalize().toVar();
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
    0.0,
  ).toVar();
  const localNormal = p1.sub(p0).cross(p2.sub(p0)).normalize().toVar();

  return transformNormal(localNormal).normalize();
});

function createPuffMaterial() {
  const puffSeed = attribute('smokeSeed', 'float');
  const puffAge = attribute('smokeAge', 'float');
  const uniforms = {
    deformBig: uniform(0.11),
    deformSmall: uniform(0.02),
    distortBigScale: uniform(1.4),
    distortSmallScale: uniform(5.0),
    lightDir: uniform(new THREE.Vector3(-0.58, 0.76, 0.22).normalize()),
    shadowColor: uniform(new THREE.Color('#b4b5b8')),
    midColor: uniform(new THREE.Color('#d1d2d4')),
    highlightColor: uniform(new THREE.Color('#ececed')),
    normalEpsilon: uniform(0.012),
    rimColor: uniform(new THREE.Color('#ffffff')),
    rimStrength: uniform(0.18),
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
    0.0,
  );

  material.fragmentNode = Fn(() => {
    const N = getDistortedNormal(
      puffSeed,
      puffAge,
      uniforms.deformBig,
      uniforms.deformSmall,
      uniforms.distortBigScale,
      uniforms.distortSmallScale,
      uniforms.normalEpsilon,
    ).toVar();
    const V = cameraPosition.sub(positionWorld).normalize().toVar();
    const L = vec3(uniforms.lightDir).normalize().toVar();
    const age = puffAge.toVar();
    const ndl = max(dot(N, L), 0.0).toVar();
    const breakup = noise3(positionWorld.mul(1.35).add(vec3(puffSeed)).add(vec3(time.mul(0.05)))).toVar();
    const rim = pow(float(1.0).sub(max(dot(N, V), 0.0)), 2.8).toVar();
    const birth = smoothstep(0.0, 0.14, age).toVar();

    const lightTerm = ndl
      .mul(0.82)
      .add(rim.mul(uniforms.rimStrength))
      .add(breakup.sub(0.5).mul(0.08))
      .add(0.18)
      .mul(birth)
      .toVar();

    const midBand = step(0.42, lightTerm);
    const highBand = step(0.74, lightTerm);
    const color = mix(vec3(uniforms.shadowColor), vec3(uniforms.midColor), midBand).toVar();

    color.assign(mix(color, vec3(uniforms.highlightColor), highBand));
    color.addAssign(vec3(uniforms.rimColor).mul(rim).mul(0.05));

    return vec4(clamp(color, 0.0, 1.0), 1.0);
  })();

  return { material, uniforms };
}

function createOutlineMaterial() {
  const puffSeed = attribute('smokeSeed', 'float');
  const puffAge = attribute('smokeAge', 'float');
  const uniforms = {
    deformBig: uniform(0.11),
    deformSmall: uniform(0.02),
    distortBigScale: uniform(1.4),
    distortSmallScale: uniform(5.0),
    outlineColor: uniform(new THREE.Color('#7b7d82')),
    outlineWidth: uniform(0.016),
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
    uniforms.outlineWidth.mul(distanceScale),
  );

  material.fragmentNode = vec4(uniforms.outlineColor, 1.0);

  return { material, uniforms };
}

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

function createSmokeSimulation(count, seed) {
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
    const lifetime = 5.0 + rand() * 2.4;
    const age = rand() * lifetime;
    const targetScale = (isEdgePuff ? 0.06 : 0.13) + rand() * (isEdgePuff ? 0.06 : 0.12);
    const offset4 = index * 4;
    const offset16 = index * 16;

    seeds[index] = rand() * 100;
    ages[index] = age / lifetime;
    ageState[index] = age;

    motion[offset4 + 0] = lifetime;
    motion[offset4 + 1] = 0.72 + rand() * 0.22;
    motion[offset4 + 2] = 1.08 + rand() * 0.34;
    motion[offset4 + 3] = targetScale;

    shape[offset4 + 0] = isEdgePuff ? 0.42 + rand() * 0.18 : 0.16 + rand() * 0.22;
    shape[offset4 + 1] = 0.8 + rand() * 1.6;
    shape[offset4 + 2] = rand() * Math.PI * 2;
    shape[offset4 + 3] = rand() * Math.PI * 2;

    rotation[offset4 + 0] = rand() * Math.PI;
    rotation[offset4 + 1] = rand() * Math.PI;
    rotation[offset4 + 2] = rand() * Math.PI;
    rotation[offset4 + 3] = 0;

    spin[offset4 + 0] = 0.3 + rand() * 0.7;
    spin[offset4 + 1] = (rand() - 0.5) * 0.35;
    spin[offset4 + 2] = (rand() - 0.5) * 0.28;
    spin[offset4 + 3] = (rand() - 0.5) * 0.4;

    squash[offset4 + 0] = 0.92 + rand() * 0.16;
    squash[offset4 + 1] = 0.92 + rand() * 0.20;
    squash[offset4 + 2] = 0.92 + rand() * 0.16;
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
    spinScale: uniform(1.0),
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
    const radius = body
      .mul(0.20)
      .add(0.02)
      .mul(shapeData.x)
      .mul(uniforms.radiusScale)
      .toVar();
    const curl = shapeData.z
      .add(life.mul(shapeData.y).mul(uniforms.curlScale))
      .add(sin(time.mul(0.12).add(shapeData.z)).mul(0.15))
      .toVar();
    const drift = sin(time.mul(spinData.x).add(shapeData.w))
      .mul(0.018)
      .mul(uniforms.driftScale)
      .toVar();
    const topSwell = smoothstep(0.55, 0.90, life).mul(0.18).add(1.0).toVar();
    const scale = mix(0.07, motionData.w, ease)
      .mul(topSwell)
      .mul(birthScale)
      .mul(deathScale)
      .mul(uniforms.scale)
      .toVar();
    const position = vec3(
      cos(curl).mul(radius).add(drift),
      life.mul(motionData.z).mul(uniforms.heightScale),
      sin(curl.mul(0.83)).mul(radius).mul(0.52).add(drift.mul(0.35)),
    ).toVar();
    const scaleX = scale.mul(squashData.x).toVar();
    const scaleY = scale.mul(squashData.y).toVar();
    const scaleZ = scale.mul(squashData.z).toVar();
    const yaw = rotationData.y.add(time.mul(spinData.z).mul(uniforms.spinScale)).toVar();
    const yawCos = cos(yaw).toVar();
    const yawSin = sin(yaw).toVar();

    ageStateNode.element(index).assign(age);
    ageNode.element(index).assign(life);
    matrixNode.element(index).assign(mat4(
      vec4(yawCos.mul(scaleX), 0.0, yawSin.negate().mul(scaleX), 0.0),
      vec4(0.0, scaleY, 0.0, 0.0),
      vec4(yawSin.mul(scaleZ), 0.0, yawCos.mul(scaleZ), 0.0),
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

export function ProceduralSmoke({ count = 84, position = [0, 0, 0], seed = 1337 }) {
  const meshRef = useRef(null);
  const outlineRef = useRef(null);
  const {
    curlScale,
    deformBig,
    deformSmall,
    distortBigScale,
    distortSmallScale,
    driftScale,
    heightScale,
    highlightColor,
    midColor,
    normalEpsilon,
    outlineColor,
    outlineWidth,
    puffCount,
    puffScale,
    radiusScale,
    randomSeed,
    rimColor,
    rimStrength,
    shadowColor,
    speedScale,
    spinScale,
  } = useControls('Smoke Effect', {
    Simulation: folder({
      puffCount: { value: count, min: 8, max: 240, step: 1 },
      randomSeed: { value: seed, min: 1, max: 9999, step: 1 },
      speedScale: { value: 0.85, min: 0, max: 3, step: 0.01 },
    }),
    Shape: folder({
      puffScale: { value: 0.92, min: 0.2, max: 2.5, step: 0.01 },
      heightScale: { value: 1.05, min: 0.2, max: 2.5, step: 0.01 },
      radiusScale: { value: 0.68, min: 0.2, max: 2.5, step: 0.01 },
    }),
    Motion: folder({
      curlScale: { value: 0.5, min: 0, max: 20, step: 0.01 },
      driftScale: { value: 0.35, min: 0, max: 20, step: 0.01 },
      spinScale: { value: 0.2, min: 0, max: 20, step: 0.01 },
    }),
    Distortion: folder({
      deformBig: { value: 0.11, min: 0, max: 1, step: 0.001 },
      distortBigScale: { value: 1.4, min: 0.1, max: 8, step: 0.01 },
      deformSmall: { value: 0.02, min: 0, max: 1, step: 0.001 },
      distortSmallScale: { value: 5.0, min: 0.1, max: 24, step: 0.01 },
      normalEpsilon: { value: 0.012, min: 0.002, max: 0.05, step: 0.001 },
    }),
    Shading: folder({
      rimStrength: { value: 0.18, min: 0, max: 1.5, step: 0.01 },
      shadowColor: { value: '#b4b5b8' },
      midColor: { value: '#ececed' },
      highlightColor: { value: '#ececed' },
      rimColor: { value: '#ffffff' },
    }),
    Outline: folder({
      outlineWidth: { value: 0.016, min: 0, max: 0.12, step: 0.001 },
      outlineColor: { value: '#7b7d82' },
    }),
  }, { collapsed: true });
  const resolvedCount = Math.max(1, Math.floor(puffCount));
  const resolvedSeed = Math.max(1, Math.floor(randomSeed));
  const puffMaterial = useMemo(() => createPuffMaterial(), []);
  const outlineMaterialState = useMemo(() => createOutlineMaterial(), []);
  const material = puffMaterial.material;
  const outlineMaterial = outlineMaterialState.material;
  const simulation = useMemo(
    () => createSmokeSimulation(resolvedCount, resolvedSeed),
    [resolvedCount, resolvedSeed],
  );

  const geometry = useMemo(() => {
    const puffGeometry = new THREE.SphereGeometry(1, 64, 64);

    puffGeometry.setAttribute('smokeSeed', simulation.seedAttribute);
    puffGeometry.setAttribute('smokeAge', simulation.ageAttribute);

    return puffGeometry;
  }, [simulation]);

  useEffect(() => {
    if (meshRef.current) meshRef.current.instanceMatrix = simulation.matrixAttribute;
    if (outlineRef.current) outlineRef.current.instanceMatrix = simulation.matrixAttribute;
  }, [simulation.matrixAttribute]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => outlineMaterial.dispose(), [outlineMaterial]);

  useEffect(() => {
    const { uniforms } = simulation;

    uniforms.curlScale.value = curlScale;
    uniforms.driftScale.value = driftScale;
    uniforms.heightScale.value = heightScale;
    uniforms.radiusScale.value = radiusScale;
    uniforms.scale.value = puffScale;
    uniforms.speedScale.value = speedScale;
    uniforms.spinScale.value = spinScale;
  }, [
    curlScale,
    driftScale,
    heightScale,
    puffScale,
    radiusScale,
    simulation,
    speedScale,
    spinScale,
  ]);

  useEffect(() => {
    const puffUniforms = puffMaterial.uniforms;
    const outlineUniforms = outlineMaterialState.uniforms;

    puffUniforms.deformBig.value = deformBig;
    puffUniforms.deformSmall.value = deformSmall;
    puffUniforms.distortBigScale.value = distortBigScale;
    puffUniforms.distortSmallScale.value = distortSmallScale;
    puffUniforms.highlightColor.value.set(highlightColor);
    puffUniforms.midColor.value.set(midColor);
    puffUniforms.normalEpsilon.value = normalEpsilon;
    puffUniforms.rimColor.value.set(rimColor);
    puffUniforms.rimStrength.value = rimStrength;
    puffUniforms.shadowColor.value.set(shadowColor);

    outlineUniforms.deformBig.value = deformBig;
    outlineUniforms.deformSmall.value = deformSmall;
    outlineUniforms.distortBigScale.value = distortBigScale;
    outlineUniforms.distortSmallScale.value = distortSmallScale;
    outlineUniforms.outlineColor.value.set(outlineColor);
    outlineUniforms.outlineWidth.value = outlineWidth;
  }, [
    deformBig,
    deformSmall,
    distortBigScale,
    distortSmallScale,
    highlightColor,
    midColor,
    normalEpsilon,
    outlineColor,
    outlineMaterialState,
    outlineWidth,
    puffMaterial,
    rimColor,
    rimStrength,
    shadowColor,
  ]);

  useFrame(({ gl }) => {
    if (!meshRef.current || !outlineRef.current || !gl.compute) return;
    gl.compute(simulation.computeNode);
  });

  return (
    <group position={position} dispose={null}>
      <instancedMesh
        ref={(mesh) => {
          outlineRef.current = mesh;
          if (mesh) mesh.instanceMatrix = simulation.matrixAttribute;
        }}
        args={[geometry, outlineMaterial, resolvedCount]}
        frustumCulled={false}
        renderOrder={0}
      />
      <instancedMesh
        ref={(mesh) => {
          meshRef.current = mesh;
          if (mesh) mesh.instanceMatrix = simulation.matrixAttribute;
        }}
        args={[geometry, material, resolvedCount]}
        frustumCulled={false}
        renderOrder={1}
      />
    </group>
  );
}
