import * as THREE from 'three/webgpu';
import {
  Fn,
  PI,
  abs,
  clamp,
  float,
  floor,
  fract,
  hash,
  mix,
  mod,
  pow,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { SILK_WEAVE_DEFAULTS } from './silkWeaveDefaults';

export function createSilkWeaveUniforms(defaults = SILK_WEAVE_DEFAULTS) {
  return {
    enabled: uniform(defaults.enabled ? 1 : 0),
    threadCount: uniform(defaults.threadCount),
    strength: uniform(defaults.strength),
    sharpness: uniform(defaults.sharpness),
    threadVariation: uniform(defaults.threadVariation),
    irregularity: uniform(defaults.irregularity),
    tintColor: uniform(new THREE.Color(defaults.tintColor)),
    tintStrength: uniform(defaults.tintStrength),
    blotchScale: uniform(defaults.blotchScale),
    blotchStrength: uniform(defaults.blotchStrength),
  };
}

const hash2 = Fn(([p]) => {
  const cell = vec2(p);
  return hash(cell.x.add(cell.y.mul(57.31)));
});

const valueNoise2 = Fn(([p]) => {
  const point = vec2(p).toVar();
  const cell = floor(point).toVar();
  const local = fract(point).toVar();
  const fade = local.mul(local).mul(vec2(3.0).sub(local.mul(2.0))).toVar();

  const n00 = hash2(cell);
  const n10 = hash2(cell.add(vec2(1.0, 0.0)));
  const n01 = hash2(cell.add(vec2(0.0, 1.0)));
  const n11 = hash2(cell.add(vec2(1.0, 1.0)));

  return mix(mix(n00, n10, fade.x), mix(n01, n11, fade.x), fade.y);
});

/**
 * Overlays a procedural silk-canvas weave (vertical warp / horizontal weft
 * threads), an aged tint, and stain blotches on top of a scene pass node.
 */
export function createSilkWeaveNode(inputNode, uniforms) {
  return Fn(() => {
    const sceneColor = vec4(inputNode).toVar();

    // Aspect-corrected coordinate measured in thread cells.
    const aspect = screenSize.x.div(screenSize.y);
    const coord = screenUV.mul(vec2(aspect, 1.0)).mul(uniforms.threadCount).toVar();

    // Jitter each row/column phase so the weave doesn't look machine-made.
    const rowJitter = hash(floor(coord.y).add(13.7)).sub(0.5).mul(uniforms.irregularity);
    const colJitter = hash(floor(coord.x).add(91.3)).sub(0.5).mul(uniforms.irregularity);
    const x = coord.x.add(rowJitter).toVar();
    const y = coord.y.add(colJitter).toVar();

    // Thread cross-section: 1 at thread center, 0 in the groove between threads.
    const warp = pow(abs(sin(x.mul(PI))), uniforms.sharpness);
    const weft = pow(abs(sin(y.mul(PI))), uniforms.sharpness);

    // Alternate which thread lies on top, like real over/under weaving.
    const col = floor(x).toVar();
    const row = floor(y).toVar();
    const checker = mod(col.add(row), 2.0);
    const weave = mix(warp, weft, checker);

    // Random per-thread tone so individual fibers read differently.
    const threadTone = mix(hash(col.mul(7.77)), hash(row.mul(3.33)), checker)
      .sub(0.5)
      .mul(uniforms.threadVariation);

    const fabric = clamp(
      float(1.0).sub(uniforms.strength.mul(float(1.0).sub(weave))).add(threadTone),
      0.0,
      1.0,
    );

    // Low-frequency mottled staining of aged silk (two noise octaves).
    const stainUV = screenUV.mul(vec2(aspect, 1.0)).mul(uniforms.blotchScale);
    const stain = valueNoise2(stainUV)
      .mul(0.65)
      .add(valueNoise2(stainUV.mul(2.7).add(19.19)).mul(0.35));
    const blotch = float(1.0).sub(
      uniforms.blotchStrength.mul(smoothstep(0.45, 0.95, stain)),
    );

    // Warm silk tint as a multiply blend, then the weave/stain shading.
    const tint = mix(vec3(1.0), uniforms.tintColor, uniforms.tintStrength);
    const overlaid = sceneColor.rgb.mul(tint).mul(fabric).mul(blotch);

    const finalColor = mix(sceneColor.rgb, overlaid, uniforms.enabled);
    return vec4(finalColor, sceneColor.a);
  })();
}
