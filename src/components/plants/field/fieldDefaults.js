export const FIELD_DEFAULTS = {
  arrangement: {
    // Fewer stems = readable arcs across the suit (not wire noise).
    // NOTE: this count was inflated to offset the old migration gate, which left
    // ~45% of plants dormant. The gate is gone — built count now equals visible
    // count, and live slots pack into the true field instead of the wider
    // envelope — so it is very likely too high and wants retuning downward. Held
    // at 256 deliberately until that retune is judged as a visual change.
    flowerCount: 256,
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
    reachScale: 1.7,
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
    // Scene-wide, NOT per anchor. One focal flower per cluster averages the image
    // back out to uniform.
    primaryCount: 4,
    // Migration: hearts wander on their own clock. A dying flower picks among
    // them weighted by live density × distance, then hops. Occupancy follows
    // the field; live plants are never touched.
    migrateRange: 0.2,
    migrateSpeed: 0.035,
  },
  /** Keep flowers off the body via MeshBVH closest-point distance. */
  surround: {
    clearBody: true,
    /** MeshBVHHelper is the costly bit - off by default. */
    bvhHelper: false,
    /** Min distance from posed mesh surface to a stem base. */
    meshClearDistance: 0.08,
    /** Quiet pocket around head/helmet (field units, XZ). */
    faceClearRadius: 0.2,
    /** MeshBVHHelper display depth when bvhHelper is on (keep low). */
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
