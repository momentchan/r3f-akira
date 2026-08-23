import * as THREE from 'three/webgpu';
import {
  Fn,
  clamp,
  dot,
  float,
  floor,
  max,
  min,
  mix,
  normalLocal,
  positionLocal,
  positionWorld,
  shadow,
  sin,
  smoothstep,
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
  dirtMap?: THREE.Texture;
}

export type UniformValue<T> = { value: T };

export interface ToonUniforms {
  lightDir: UniformValue<THREE.Vector3>;
  colorLevels: UniformValue<number>;
  thresholdLow: UniformValue<number>;
  thresholdHigh: UniformValue<number>;
  shadowTint: UniformValue<THREE.Color>;
  highlightTint: UniformValue<THREE.Color>;
  dirtAmount: UniformValue<number>;
  dirtLevels: UniformValue<number>;
  dirtContactCut: UniformValue<number>;
  dirtContactFade: UniformValue<number>;
  /** World Y of the shared ground plane (field parent origin). */
  dirtGroundY: UniformValue<number>;
  /** 1 = visualize contact mask (magenta heat). */
  dirtDebug: UniformValue<number>;
  /** 1 = apply cast shadow from scene light; 0 = disable without shader recompile. */
  castShadowEnabled: UniformValue<number>;
}

export interface OutlineUniforms {
  edgeColor: UniformValue<THREE.Color>;
  outlineWidth: UniformValue<number>;
}

export type ToonMaterialOptions = {
  textures: ToonMaterialTextures;
  lightDir?: THREE.Vector3;
} & Partial<Omit<typeof CHARACTER_LOOK_DEFAULTS, 'lightDir'>>;

export type OutlineMaterialOptions = Partial<
  Pick<typeof CHARACTER_LOOK_DEFAULTS, 'edgeColor' | 'outlineWidth'>
>;

export type CharacterToonMaterial = THREE.MeshBasicNodeMaterial & {
  userData: {
    toonUniforms: ToonUniforms;
    /** Rebuild fragmentNode to include cast-shadow sampling from a scene light. */
    patchShadow: (light: THREE.DirectionalLight) => void;
  };
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

const DIRT_FULL_HEIGHT = 0.06;
const DIRT_FADE_HEIGHT = 0.42;
const DIRT_EDGE_NOISE = 0.055;
const DIRT_NOISE_SCALE = 2.4;

export function setDirtGroundY(
  uniformsList: ToonUniforms[],
  parent: THREE.Object3D | null | undefined,
) {
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  const y = parent.matrixWorld.elements[13];
  for (const uniforms of uniformsList) {
    uniforms.dirtGroundY.value = y;
  }
}

function buildToonFragment(
  toonUniforms: ToonUniforms,
  albedoMap: THREE.Texture | null,
  dirtMap: THREE.Texture | null,
  light: THREE.DirectionalLight | null,
) {
  return Fn(() => {
    const uvCoord = uv();
    const clean = albedoMap
      ? texture(albedoMap, uvCoord).rgb
      : vec3(1.0, 1.0, 1.0);

    // Posed world height above the field ground. Skinning writes positionLocal
    // first, so positionWorld is the lying suit, not the bind pose.
    const worldP = positionWorld;
    const nx = worldP.x.mul(DIRT_NOISE_SCALE);
    const nz = worldP.z.mul(DIRT_NOISE_SCALE);
    const noise = sin(nx.mul(1.13).add(nz.mul(0.71)).add(0.6))
      .add(sin(nx.mul(-0.47).add(nz.mul(1.37)).add(2.1)))
      .mul(0.25);
    const height = worldP.y
      .sub(toonUniforms.dirtGroundY as any)
      .sub(noise.mul(DIRT_EDGE_NOISE));
    const fadeH = float(DIRT_FADE_HEIGHT);
    const span = float(DIRT_FADE_HEIGHT - DIRT_FULL_HEIGHT);
    const t = clamp(fadeH.sub(height).div(span), 0.0, 1.0);
    const contactRaw = t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
    const contactCut = toonUniforms.dirtContactCut as any;
    const contactEnd = contactCut.add(
      max(toonUniforms.dirtContactFade as any, 0.001),
    );
    const contact = smoothstep(contactCut, contactEnd, contactRaw);

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

    // Cast shadow is merged into the toon quantization level before the color
    // mix, not applied on top. This prevents double-darkening: an area already
    // at the shadow floor stays there; only lit areas are pulled down.
    if (light?.shadow?.map) {
      const castLit = step(float(0.5), shadow(light as any) as any);
      // mix(1, castLit, 0) = 1 → no effect; mix(1, castLit, 1) = castLit → shadow on
      const gated = mix(float(1.0), castLit, toonUniforms.castShadowEnabled as any);
      quantized.assign(min(quantized, gated));
    }

    const litColor = mix(
      albedo.mul(vec3(toonUniforms.shadowTint as any)),
      albedo.mul(vec3(toonUniforms.highlightTint as any)),
      quantized,
    ).toVar();

    const debugCol = mix(
      vec3(0.12, 0.12, 0.14),
      vec3(1.0, 0.2, 0.75),
      contact,
    );
    const withDebug = mix(litColor, debugCol, toonUniforms.dirtDebug as any);

    return vec4(clamp(withDebug, 0.0, 1.0), 1.0);
  })();
}

export function createToonNodeMaterial(options: ToonMaterialOptions): CharacterToonMaterial {
  const { textures, lightDir, ...look } = options;
  const d = { ...CHARACTER_LOOK_DEFAULTS, ...look };
  const dir = (lightDir ?? new THREE.Vector3(...d.lightDir)).clone().normalize();

  const toonUniforms: ToonUniforms = {
    lightDir: uVec3(dir),
    colorLevels: uNumber(d.colorLevels),
    thresholdLow: uNumber(d.thresholdLow),
    thresholdHigh: uNumber(d.thresholdHigh),
    shadowTint: uColor(d.shadowTint),
    highlightTint: uColor(d.highlightTint),
    dirtAmount: uNumber(d.dirtAmount),
    dirtLevels: uNumber(d.dirtLevels),
    dirtContactCut: uNumber(d.dirtContactCut),
    dirtContactFade: uNumber(d.dirtContactFade),
    dirtGroundY: uNumber(-1),
    dirtDebug: uNumber(d.dirtDebug ? 1 : 0),
    castShadowEnabled: uNumber(d.castShadowEnabled ? 1 : 0),
  };

  const albedoMap = textures.map ?? null;
  const dirtMap = textures.dirtMap ?? null;

  const material = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
    side: THREE.FrontSide,
    map: albedoMap,
  }) as CharacterToonMaterial;

  material.fragmentNode = buildToonFragment(toonUniforms, albedoMap, dirtMap, null);

  const patchShadow = (newLight: THREE.DirectionalLight) => {
    if (!newLight?.shadow?.map) return;
    material.fragmentNode = buildToonFragment(toonUniforms, albedoMap, dirtMap, newLight);
    material.needsUpdate = true;
  };

  material.userData.toonUniforms = toonUniforms;
  material.userData.patchShadow = patchShadow;
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
