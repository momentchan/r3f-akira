import { mergeFlowerDefaults } from '../look/flowerDefaults';

export const ROSE_MATERIAL_DEFAULTS = mergeFlowerDefaults({
  petal: {
    baseColor: '#8b1e2d',
    midColor: '#c45c6a',
    tipColor: '#f3d4d8',
    shadowTint: '#6e2430',
    highlightTint: '#fff5f6',
    gradientBandStrength: 0.18,
    thresholdLow: 0.1,
    thresholdHigh: 0.28,
  },
  vein: {
    threshold: 0.5,
    coverage: 0.55,
    petalVariation: 10,
  },
  outline: {
    outlineWidth: 0.008,
    outlineColor: '#2a181c',
  },
});
