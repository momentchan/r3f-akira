import { mergeFlowerDefaults } from '../look/flowerDefaults';

export const PLUMERA_MATERIAL_DEFAULTS = mergeFlowerDefaults({
  // The open VAT pose is about two-thirds the diameter of Jasmine.
  flowerSize: 1.8,
  petal: {
    baseColor: '#f1dfaa',
    midColor: '#fff3cf',
    tipColor: '#fffdf2',
    shadowTint: '#c8c1ae',
    highlightTint: '#ffffff',
    gradientBandStrength: 0.12,
    thresholdLow: 0.14,
    thresholdHigh: 0.32,
    // Was 0.5 — the slider maximum — which randomized every instance across the
    // whole hue wheel, so the body flowers never read as one cream species. The
    // base palette is already the colour we want; this only needs enough drift to
    // stop them looking stamped.
    hueRange: 0.03,
    lightRange: 0.035,
  },
  vein: {
    coverage: 0.14,
    petalVariation: 5,
  },
  mask: {
    threshold: 0.3,
    edgeWidth: 1.5,
    edgeColor: '#26363d',
  },
});
