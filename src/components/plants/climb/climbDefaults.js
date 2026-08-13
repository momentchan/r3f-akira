export const CLIMB_DEFAULTS = {
  enabled: true,
  region: 'all',

  // Distribution along each directed body region.
  layoutSeed: 0,
  ringSpacing: 0.075,
  spacingVariation: 0.45,

  // Independent partial-ring shape.
  curveSamples: 48,
  wrapAngleDegrees: 220,
  entryBend: 1,
  surfaceOffset: 0.003,

  // Rendered tube.
  tendrilRadius: 0.0028,

  // Each tendril grows once, then remains fully visible.
  growthTimeRange: [5, 10],
  maxStartDelay: 4,

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
