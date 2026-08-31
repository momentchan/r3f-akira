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
 * Fullscreen silk weave: warp/weft threads, warm tint, and stain blotches
 * multiplied over a scene pass.
 */
export function createSilkWeaveNode(inputNode, uniforms, preview = 'final') {
  return Fn(() => {
    const sceneColor = vec4(inputNode).toVar();
    const rgb = sceneColor.rgb.toVar();

    // Thread grid
    const aspect = screenSize.x.div(screenSize.y);
    const coord = screenUV.mul(vec2(aspect, 1.0)).mul(uniforms.threadCount).toVar();
    const rowJitter = hash(floor(coord.y).add(13.7)).sub(0.5).mul(uniforms.irregularity);
    const colJitter = hash(floor(coord.x).add(91.3)).sub(0.5).mul(uniforms.irregularity);
    const x = coord.x.add(rowJitter).toVar();
    const y = coord.y.add(colJitter).toVar();

    // Warp / weft
    const warp = pow(abs(sin(x.mul(PI))), uniforms.sharpness).toVar();
    const weft = pow(abs(sin(y.mul(PI))), uniforms.sharpness).toVar();
    const col = floor(x).toVar();
    const row = floor(y).toVar();
    const checker = mod(col.add(row), 2.0);
    const weave = mix(warp, weft, checker).toVar();

    // Fabric: same dimming on any thread field (strength + per-fiber tone).
    const threadTone = mix(hash(col.mul(7.77)), hash(row.mul(3.33)), checker)
      .sub(0.5)
      .mul(uniforms.threadVariation);
    const asCloth = (thread) =>
      clamp(
        float(1.0).sub(uniforms.strength.mul(float(1.0).sub(thread))).add(threadTone),
        0.0,
        1.0,
      );
    const warpCloth = asCloth(warp).toVar();
    const weftCloth = asCloth(weft).toVar();
    const fabric = asCloth(weave).toVar();

    // Stains
    const stainUV = screenUV.mul(vec2(aspect, 1.0)).mul(uniforms.blotchScale);
    const stain = valueNoise2(stainUV)
      .mul(0.65)
      .add(valueNoise2(stainUV.mul(2.7).add(19.19)).mul(0.35));
    const blotch = float(1.0)
      .sub(uniforms.blotchStrength.mul(smoothstep(0.45, 0.95, stain)))
      .toVar();

    // Tint and composite: stain the cloth, then tint that pair.
    const tint = mix(vec3(1.0), uniforms.tintColor, uniforms.tintStrength).toVar();
    const stainedFabric = fabric.mul(blotch).toVar();
    const overlay = tint.mul(stainedFabric).toVar();
    const overlaid = rgb.mul(overlay);
    const finalColor = mix(rgb, overlaid, uniforms.enabled);

    // Keep the scene in every debug view. Warp/weft/fabric are cloth-softened.
    if (preview === 'warp') return vec4(rgb.mul(warpCloth), sceneColor.a);
    if (preview === 'weft') return vec4(rgb.mul(weftCloth), sceneColor.a);
    if (preview === 'fabric') return vec4(rgb.mul(fabric), sceneColor.a);
    if (preview === 'blotch') return vec4(rgb.mul(stainedFabric), sceneColor.a);
    return vec4(finalColor, sceneColor.a);
  })();
}
