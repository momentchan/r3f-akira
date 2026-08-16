import { mergeFlowerDefaults } from '../look/flowerDefaults';

export const JASMINE_MATERIAL_DEFAULTS = mergeFlowerDefaults({
  flowerSize: 1.2,
  petal: {
    baseColor: '#d9e0d8',
    midColor: '#f1f1e8',
    tipColor: '#fffdf1',
    shadowTint: '#bac8c4',
    highlightTint: '#ffffff',
    gradientBandStrength: 0.12,
    thresholdLow: 0.14,
    thresholdHigh: 0.32,
  },
  colorVariation: {
    hueRange: 0.025,
    lightRange: 0.035,
  },
  vein: {
    coverage: 0.18,
    petalVariation: 6,
  },
  mask: {
    threshold: 0.3,
    edgeWidth: 1.5,
    edgeColor: '#26363d',
  },
});
