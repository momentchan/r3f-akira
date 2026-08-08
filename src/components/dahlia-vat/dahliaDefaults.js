import { mergeFlowerDefaults } from '../flower/flowerDefaults';

// Dahlia look — purple woodblock gradient; slightly wider mask edge so thin
// petal tips don't alias against the silhouette.
export const DAHLIA_MATERIAL_DEFAULTS = mergeFlowerDefaults({
  mask: {
    edgeWidth: 0.001,
  },
});
