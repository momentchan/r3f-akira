import { mergeFlowerDefaults } from '../look/flowerDefaults';

export const ROSE_MATERIAL_DEFAULTS = mergeFlowerDefaults({
  flowerSize: 2.2,
  petal: {
    baseColor: '#c7c7c7',
    midColor: '#e2e2e2',
    tipColor: '#ffffff',
    shadowTint: '#e8e8e8',
    highlightTint: '#ffffff',
    gradientBandStrength: 0.14,
    thresholdLow: 0.1,
    thresholdHigh: 0.28,
  },
  colorVariation: {
    hueRange: 0.02,
    lightRange: 0.04,
  },
  vein: {
    threshold: 0.5,
    coverage: 0.55,
    petalVariation: 10,
  },
  mask: {
    threshold: 0.22,
    edgeWidth: 0.002,
    edgeColor: '#2a181c',
  },

});
