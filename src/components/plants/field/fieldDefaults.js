export const FIELD_DEFAULTS = {
  arrangement: {
    flowerCount: 150,
    leanOutward: 1.0,
    arrangementSeed: 0,
    roseRatio: 0.75,
  },
  /**
   * Anchor probability field. An anchor raises the chance of vegetation in its
   * neighbourhood; it does not mean a flower grows there.
   */
  anchors: {
    showAnchors: false,
    densityField: false,
    reachScale: 1.37,
    // Domain warp: displaces the sample position before distance is measured, so
    // the cluster SHAPE is irregular rather than a circle of varying intensity.
    shapeWarp: 1,
    warpScale: 5,
    barePatches: 0.25,
    patchScale: 1.7,
    // Dispersal. Fewer founders = fewer, tighter bouquets; a wider hop range
    // loosens each clump toward a scatter.
    founderShare: 0.14,
    hopRange: [0.2, 0.5],
    // Hearts wander; dying flowers hop around one. The probability field stays put.
    migrateRange: 0.6,
    migrateSpeed: 0.09,
  },
  /** Keep flowers off the body via MeshBVH closest-point distance. */
  surround: {
    /** BVHHelper is the costly bit — off by default. */
    bvhHelper: false,
    /** Min distance from posed mesh surface to a stem base. */
    meshClearDistance: 0.0,
    /** BVHHelper display depth when bvhHelper is on (keep low). */
    bvhHelperDepth: 8,
  },
  lifecycle: {
    initialPhaseSpread: 1,
    delay: [0.2, 1.2],
    grow: [5, 10],
    keep: [8, 12],
    die: [8, 10],
    petalShedFrac: 0.75,
    shedStemOverlap: 0.5,
  },
  petalShed: {
    shedRise: 2,
    shedRiseVariance: 0.5,
    shedSpread: 0.45, // multiplied by stem length
    shedStagger: 0.55,
  },
};

// Lifecycle windows used when a stem mounts before Field Leva is available.
export const DEFAULT_LIFECYCLE_RANGES = {
  delay: FIELD_DEFAULTS.lifecycle.delay,
  grow: FIELD_DEFAULTS.lifecycle.grow,
  keep: FIELD_DEFAULTS.lifecycle.keep,
  die: FIELD_DEFAULTS.lifecycle.die,
};
