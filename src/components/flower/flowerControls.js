import { folder } from 'leva';
import * as THREE from 'three/webgpu';
import {
  FLOWER_MASK_PATH,
  FLOWER_VEIN_PATH,
  mergeFlowerDefaults,
} from './flowerDefaults';

export { FLOWER_MASK_PATH, FLOWER_VEIN_PATH };

// Build a Leva schema from a full (or partial) flower-defaults tree.
// Partial overrides are merged onto FLOWER_DEFAULTS so each flower type can
// ship its own starting look without duplicating the whole schema.
export function createFlowerControlsSchema(defaults = {}) {
  const { petal, vein, stem, outline, grain, mask } = mergeFlowerDefaults(defaults);

  return {
    Petal: folder({
      Gradient: folder({
        baseColor: { value: petal.baseColor },
        midColor: { value: petal.midColor },
        tipColor: { value: petal.tipColor },
        gradientLevels: { value: petal.gradientLevels, min: 2, max: 6, step: 1 },
        gradientBandStrength: {
          value: petal.gradientBandStrength,
          min: 0,
          max: 1,
          step: 0.01,
        },
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
      veinThreshold: { value: vein.threshold, min: 0, max: 1, step: 0.01, label: 'threshold' },
      veinDistortion: { value: vein.distortion, min: 0, max: 0.06, step: 0.001, label: 'distortion' },
      veinDistortionScale: { value: vein.distortionScale, min: 0.5, max: 100, step: 0.5, label: 'distortScale' },
      veinCoverage: { value: vein.coverage, min: 0, max: 1, step: 0.01, label: 'coverage' },
      veinCoverageScale: { value: vein.coverageScale, min: 0.5, max: 200, step: 0.5, label: 'coverageScale' },
      veinPetalVariation: {
        value: vein.petalVariation,
        min: 0,
        max: 20,
        step: 0.01,
        label: 'petalVariation',
      },
    }),
    Stem: folder({
      stemColorLevels: { value: stem.colorLevels, min: 2, max: 6, step: 1, label: 'colorLevels' },
      stemThresholdLow: { value: stem.thresholdLow, min: 0, max: 1, step: 0.01, label: 'thresholdLow' },
      stemThresholdHigh: { value: stem.thresholdHigh, min: 0, max: 1, step: 0.01, label: 'thresholdHigh' },
      stemShadowColor: { value: stem.shadowColor, label: 'shadowColor' },
      stemHighlightColor: { value: stem.highlightColor, label: 'highlightColor' },
      stemEdgeColor: { value: stem.edgeColor, label: 'edgeColor' },
      stemEdgeThreshold: { value: stem.edgeThreshold, min: 0, max: 1, step: 0.01, label: 'edgeThreshold' },
      stemEdgeSoftness: { value: stem.edgeSoftness, min: 0, max: 0.5, step: 0.005, label: 'edgeSoftness' },
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
  const { fillMaterial } = materials;

  petal.colorLevels.value = controls.colorLevels;
  petal.gradientLevels.value = controls.gradientLevels;
  petal.gradientBandStrength.value = controls.gradientBandStrength;
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
  vein.threshold.value = controls.veinThreshold;
  vein.distortion.value = controls.veinDistortion;
  vein.distortionScale.value = controls.veinDistortionScale;
  vein.coverage.value = controls.veinCoverage;
  vein.coverageScale.value = controls.veinCoverageScale;
  vein.petalVariation.value = controls.veinPetalVariation;

  stem.colorLevels.value = controls.stemColorLevels;
  stem.thresholdLow.value = controls.stemThresholdLow;
  stem.thresholdHigh.value = controls.stemThresholdHigh;
  stem.shadowColor.value.set(controls.stemShadowColor);
  stem.highlightColor.value.set(controls.stemHighlightColor);
  stem.edgeColor.value.set(controls.stemEdgeColor);
  stem.edgeThreshold.value = controls.stemEdgeThreshold;
  stem.edgeSoftness.value = controls.stemEdgeSoftness;

  maskUniforms.threshold.value = controls.threshold;
  maskUniforms.edgeWidth.value = controls.edgeWidth;

  if (fillMaterial) {
    fillMaterial.alphaTest = controls.threshold;
  }

  outlineUniforms.outlineWidth.value = controls.outlineWidth;
  outlineUniforms.outlineColor.value.set(controls.outlineColor);

  flowerUniforms.grain.scale.value = controls.grainScale;
  flowerUniforms.grain.strength.value = controls.grainStrength;
}
