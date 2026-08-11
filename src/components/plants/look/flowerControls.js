import { folder } from 'leva';
import * as THREE from 'three/webgpu';
import {
  FLOWER_MASK_PATH,
  FLOWER_VEIN_PATH,
  mergeFlowerDefaults,
} from './flowerDefaults';

export { FLOWER_MASK_PATH, FLOWER_VEIN_PATH, ROSE_MASK_PATH } from './flowerDefaults';

export function createFlowerControlsSchema(defaults = {}) {
  const { petal, vein, mask, colorVariation, flowerSize } = mergeFlowerDefaults(defaults);

  return {
    flowerSize: {
      value: flowerSize,
      min: 0,
      max: 20,
      step: 0.1,
      label: 'flower / radius',
    },
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
      saturation: { value: petal.saturation ?? 1, min: 0, max: 2, step: 0.01 },
    }),
    'Color Variation': folder({
      hueRange: { value: colorVariation.hueRange, min: 0, max: 0.5, step: 0.005, label: 'hue ±' },
      lightRange: { value: colorVariation.lightRange, min: 0, max: 0.3, step: 0.005, label: 'light ±' },
    }, { collapsed: true }),
    VeinTexture: folder({
      scale: { value: vein.scale, min: 0.1, max: 4, step: 0.01 },
      rotation: { value: vein.rotation, min: 0, max: 3.14, step: 0.01 },
      veinThreshold: { value: vein.threshold, min: 0, max: 1, step: 0.01, label: 'threshold' },
      veinStrokeWidth: {
        value: vein.strokeWidth ?? 2,
        min: 0,
        max: 6,
        step: 0.05,
        label: 'stroke (screenspace)',
      },
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
    Mask: folder({
      threshold: { value: mask.threshold, min: 0, max: 1, step: 0.01 },
      edgeWidth: { value: mask.edgeWidth, min: 0, max: 6, step: 0.05, label: 'edge (screenspace)' },
      edgeColor: { value: mask.edgeColor },
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
  materials = {},
) {
  const { petal, vein } = flowerUniforms;
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
  petal.saturation.value = controls.saturation;

  vein.scale.value = controls.scale;
  vein.rotation.value = controls.rotation;
  vein.threshold.value = controls.veinThreshold;
  vein.strokeWidth.value = controls.veinStrokeWidth;
  vein.distortion.value = controls.veinDistortion;
  vein.distortionScale.value = controls.veinDistortionScale;
  vein.coverage.value = controls.veinCoverage;
  vein.coverageScale.value = controls.veinCoverageScale;
  vein.petalVariation.value = controls.veinPetalVariation;

  // Stem look is owned by the top-level Stem panel (syncStemLookControls).

  maskUniforms.threshold.value = controls.threshold;
  maskUniforms.edgeWidth.value = controls.edgeWidth;
  maskUniforms.edgeColor.value.set(controls.edgeColor);

  if (fillMaterial) {
    fillMaterial.alphaTest = controls.threshold;
  }
}
