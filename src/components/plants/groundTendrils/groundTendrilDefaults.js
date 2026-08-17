export const GROUND_TENDRIL_HOST_PROFILES = Object.freeze({
  body: Object.freeze({ treeCount: 12, seedOffset: 0, lengthScale: 1 }),
  backpack: Object.freeze({ treeCount: 5, seedOffset: 1009, lengthScale: 0.82 }),
});

export const GROUND_TENDRIL_INTERNALS = Object.freeze({
  layoutSeed: 37,
  stemSegments: 48,
  radialSegments: 5,
  initialStagger: 0.35,
  // Only vertices this close to y=0 may seed a ground tree. If a host is
  // slightly elevated, the same band is measured from its lowest surface.
  contactBand: 0.06,
});

export const GROUND_TENDRIL_DEFAULTS = Object.freeze({
  enabled: true,
  bodyTreeCount: GROUND_TENDRIL_HOST_PROFILES.body.treeCount,
  backpackTreeCount: GROUND_TENDRIL_HOST_PROFILES.backpack.treeCount,

  branchDepth: 3,
  branchesPerLevel: 2,
  trunkLength: 1.6,
  branchLengthScale: 0.64,
  branchAngleRange: [16, 44],
  curvature: 0.13,
  lengthVariation: 0.32,

  // Extra clearance above the tube touching the ground. Zero means the tube's
  // lower surface, not its centreline, sits on y=0.
  groundGap: 0,
  tendrilRadius: 0.006,
  radiusDecay: 0.7,
  tipRadiusScale: 0.48,
  baseFlare: 0.22,

  restTimeRange: [0.5, 3],
  growthTimeRange: [7, 12],
  holdTimeRange: [8, 16],
  retractTimeRange: [5, 9],

  showDebug: false,
  hideRenderedTendrils: false,
});
