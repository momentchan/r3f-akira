export const FLOWER_MASK_PATH = '/textures/blackanedwthioe.png';
export const FLOWER_VEIN_PATH = '/textures/tujlip-veins.png';
export const ROSE_MASK_PATH = '/textures/rose-mask.png';

export const FLOWER_DEFAULTS = {
  petal: {
    colorLevels: 2,
    gradientLevels: 3,
    gradientBandStrength: 0.1,
    rimStrength: 0,
    rimThreshold: 0.74,
    rimPower: 2.6,
    thresholdLow: 0.12,
    thresholdHigh: 0.3,
    thresholdNoiseScale: 28,
    thresholdNoiseStrength: 0.02,
    shadowTint: '#c3b2dd',
    highlightTint: '#fdfbff',
    baseColor: '#884beb',
    midColor: '#c9a8e8',
    tipColor: '#eee4f2',
    // Final petal grade: 0 = grayscale, 1 = unchanged, >1 boosts chroma.
    saturation: 1,
  },
  vein: {
    scale: 1,
    rotation: 0,
    threshold: 0.45,
    distortion: 0.012,
    distortionScale: 40,
    coverage: 0.4,
    coverageScale: 13,
    petalVariation: 15,
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
    // Shared woodblock ink for mask rim and vein strokes.
    edgeColor: '#3a2a33',
  },
  colorVariation: {
    hueRange: 0.04,
    lightRange: 0.05,
  },
};

export function mergeFlowerDefaults(overrides = {}, base = FLOWER_DEFAULTS) {
  const merged = { ...base };
  for (const key of Object.keys(overrides)) {
    const value = overrides[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = { ...(base[key] ?? {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
