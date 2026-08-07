export const FLOWER_MASK_PATH = '/textures/blackanedwthioe.png';
export const FLOWER_VEIN_PATH = '/textures/tujlip-veins.png';

export const FLOWER_DEFAULTS = {
  petal: {
    colorLevels: 2,
    gradientLevels: 3,
    gradientBandStrength: 0.1,
    rimStrength: 0,
    rimThreshold: 0.74,
    rimPower: 2.6,
    // Keep the lit/shadow step subtle: form should come from the posterized
    // gradient, not from big lighting blobs crossing petal silhouettes.
    thresholdLow: 0.12,
    thresholdHigh: 0.3,
    thresholdNoiseScale: 28,
    thresholdNoiseStrength: 0.02,
    shadowTint: '#c3b2dd',
    highlightTint: '#fdfbff',
    baseColor: '#884beb',
    midColor: '#c9a8e8',
    tipColor: '#eee4f2',
  },
  vein: {
    scale: 1,
    rotation: 0,
    // Lower threshold keeps more of the texture's stroke detail; the
    // coverage mask below handles thinning it out organically.
    threshold: 0.45,
    // UV wobble applied to the vein lookup (strength / noise frequency).
    distortion: 0.012,
    distortionScale: 40,
    // Fraction of strokes visible; noise patches fade the rest out.
    coverage: 0.4,
    coverageScale: 13,
    // How much vertex color G (petal_id) offsets distortion and coverage noise.
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
  },
  outline: {
    outlineWidth: 0.01,
    // Unified ink for outlines and veins (woodblock style). Set back to a
    // red like #961313 for the red-edge accent look.
    outlineColor: '#3a2a33',
  },
  grain: {
    scale: 480,
    strength: 0.11,
  },
};
