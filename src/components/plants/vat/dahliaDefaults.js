import { mergeFlowerDefaults } from '../look/flowerDefaults';

export const DAHLIA_MATERIAL_DEFAULTS = mergeFlowerDefaults({
  flowerSize: 4.8,
  petal: {
    hueRange: 0.25,
    lightRange: 0.05,
  },
  mask: {
    edgeWidth: 2,
  },
});
