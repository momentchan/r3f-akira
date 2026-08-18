export const GROUND_TENDRIL_HOST_PROFILES = Object.freeze({
  body: Object.freeze({
    treeCount: 4,
    shortTreeCount: 6,
    heroTreeCount: 3,
    visibleNearbyTreeCount: 4,
    seedOffset: 0,
    lengthScale: 1,
    directionOffset: 0,
  }),
  backpack: Object.freeze({
    treeCount: 3,
    shortTreeCount: 4,
    heroTreeCount: 2,
    visibleNearbyTreeCount: 3,
    seedOffset: 1009,
    lengthScale: 0.82,
    directionOffset: 28,
  }),
});

export const GROUND_TENDRIL_INTERNALS = Object.freeze({
  layoutSeed: 37,
  generationSeedStep: 7919,
  initialStartSpread: 28,
  groundFlowerScale: 1.28,
  stemSegments: 48,
  radialSegments: 5,
  windResponse: 0.04,
  initialStagger: 0,
  shortTreeBranchDepth: 1,
  shortTreeDirectionSpread: 300,
  shortTreeSeedOffset: 5003,
  // Only vertices this close to y=0 may seed a ground tree. If a host is
  // slightly elevated, the same band is measured from its lowest surface.
  contactBand: 0.06,
});

export const GROUND_TENDRIL_DEFAULTS = Object.freeze({
  enabled: true,
  bodyTreeCount: GROUND_TENDRIL_HOST_PROFILES.body.treeCount,
  backpackTreeCount: GROUND_TENDRIL_HOST_PROFILES.backpack.treeCount,
  bodyShortTreeCount: GROUND_TENDRIL_HOST_PROFILES.body.shortTreeCount,
  backpackShortTreeCount: GROUND_TENDRIL_HOST_PROFILES.backpack.shortTreeCount,
  shortTreeLengthScale: 0.34,

  branchDepth: 3,
  branchesPerLevel: 2,
  trunkLength: 1.85,
  branchLengthScale: 0.58,
  branchAngleRange: [14, 36],

  // Short side shoots off the drawn traces. These exist so flowers have
  // somewhere to sit other than the main line — a flower rooted directly on a
  // trunk reads as threaded onto a guide curve, however much its crown leans.
  // The angle range is deliberately far wider than `branchAngleRange`: a shoot
  // must visibly leave its parent to do its job.
  shootsPerPath: 2,
  // Verified against a close crop: at 0.18 a shoot off a short nearby trunk is
  // only ~0.11 units and the flower still reads as sitting on the trunk. A shoot
  // has to be long enough to carry its flower clear of the parent line.
  shootLengthScale: 0.34,
  shootAngleRange: [52, 84],
  curvature: 0.16,
  lengthVariation: 0.28,

  // A partial directional fan creates intentional negative space. Backpack
  // adds its profile offset so both hosts participate without forming spokes.
  directionCenter: -25,
  directionSpread: 170,

  // Extra clearance above the tube touching the ground. Zero means the tube's
  // lower surface, not its centreline, sits on y=0.
  groundGap: 0,
  tendrilRadius: 0.011,
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
