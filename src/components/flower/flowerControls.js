import { folder } from 'leva';
import * as THREE from 'three/webgpu';
import { FLOWER_DEFAULTS, FLOWER_MASK_PATH, FLOWER_VEIN_PATH } from './flowerDefaults';

export { FLOWER_MASK_PATH, FLOWER_VEIN_PATH };

export function createFlowerControlsSchema(options = {}) {
  const { petal, vein, stem, outline, grain } = FLOWER_DEFAULTS;
  const mask = { ...FLOWER_DEFAULTS.mask, ...options.mask };

  return {
    Petal: folder({
      Gradient: folder({
        baseColor: { value: petal.baseColor },
        midColor: { value: petal.midColor },
        tipColor: { value: petal.tipColor },
      }),
      Rim: folder({
        rimStrength: { value: petal.rimStrength, min: 0, max: 0.5, step: 0.005 },
        rimThreshold: { value: petal.rimThreshold, min: 0, max: 1, step: 0.01 },
        rimPower: { value: petal.rimPower, min: 0.5, max: 8, step: 0.1 },
      }),
      colorLevels: { value: petal.colorLevels, min: 2, max: 8, step: 1 },
      thresholdLow: { value: petal.thresholdLow, min: 0, max: 1, step: 0.01 },
      thresholdHigh: { value: petal.thresholdHigh, min: 0, max: 1, step: 0.01 },
      thresholdNoiseScale: { value: petal.thresholdNoiseScale, min: 0.1, max: 240, step: 0.1 },
      thresholdNoiseStrength: {
        value: petal.thresholdNoiseStrength,
        min: 0,
        max: 0.35,
        step: 0.005,
      },
      shadowTint: { value: petal.shadowTint },
      highlightTint: { value: petal.highlightTint },
    }),
    VeinTexture: folder({
      scale: { value: vein.scale, min: 0.1, max: 4, step: 0.01 },
      rotation: { value: vein.rotation, min: 0, max: 3.14, step: 0.01 },
      threshold: { value: vein.threshold, min: 0, max: 1, step: 0.01 },
    }),
    Stem: folder({
      stemColorLevels: { value: stem.colorLevels, min: 2, max: 6, step: 1, label: 'colorLevels' },
      stemThresholdLow: { value: stem.thresholdLow, min: 0, max: 1, step: 0.01, label: 'thresholdLow' },
      stemThresholdHigh: { value: stem.thresholdHigh, min: 0, max: 1, step: 0.01, label: 'thresholdHigh' },
      stemShadowColor: { value: stem.shadowColor, label: 'shadowColor' },
      stemHighlightColor: { value: stem.highlightColor, label: 'highlightColor' },
    }),
    Mask: folder({
      threshold: { value: mask.threshold, min: 0, max: 1, step: 0.01 },
      edgeWidth: { value: mask.edgeWidth, min: 0.00, max: 0.002, step: 0.0001 },
    }),
    Outline: folder({
      outlineWidth: { value: outline.outlineWidth, min: 0, max: 0.08, step: 0.001 },
      outlineColor: { value: outline.outlineColor },
    }),
    Grain: folder({
      grainScale: { value: grain.scale, min: 50, max: 1200, step: 1, label: 'scale' },
      grainStrength: { value: grain.strength, min: 0, max: 0.35, step: 0.005, label: 'strength' },
    }),
  };
}

export function configureFlowerTexture(texture) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export function syncFlowerControls(
  controls,
  flowerUniforms,
  maskUniforms,
  outlineUniforms,
  materials = {},
) {
  const { petal, stem, vein } = flowerUniforms;
  const { fillMaterial, outlineMaterial } = materials;

  petal.colorLevels.value = controls.colorLevels;
  petal.rimStrength.value = controls.rimStrength;
  petal.rimThreshold.value = controls.rimThreshold;
  petal.rimPower.value = controls.rimPower;
  petal.thresholdLow.value = controls.thresholdLow;
  petal.thresholdHigh.value = controls.thresholdHigh;
  petal.thresholdNoiseScale.value = controls.thresholdNoiseScale;
  petal.thresholdNoiseStrength.value = controls.thresholdNoiseStrength;
  petal.shadowTint.value.set(controls.shadowTint);
  petal.highlightTint.value.set(controls.highlightTint);
  petal.baseColor.value.set(controls.baseColor);
  petal.midColor.value.set(controls.midColor);
  petal.tipColor.value.set(controls.tipColor);

  vein.scale.value = controls.scale;
  vein.rotation.value = controls.rotation;
  vein.threshold.value = controls.threshold;

  stem.colorLevels.value = controls.stemColorLevels;
  stem.thresholdLow.value = controls.stemThresholdLow;
  stem.thresholdHigh.value = controls.stemThresholdHigh;
  stem.shadowColor.value.set(controls.stemShadowColor);
  stem.highlightColor.value.set(controls.stemHighlightColor);

  maskUniforms.threshold.value = controls.threshold;
  maskUniforms.edgeWidth.value = controls.edgeWidth;

  if (fillMaterial) {
    fillMaterial.alphaTest = controls.threshold;
  }
  if (outlineMaterial) {
    outlineMaterial.alphaTest = controls.threshold;
  }

  outlineUniforms.outlineWidth.value = controls.outlineWidth;
  outlineUniforms.outlineColor.value.set(controls.outlineColor);

  flowerUniforms.grain.scale.value = controls.grainScale;
  flowerUniforms.grain.strength.value = controls.grainStrength;
}
