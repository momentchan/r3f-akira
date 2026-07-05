export const FLOWER_MASK_PATH = '/textures/blackanedwthioe.png';
export const FLOWER_VEIN_PATH = '/textures/tujlip-veins.png';

export const FLOWER_DEFAULTS = {
  petal: {
    colorLevels: 2,
    rimStrength: 0.1,
    rimThreshold: 0.74,
    rimPower: 2.6,
    thresholdLow: 0.22,
    thresholdHigh: 0.58,
    thresholdNoiseScale: 28,
    thresholdNoiseStrength: 0.06,
    shadowTint: '#a88ddb',
    highlightTint: '#ffd0e8',
    baseColor: '#3d2868',
    midColor: '#fe9ede',
    tipColor: '#ffffff',
  },
  vein: {
    scale: 1,
    rotation: 0,
    threshold: 0.5,
  },
  stem: {
    colorLevels: 2,
    rimStrength: 0.06,
    rimThreshold: 0.78,
    rimPower: 2.2,
    thresholdLow: 0.28,
    thresholdHigh: 0.62,
    thresholdNoiseScale: 18,
    thresholdNoiseStrength: 0.04,
    shadowColor: '#33474f',
    highlightColor: '#4c6873',
    edgeColor: '#1c2a31',
    edgeThreshold: 0.32,
    edgeSoftness: 0.08,
  },
  mask: {
    threshold: 0.24,
    edgeWidth: 0.00,
  },
  outline: {
    outlineWidth: 0.01,
    outlineColor: '#961313',
  },
  grain: {
    scale: 480,
    strength: 0.11,
  },
};
