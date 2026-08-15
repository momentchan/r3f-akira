/**
 * Every climb target uses the same geometry/routing pipeline. Profiles only
 * tune how the shared tendril budget and shape settings apply to each host.
 */
export const CLIMB_HOST_PROFILES = Object.freeze({
  body: Object.freeze({
    countShare: 0.9,
    layoutSeedOffset: 0,
    wrapAngleScale: 1,
    surfaceOffsetScale: 1,
  }),
  backpack: Object.freeze({
    countShare: 0.1,
    layoutSeedOffset: 1009,
    wrapAngleScale: 1,
    surfaceOffsetScale: 1,
  }),
});

/** Stable implementation details that do not need art-direction controls. */
export const CLIMB_INTERNALS = Object.freeze({
  layoutSeed: 0,
  curveSamples: 48,
  spacingVariation: 1,
  entryBend: 1,
  motionFrequency: 2.5,
  leafScaleVariation: 0.35,
  leafCurlVariation: 0.3,
  leafColorLevels: 3,
  diagnosticMode: 'all',
  showClearanceMarkers: true,
});

export const CLIMB_DEFAULTS = {
  enabled: true,

  // Distribution along each directed body region.
  tendrilCount: 256,
  // Relative helmet allocation: 0 = none, 1 = unmodified surface density.
  headDensity: 0.1,

  // Independent partial-ring shape.
  wrapAngleRange: [90, 150],
  axialWeave: 1,
  surfaceOffset: 0.02,

  // Rendered tube.
  tendrilRadius: 0.005,
  radiusAttenuation: 0.11,
  baseFlare: 0.3,

  // Shared spatial field; nearby tendrils receive related X/Z displacement.
  noiseAmount: 0.03,
  noiseFrequency: 8.4,

  // Slow coherent flex around the baked noisy curve.
  motionAmount: 0,
  motionSpeed: 0.5,

  // Leaves grow from the same packed lifecycle as their tendril.
  leafCount: 2,
  leafSpan: [0.35, 0.7],
  leafScale: 0.06,
  leafDroop: 0,
  leafCurl: 0.5,

  // Per-tree lifecycle: ground -> branches -> rings -> hold -> reverse to ground.
  restTimeRange: [2, 8],
  growthTimeRange: [5, 10],
  holdTimeRange: [5, 10],
  retractTimeRange: [4, 8],

  debug: {
    showDebug: false,
    showPaths: true,
    showSeeds: true,
    showCapsules: false,
    showCapsuleLabels: false,
    showDiagnostics: false,
    hideRenderedTendrils: false,
    pathCount: 96,
  },
};
