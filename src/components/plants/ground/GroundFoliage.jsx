import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import {
  attribute,
  clamp,
  cos,
  float,
  Fn,
  mix,
  positionGeometry,
  pow,
  shadow,
  sin,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import { GROUND_MEADOW_DEFAULTS } from './groundMeadowDefaults';
import { PLANT_WIND_DEFAULTS, windDirection } from '../wind/plantWind';

const GRASS_WIND_RESPONSE = 12;
const FOOTPRINT_MARGIN = 0.045;
const _ray = new THREE.Ray(
  new THREE.Vector3(),
  new THREE.Vector3(0, 1, 0),
);
const FOOTPRINT_OFFSETS = [
  [0, 0],
  [FOOTPRINT_MARGIN, 0],
  [-FOOTPRINT_MARGIN, 0],
  [0, FOOTPRINT_MARGIN],
  [0, -FOOTPRINT_MARGIN],
];

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _rotation = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

function seededRng(seed) {
  let value = ((seed + 1) * 2654435761) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createBladeGeometry(segments) {
  const segmentCount = Math.max(2, Math.floor(segments));
  const positions = [];
  const indices = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const t = index / segmentCount;
    const taper = Math.pow(1 - t, 0.72);
    const halfWidth = t === 1
      ? 0.012
      : (0.2 + Math.sin(Math.PI * t) * 0.13) * taper;
    const bend = 0.3 * t * t;
    positions.push(-halfWidth, t, bend, halfWidth, t, bend);
  }

  for (let row = 0; row < segmentCount; row += 1) {
    const a = row * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function createGrassMaterial(light) {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const colorA = uniform(new THREE.Color());
  const colorB = uniform(new THREE.Color());
  // Pack tone + ground XZ + rotation into one slot. With instanceMatrix this
  // stays comfortably below WebGPU's eight vertex-buffer-slot limit.
  const grassData = attribute('aGrassData', 'vec4');
  const tone = grassData.x;
  const windCoord = grassData.yz;
  const bladeRotation = grassData.w;
  const windUniforms = {
    time: uniform(0),
    enabled: uniform(1),
    direction: uniform(new THREE.Vector2(1, 0)),
    strength: uniform(PLANT_WIND_DEFAULTS.windStrength),
    scale: uniform(PLANT_WIND_DEFAULTS.windScale),
    speed: uniform(PLANT_WIND_DEFAULTS.windSpeed),
    colorShift: uniform(PLANT_WIND_DEFAULTS.colorShift),
  };

  const windNodes = Fn(() => {
    const travel = windUniforms.time.mul(windUniforms.speed);
    const u = windCoord.x.mul(windUniforms.scale)
      .add(windUniforms.direction.x.mul(travel));
    const v = windCoord.y.mul(windUniforms.scale)
      .add(windUniforms.direction.y.mul(travel));
    const slowRaw = sin(u)
      .add(sin(u.mul(2.13).add(v.mul(1.7))).mul(0.5))
      .add(sin(v.mul(1.31).sub(u.mul(0.7))).mul(0.25));
    const slow = slowRaw.div(1.75).mul(0.5).add(0.5);
    const fast = sin(
      u.mul(3.17).sub(v.mul(2.43)).add(travel.mul(3.7)),
    ).mul(0.5).add(0.5);
    return clamp(slow.mul(0.78).add(fast.mul(0.22)), 0, 1);
  });

  material.positionNode = Fn(() => {
    const gust = windNodes();
    const rotationCos = cos(bladeRotation);
    const rotationSin = sin(bladeRotation);
    const localWindX = rotationCos.mul(windUniforms.direction.x)
      .sub(rotationSin.mul(windUniforms.direction.y));
    const localWindZ = rotationSin.mul(windUniforms.direction.x)
      .add(rotationCos.mul(windUniforms.direction.y));
    const heightMask = pow(clamp(positionGeometry.y, 0, 1), float(2));
    const amount = gust
      .mul(windUniforms.strength)
      .mul(windUniforms.enabled)
      .mul(GRASS_WIND_RESPONSE)
      .mul(heightMask);
    return positionGeometry.add(vec3(localWindX, 0, localWindZ).mul(amount));
  })();

  material.colorNode = Fn(() => {
    const painted = mix(colorA, colorB, smoothstep(0.3, 0.7, tone));
    const windShade = windNodes()
      .mul(windUniforms.colorShift)
      .mul(windUniforms.enabled);
    const windColor = mix(painted, colorA, windShade);
    if (!light) return windColor;
    // Grass receives the scene shadow, but the blades themselves never enter
    // the shadow map. This avoids thousands of noisy self-shadow lines.
    const shadowAmount = smoothstep(
      float(0.05),
      float(0.95),
      shadow(light).oneMinus(),
    ).mul(float(0.5));
    // Preserve each blade's painted hue in shadow. The previous colorA * 0.48
    // target turned the bright grass into hard, nearly black silhouettes.
    const shadowColor = mix(
      windColor.mul(float(0.82)),
      colorA,
      float(0.22),
    );
    return mix(windColor, shadowColor, shadowAmount);
  })();
  material.userData.palette = { colorA, colorB };
  material.userData.windUniforms = windUniforms;
  return material;
}

function combinedGroundCenter(bodyBounds, backpackBounds) {
  const boxes = [bodyBounds?.localBox, backpackBounds?.localBox].filter(Boolean);
  if (!boxes.length) return [0, 0];
  const box = boxes[0].clone();
  for (let index = 1; index < boxes.length; index += 1) box.union(boxes[index]);
  return [
    (box.min.x + box.max.x) * 0.5,
    (box.min.z + box.max.z) * 0.5,
  ];
}

function paintField(x, z, scale) {
  const px = x * scale;
  const pz = z * scale;
  const broad = Math.sin(px * 1.37 + Math.sin(pz * 0.73) * 1.4);
  const cross = Math.sin(pz * 1.91 - px * 0.42);
  return THREE.MathUtils.clamp(0.5 + broad * 0.25 + cross * 0.2, 0, 1);
}

function pointInsideExpandedBox(x, z, box) {
  return x >= box.min.x - FOOTPRINT_MARGIN
    && x <= box.max.x + FOOTPRINT_MARGIN
    && z >= box.min.z - FOOTPRINT_MARGIN
    && z <= box.max.z + FOOTPRINT_MARGIN;
}

function isBlockedByHostFootprint(x, z, host) {
  const box = host?.localBox;
  const bvh = host?.bvh;
  if (!box || !bvh || !pointInsideExpandedBox(x, z, box)) return false;
  const rayStart = box.min.y - 0.25;
  const rayDistance = Math.max(box.max.y - box.min.y + 0.5, 0.5);
  for (const [offsetX, offsetZ] of FOOTPRINT_OFFSETS) {
    _ray.origin.set(x + offsetX, rayStart, z + offsetZ);
    if (bvh.raycastFirst(_ray, THREE.DoubleSide, 0, rayDistance)) return true;
  }
  return false;
}

function buildBladeLayout({
  bodyBounds,
  backpackBounds,
  count,
  areaX,
  areaZ,
  heightScale,
  patchScale,
}) {
  const rng = seededRng(GROUND_MEADOW_DEFAULTS.layoutSeed);
  const center = combinedGroundCenter(bodyBounds, backpackBounds);
  const hosts = [bodyBounds, backpackBounds];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  return Array.from({ length: count }, (_, index) => {
    // Jittered sunflower sampling covers the field without random bald spots.
    const radius = Math.sqrt((index + 0.35 + rng() * 0.3) / Math.max(count, 1));
    const angle = index * goldenAngle + (rng() - 0.5) * 0.7;
    const x = center[0] + Math.cos(angle) * radius * areaX * 0.97;
    const z = center[1] + Math.sin(angle) * radius * areaZ * 0.97;
    const height = THREE.MathUtils.lerp(0.1, 0.24, rng()) * heightScale;
    return {
      x,
      z,
      height,
      width: height * THREE.MathUtils.lerp(0.18, 0.3, rng()),
      rotation: rng() * Math.PI,
      tone: paintField(x, z, patchScale),
      blocked: hosts.some((host) => isBlockedByHostFootprint(x, z, host)),
    };
  });
}

export function GroundFoliage({
  bodyBounds = null,
  backpackBounds = null,
  config = GROUND_MEADOW_DEFAULTS,
  wind = PLANT_WIND_DEFAULTS,
}) {
  const meshRef = useRef(null);
  const { scene } = useThree();
  const [light, setLight] = useState(null);
  useEffect(() => {
    let found = null;
    scene.traverse((object) => {
      if (!found && object.isDirectionalLight) found = object;
    });
    setLight(found);
  }, [scene]);
  const boundsReady = Boolean(bodyBounds?.localBox || backpackBounds?.localBox);
  const instances = useMemo(() => {
    if (!boundsReady || !config.enabled || config.bladeCount < 1) return [];
    return buildBladeLayout({
      bodyBounds,
      backpackBounds,
      count: Math.floor(config.bladeCount),
      areaX: config.areaX,
      areaZ: config.areaZ,
      heightScale: config.grassHeight,
      patchScale: config.patchScale,
    });
  }, [
    boundsReady,
    bodyBounds,
    backpackBounds,
    config.enabled,
    config.bladeCount,
    config.areaX,
    config.areaZ,
    config.grassHeight,
    config.patchScale,
  ]);

  const geometry = useMemo(() => {
    const result = createBladeGeometry(config.bladeSegments);
    const grassData = new Float32Array(instances.length * 4);
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      const offset = index * 4;
      grassData[offset] = instance.tone;
      grassData[offset + 1] = instance.x;
      grassData[offset + 2] = instance.z;
      grassData[offset + 3] = instance.rotation;
    }
    result.setAttribute(
      'aGrassData',
      new THREE.InstancedBufferAttribute(grassData, 4),
    );
    return result;
  }, [config.bladeSegments, instances]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => createGrassMaterial(light), [light]);
  useEffect(() => {
    material.userData.palette.colorA.value.set(config.grassColorA);
    material.userData.palette.colorB.value.set(config.grassColorB);
  }, [config.grassColorA, config.grassColorB, material]);
  useEffect(() => {
    const uniforms = material.userData.windUniforms;
    const { dirX, dirZ } = windDirection(wind.windAngle);
    uniforms.enabled.value = wind.enabled ? 1 : 0;
    uniforms.direction.value.set(dirX, dirZ);
    uniforms.strength.value = wind.windStrength;
    uniforms.scale.value = wind.windScale;
    uniforms.speed.value = wind.windSpeed;
    uniforms.colorShift.value = wind.colorShift;
  }, [
    material,
    wind.enabled,
    wind.windAngle,
    wind.windStrength,
    wind.windScale,
    wind.windSpeed,
    wind.colorShift,
  ]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    material.userData.windUniforms.time.value = clock.elapsedTime;
  });

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      _position.set(instance.x, 0.008, instance.z);
      _euler.set(0, instance.rotation, 0);
      _rotation.setFromEuler(_euler);
      if (instance.blocked) _scale.setScalar(0);
      else _scale.set(instance.width, instance.height, instance.width);
      _matrix.compose(_position, _rotation, _scale);
      mesh.setMatrixAt(index, _matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances]);

  if (!config.enabled || !instances.length) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, instances.length]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow
      name="GroundGrass"
    />
  );
}
