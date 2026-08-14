export const CLIMB_DEFAULTS = {
  enabled: true,
  region: 'all',

  // Distribution along each directed body region.
  layoutSeed: 0,
  tendrilCount: 256,
  spacingVariation: 1,

  // Independent partial-ring shape.
  curveSamples: 48,
  wrapAngleRange: [90, 150],
  axialWeave: 1,
  entryBend: 1,
  surfaceOffset: 0.02,

  // Rendered tube.
  tendrilRadius: 0.005,
  radiusAttenuation: 0.11,
  baseFlare: 0.3,

  // Shared spatial field; nearby tendrils receive related X/Z displacement.
  noiseAmount: 0.03,
  noiseFrequency: 8.4,
  noiseSeed: 0,

  // Slow coherent flex around the baked noisy curve.
  motionAmount: 0.03,
  motionFrequency: 2.5,
  motionSpeed: 0.5,

  // Leaves grow from the same packed lifecycle as their tendril.
  leafCount: 2,
  leafSpan: [0.35, 0.7],
  leafScale: 0.06,
  leafScaleVariation: 0.35,
  leafDroop: 0,
  leafCurl: 0.5,
  leafCurlVariation: 0.3,
  leafColorLevels: 3,

  // Continuous lifecycle. A long hold keeps body coverage while individuals renew.
  restTimeRange: [2, 8],
  growthTimeRange: [5, 10],
  holdTimeRange: [5, 10],
  retractTimeRange: [4, 8],
  initialPhaseSpread: 0,

  debug: {
    showDebug: false,
    showPaths: true,
    showSeeds: true,
    showCapsules: false,
    showCapsuleLabels: false,
    showDiagnostics: false,
    pathCount: 96,
  },
};
