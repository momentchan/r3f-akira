export const SILK_WEAVE_DEFAULTS = {
  enabled: true,
  // Number of thread rows across the screen height.
  threadCount: 815,
  // How dark the grooves between threads get.
  strength: 0.35,
  // <1 = wide soft threads, >1 = thin sharp threads.
  sharpness: 0.6,
  // Per-thread brightness randomness.
  threadVariation: 0.18,
  // Phase jitter so the grid doesn't look machine-perfect.
  irregularity: 0.35,
  // Aged silk / paper tint (multiply blend).
  tintColor: '#e9dcbf',
  tintStrength: 0.35,
  // Low-frequency stain mottling.
  blotchScale: 6,
  blotchStrength: 0.22,
};
