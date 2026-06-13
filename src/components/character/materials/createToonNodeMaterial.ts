import * as THREE from 'three/webgpu';
import { LightingModel, MeshToonNodeMaterial } from 'three/webgpu';
import {
  BRDF_Lambert,
  Fn,
  float,
  materialColor,
  materialReference,
  mix,
  normalView,
  smoothstep,
  vec2,
  vec3,
  diffuseColor,
} from 'three/tsl';
import type { Node, NodeBuilder } from 'three/webgpu';

export interface ToonMaterialTextures {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  aoMap?: THREE.Texture;
  gradientMap?: THREE.Texture;
}

export interface ToonBandOptions {
  /** Shadow-side irradiance. Default in MeshToonMaterial: 0.7 */
  shadowLevel?: number;
  /** Lit-side irradiance. Default in MeshToonMaterial: 1.0 */
  highlightLevel?: number;
  /** Step threshold for the default band. Default in MeshToonMaterial: 0.7 */
  bandThreshold?: number;
}

export interface ToonShadowTint {
  shadow: [number, number, number];
  lit: [number, number, number];
}

export interface ToonMaterialOptions extends ToonBandOptions {
  textures: ToonMaterialTextures;
  color?: THREE.ColorRepresentation;
  aoMapIntensity?: number;
  normalScale?: THREE.Vector2;
  shadowTint?: ToonShadowTint;
  /** Override the built-in albedo node. Defaults to `materialColor` (map * color). */
  colorNode?: Node;
}

/**
 * Mirrors Three.js `getGradientIrradiance` from `gradientmap_pars_fragment`.
 * Uses a 1D gradient map when present, otherwise a two-step toon band.
 */
function createGradientIrradianceFn(options: ToonBandOptions) {
  const shadowLevel = options.shadowLevel ?? 0.7;
  const highlightLevel = options.highlightLevel ?? 1.0;
  const bandThreshold = options.bandThreshold ?? 0.7;

  return Fn(({ normal, lightDirection, builder }: { normal: Node; lightDirection: Node; builder: THREE.NodeBuilder }) => {
    const dotNL = normal.dot(lightDirection);
    const coord = vec2(dotNL.mul(0.5).add(0.5), 0.0);

    if (builder.material.gradientMap) {
      const gradientMap = materialReference('gradientMap', 'texture').context({ getUV: () => coord });
      return vec3(gradientMap.r);
    }

    const fw = coord.fwidth().mul(0.5);

    return mix(
      vec3(shadowLevel),
      vec3(highlightLevel),
      smoothstep(float(bandThreshold).sub(fw.x), float(bandThreshold).add(fw.x), coord.x),
    );
  });
}

/**
 * Node reimplementation of `RE_Direct_Toon` / `RE_IndirectDiffuse_Toon`
 * from `lights_toon_pars_fragment`.
 */
class CustomToonLightingModel extends LightingModel {
  private readonly gradientIrradianceFn: ReturnType<typeof createGradientIrradianceFn>;

  constructor(gradientIrradianceFn: ReturnType<typeof createGradientIrradianceFn>) {
    super();
    this.gradientIrradianceFn = gradientIrradianceFn;
  }

  direct({ lightDirection, lightColor, reflectedLight }: THREE.LightingModelDirectInput, builder: THREE.NodeBuilder) {
    const irradiance = this.gradientIrradianceFn({ normal: normalView, lightDirection, builder }).mul(lightColor);

    reflectedLight.directDiffuse.addAssign(
      irradiance.mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })),
    );
  }

  indirect(builder: THREE.NodeBuilder) {
    const { ambientOcclusion, irradiance, reflectedLight } = builder.context;

    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}

class CustomToonNodeMaterial extends MeshToonNodeMaterial {
  private readonly gradientIrradianceFn: ReturnType<typeof createGradientIrradianceFn>;

  constructor(
    parameters: THREE.MeshToonMaterialParameters | undefined,
    bandOptions: ToonBandOptions,
  ) {
    super(parameters);
    this.gradientIrradianceFn = createGradientIrradianceFn(bandOptions);
  }

  setupLightingModel() {
    return new CustomToonLightingModel(this.gradientIrradianceFn);
  }
}

export function createToonNodeMaterial(options: ToonMaterialOptions): MeshToonNodeMaterial {
  const {
    textures,
    color = '#ffffff',
    aoMapIntensity = 1,
    normalScale,
    shadowLevel,
    highlightLevel,
    bandThreshold,
    shadowTint,
    colorNode,
  } = options;

  const material = new CustomToonNodeMaterial(
    {
      map: textures.map ?? null,
      normalMap: textures.normalMap ?? null,
      aoMap: textures.aoMap ?? null,
      gradientMap: textures.gradientMap ?? null,
      color,
      aoMapIntensity,
      normalScale,
    },
    { shadowLevel, highlightLevel, bandThreshold },
  );

  // Mirrors `#include <map_fragment>` while keeping a single override point.
  material.colorNode = colorNode ?? Fn(() => materialColor)();

  if (shadowTint) {
    const { shadow, lit } = shadowTint;

    // Runtime passes the shadow node as the first argument; the property type is outdated.
    material.receivedShadowNode = Fn(([shadowNode]: [Node], _builder: NodeBuilder) => {
      return shadowNode.mix(vec3(...shadow), vec3(...lit));
    }) as unknown as NonNullable<MeshToonNodeMaterial['receivedShadowNode']>;
  }

  return material;
}
