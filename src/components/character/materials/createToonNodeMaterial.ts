import * as THREE from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  max,
  mix,
  normalLocal,
  positionLocal,
  positionWorld,
  pow,
  step,
  texture,
  transformNormal,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import {
  CHARACTER_LOOK_DEFAULTS,
} from '../look/characterDefaults';

export interface ToonMaterialTextures {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  aoMap?: THREE.Texture;
}

export type UniformValue<T> = { value: T };

export interface WoodblockToonUniforms {
  lightDir: UniformValue<THREE.Vector3>;
  colorLevels: UniformValue<number>;
  thresholdLow: UniformValue<number>;
  thresholdHigh: UniformValue<number>;
  rimStrength: UniformValue<number>;
  rimThreshold: UniformValue<number>;
  rimPower: UniformValue<number>;
  shadowTint: UniformValue<THREE.Color>;
  highlightTint: UniformValue<THREE.Color>;
  aoIntensity: UniformValue<number>;
}

export interface OutlineUniforms {
  edgeColor: UniformValue<THREE.Color>;
  outlineWidth: UniformValue<number>;
}

export interface ToonMaterialOptions {
  textures: ToonMaterialTextures;
  colorLevels?: number;
  thresholdLow?: number;
  thresholdHigh?: number;
  rimStrength?: number;
  rimThreshold?: number;
  rimPower?: number;
  shadowTint?: string;
  highlightTint?: string;
  aoIntensity?: number;
  lightDir?: THREE.Vector3;
}

export interface OutlineMaterialOptions {
  edgeColor?: string;
  outlineWidth?: number;
}

export type CharacterToonMaterial = THREE.MeshBasicNodeMaterial & {
  userData: { toonUniforms: WoodblockToonUniforms };
};

export type CharacterOutlineMaterial = THREE.MeshBasicNodeMaterial & {
  userData: { outlineUniforms: OutlineUniforms };
};

function uNumber(value: number) {
  return uniform(value) as unknown as UniformValue<number>;
}

function uColor(value: string) {
  return uniform(new THREE.Color(value)) as unknown as UniformValue<THREE.Color>;
}

function uVec3(value: THREE.Vector3) {
  return uniform(value) as unknown as UniformValue<THREE.Vector3>;
}

export function createToonNodeMaterial(options: ToonMaterialOptions): CharacterToonMaterial {
  const {
    textures,
    colorLevels = CHARACTER_LOOK_DEFAULTS.colorLevels,
    thresholdLow = CHARACTER_LOOK_DEFAULTS.thresholdLow,
    thresholdHigh = CHARACTER_LOOK_DEFAULTS.thresholdHigh,
    rimStrength = CHARACTER_LOOK_DEFAULTS.rimStrength,
    rimThreshold = CHARACTER_LOOK_DEFAULTS.rimThreshold,
    rimPower = CHARACTER_LOOK_DEFAULTS.rimPower,
    shadowTint = CHARACTER_LOOK_DEFAULTS.shadowTint,
    highlightTint = CHARACTER_LOOK_DEFAULTS.highlightTint,
    aoIntensity = CHARACTER_LOOK_DEFAULTS.aoIntensity,
    lightDir = new THREE.Vector3(...CHARACTER_LOOK_DEFAULTS.lightDir),
  } = options;

  const toonUniforms: WoodblockToonUniforms = {
    lightDir: uVec3(lightDir.clone().normalize()),
    colorLevels: uNumber(colorLevels),
    thresholdLow: uNumber(thresholdLow),
    thresholdHigh: uNumber(thresholdHigh),
    rimStrength: uNumber(rimStrength),
    rimThreshold: uNumber(rimThreshold),
    rimPower: uNumber(rimPower),
    shadowTint: uColor(shadowTint),
    highlightTint: uColor(highlightTint),
    aoIntensity: uNumber(aoIntensity),
  };

  const albedoMap = textures.map ?? null;
  const aoMap = textures.aoMap ?? null;

  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.FrontSide,
    map: albedoMap,
  }) as CharacterToonMaterial;

  material.fragmentNode = Fn(() => {
    const uvCoord = uv();
    const albedo = albedoMap
      ? texture(albedoMap, uvCoord).rgb
      : vec3(1.0, 1.0, 1.0);

    const N = transformNormal(normalLocal).normalize().toVar();
    const V = cameraPosition.sub(positionWorld).normalize().toVar();
    const L = vec3(toonUniforms.lightDir as any).normalize().toVar();
    const ndl = max(dot(N, L), 0.0).toVar();

    const rimRaw = pow(
      float(1.0).sub(max(dot(N, V), 0.0)),
      toonUniforms.rimPower as any,
    ).toVar();
    const rimLift = step(toonUniforms.rimThreshold as any, rimRaw)
      .mul(toonUniforms.rimStrength as any)
      .toVar();

    const thresholdWidth = max(
      (toonUniforms.thresholdHigh as any).sub(toonUniforms.thresholdLow as any),
      0.001,
    ).toVar();
    const levelSteps = max((toonUniforms.colorLevels as any).sub(1.0), 1.0).toVar();
    const shade = clamp(
      ndl.add(rimLift).sub(toonUniforms.thresholdLow as any).div(thresholdWidth),
      0.0,
      1.0,
    ).toVar();
    const quantized = floor(shade.mul(levelSteps).add(0.5)).div(levelSteps).toVar();

    const litColor = mix(
      albedo.mul(vec3(toonUniforms.shadowTint as any)),
      albedo.mul(vec3(toonUniforms.highlightTint as any)),
      quantized,
    ).toVar();

    if (aoMap) {
      const ao = texture(aoMap, uvCoord).r;
      const aoMul = mix(float(1.0), ao, toonUniforms.aoIntensity as any);
      litColor.assign(litColor.mul(aoMul));
    }

    return vec4(clamp(litColor, 0.0, 1.0), 1.0);
  })();

  material.userData.toonUniforms = toonUniforms;
  return material;
}

export function createOutlineMaterial(options: OutlineMaterialOptions = {}): CharacterOutlineMaterial {
  const {
    edgeColor = CHARACTER_LOOK_DEFAULTS.edgeColor,
    outlineWidth = CHARACTER_LOOK_DEFAULTS.outlineWidth,
  } = options;

  const outlineUniforms: OutlineUniforms = {
    edgeColor: uColor(edgeColor),
    outlineWidth: uNumber(outlineWidth),
  };

  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.BackSide,
    depthWrite: true,
  }) as CharacterOutlineMaterial;

  material.positionNode = positionLocal.add(
    normalLocal.normalize().mul(outlineUniforms.outlineWidth as any),
  );
  material.fragmentNode = Fn(() => vec4(vec3(outlineUniforms.edgeColor as any), 1.0))();
  material.userData.outlineUniforms = outlineUniforms;

  return material;
}
