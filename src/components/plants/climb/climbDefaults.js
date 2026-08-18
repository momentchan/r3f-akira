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
  leafScaleVariation: 0.35,
  leafCurlVariation: 0.3,
  leafColorLevels: 3,
  diagnosticMode: 'all',
  showClearanceMarkers: true,
});

export const CLIMB_DEFAULTS = {
  enabled: true,

  // Distribution along each directed body region.
  // Cut from 256: the body-contact layer is meant to read as a few fine tendrils,
  // not as coverage. Note the built count is `tendrilCount * routePoolFactor`
  // clamped to MAX_TOTAL_TENDRILS, and only ~tendrilCount are awake at a time.
  tendrilCount: 180,
  // Relative helmet allocation: 0 = none, 1 = unmodified surface density.
  headDensity: 0.1,
  // Extra dormant routes built per visible wrap, so a regrown tree can appear
  // somewhere new instead of retracing the same path forever.
  routePoolFactor: 2,
  reshuffleRoutes: true,

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

  // Leaves grow from the same packed lifecycle as their tendril.
  leafCount: 2,
  leafSpan: [0.35, 0.7],
  leafScale: 0.06,
  leafDroop: 0,
  leafCurl: 0.5,

  // Flowers attach at stable random positions along wrapping segments.
  // Cut from 0.18, which allocated ~92 instances and put 30-60 on the body at
  // once. Combined with the tendrilCount cut this lands nearer 10-18 visible —
  // "a small amount of small white flowers" rather than a flowering suit.
  flowerDensity: 0.08,
  flowerSpan: [0.25, 0.82],
  flowerNormalVariation: 10,

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
