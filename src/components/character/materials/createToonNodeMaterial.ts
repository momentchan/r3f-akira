import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  clamp,
  dot,
  float,
  floor,
  max,
  mix,
  normalLocal,
  positionLocal,
  smoothstep,
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
  dirtMap?: THREE.Texture;
  normalMap?: THREE.Texture;
  aoMap?: THREE.Texture;
}

export type UniformValue<T> = { value: T };

export interface WoodblockToonUniforms {
  lightDir: UniformValue<THREE.Vector3>;
  colorLevels: UniformValue<number>;
  thresholdLow: UniformValue<number>;
  thresholdHigh: UniformValue<number>;
  shadowTint: UniformValue<THREE.Color>;
  highlightTint: UniformValue<THREE.Color>;
  aoIntensity: UniformValue<number>;
  dirtAmount: UniformValue<number>;
  dirtLevels: UniformValue<number>;
  dirtContactCut: UniformValue<number>;
  dirtContactFade: UniformValue<number>;
  /** 1 = visualize aContactDirt mask (magenta heat). */
  dirtDebug: UniformValue<number>;
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
  shadowTint?: string;
  highlightTint?: string;
  aoIntensity?: number;
  dirtAmount?: number;
  dirtLevels?: number;
  dirtContactCut?: number;
  dirtContactFade?: number;
  dirtDebug?: number | boolean;
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
    shadowTint = CHARACTER_LOOK_DEFAULTS.shadowTint,
    highlightTint = CHARACTER_LOOK_DEFAULTS.highlightTint,
    aoIntensity = CHARACTER_LOOK_DEFAULTS.aoIntensity,
    dirtAmount = CHARACTER_LOOK_DEFAULTS.dirtAmount,
    dirtLevels = CHARACTER_LOOK_DEFAULTS.dirtLevels,
    dirtContactCut = CHARACTER_LOOK_DEFAULTS.dirtContactCut,
    dirtContactFade = CHARACTER_LOOK_DEFAULTS.dirtContactFade,
    dirtDebug = CHARACTER_LOOK_DEFAULTS.dirtDebug,
    lightDir = new THREE.Vector3(...CHARACTER_LOOK_DEFAULTS.lightDir),
  } = options;

  const toonUniforms: WoodblockToonUniforms = {
    lightDir: uVec3(lightDir.clone().normalize()),
    colorLevels: uNumber(colorLevels),
    thresholdLow: uNumber(thresholdLow),
    thresholdHigh: uNumber(thresholdHigh),
    shadowTint: uColor(shadowTint),
    highlightTint: uColor(highlightTint),
    aoIntensity: uNumber(aoIntensity),
    dirtAmount: uNumber(dirtAmount),
    dirtLevels: uNumber(dirtLevels),
    dirtContactCut: uNumber(dirtContactCut),
    dirtContactFade: uNumber(dirtContactFade),
    dirtDebug: uNumber(dirtDebug ? 1 : 0),
  };

  const albedoMap = textures.map ?? null;
  const dirtMap = textures.dirtMap ?? null;
  const aoMap = textures.aoMap ?? null;

  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.FrontSide,
    map: albedoMap,
  }) as CharacterToonMaterial;

  material.fragmentNode = Fn(() => {
    const uvCoord = uv();
    const clean = albedoMap
      ? texture(albedoMap, uvCoord).rgb
      : vec3(1.0, 1.0, 1.0);

    // Soft contact: cut = onset, fade = soft edge width (smoothstep, not hard step).
    const contactRaw = attribute('aContactDirt', 'float');
    const contactCut = toonUniforms.dirtContactCut as any;
    const contactEnd = contactCut.add(
      max(toonUniforms.dirtContactFade as any, 0.001),
    );
    // `as any` like the uniforms above: TSL widens attribute()'s 'float'
    // literal to string, so the node type is lost. Correct at runtime.
    const contact = smoothstep(contactCut, contactEnd, contactRaw as any);

    const N = transformNormal(normalLocal).normalize().toVar();
    const L = vec3(toonUniforms.lightDir as any).normalize().toVar();
    const ndl = max(dot(N, L), 0.0).toVar();

    const thresholdWidth = max(
      (toonUniforms.thresholdHigh as any).sub(toonUniforms.thresholdLow as any),
      0.001,
    ).toVar();
    const preShade = clamp(
      ndl.sub(toonUniforms.thresholdLow as any).div(thresholdWidth),
      0.0,
      1.0,
    ).toVar();
    const shadowWeight = float(1.0).sub(preShade);

    let albedo = clean.toVar();
    if (dirtMap) {
      const dirt = texture(dirtMap, uvCoord).rgb;
      const levels = max((toonUniforms.dirtLevels as any).sub(1.0), 1.0);
      const dirtQ = floor(dirt.mul(levels).add(0.5)).div(levels);
      const shadeGate = mix(float(0.4), float(1.0), shadowWeight);
      const w = (toonUniforms.dirtAmount as any).mul(contact).mul(shadeGate);
      albedo.assign(mix(clean, dirtQ, w));
    }

    const levelSteps = max((toonUniforms.colorLevels as any).sub(1.0), 1.0).toVar();
    const quantized = floor(preShade.mul(levelSteps).add(0.5)).div(levelSteps).toVar();

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

    const debugCol = mix(
      vec3(0.12, 0.12, 0.14),
      vec3(1.0, 0.2, 0.75),
      contact,
    );
    const outRgb = mix(litColor, debugCol, toonUniforms.dirtDebug as any);

    return vec4(clamp(outRgb, 0.0, 1.0), 1.0);
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
