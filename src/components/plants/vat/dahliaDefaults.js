import { mergeFlowerDefaults } from '../look/flowerDefaults';

export const DAHLIA_MATERIAL_DEFAULTS = mergeFlowerDefaults({
  flowerSize: 4.2,
  colorVariation: {
    hueRange: 0.25,
    lightRange: 0.05,
  },
  mask: {
    edgeWidth: 0.002,
  },
});
