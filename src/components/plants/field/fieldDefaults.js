export const FIELD_DEFAULTS = {
  arrangement: {
    // Fewer stems = readable arcs across the suit (not wire noise).
    // NOTE: 230 was chosen to offset the old migration gate, which left ~45% of
    // plants dormant. The gate is gone — built count now equals visible count, and
    // live slots pack into the true field instead of the wider envelope — so this
    // is very likely too high and wants retuning downward.
    flowerCount: 230,
    sizeRampRadius: 2.8,
    leanOutward: 1.0,
    arrangementSeed: 0,
    roseRatio: 0.7,
    reshuffleOnRespawn: true,
    // Down from 3 while count went up. Cluster-aware respawn made a large spare
    // pool much less valuable, and pool size is the most expensive thing in the
    // layout pass.
    spareSlots: 2,
  },
  /**
   * Anchor probability field. An anchor raises the chance of vegetation in its
   * neighbourhood; it does not mean a flower grows there.
   */
  anchors: {
    showAnchors: false,
    densityField: false,
    reachScale: 1,
    edgeRagged: 0.35,
    edgeScale: 2.6,
    // Domain warp: displaces the sample position before distance is measured, so
    // the cluster SHAPE is irregular rather than a circle of varying intensity.
    shapeWarp: 0.3,
    warpScale: 1.6,
    // Shared bare patches punched through every cluster, which is what stops an
    // annulus reading as a closed ring around the body.
    // Lowered from 0.4: the mask is a FIXED noise field, so a high cut leaves large
    // contiguous holes rather than scattered clearings. 0.2 keeps the clearings
    // without punching out whole regions.
    barePatches: 0.2,
    patchScale: 1.1,
    // Dispersal. Fewer founders = fewer, tighter bouquets; a wider hop range
    // loosens each clump toward a scatter.
    founderShare: 0.14,
    hopRange: [0.07, 0.2],
    // Scene-wide, NOT per anchor. One focal flower per cluster averages the image
    // back out to uniform.
    primaryCount: 4,
    // Migration: the cluster centres wander, and each plant that FINISHES its
    // cycle is re-placed weighted by where the field has drifted to. Live plants
    // are never touched, so a clump creeps over a few generations instead of
    // fading in and out, and every flower gets a complete lifecycle.
    migrateRange: 0.45,
    migrateSpeed: 0.035,
    regrowFloor: 0.12,
  },
  /** Keep flowers off the body via MeshBVH closest-point distance. */
  surround: {
    clearBody: true,
    /** MeshBVHHelper is the costly bit - off by default. */
    bvhHelper: false,
    /** Min distance from posed mesh surface to a stem base. */
    meshClearDistance: 0.12,
    /** Quiet pocket around head/helmet (field units, XZ). */
    faceClearRadius: 0.38,
    /** Near-body bloom scale vs outer; 1 means no size hierarchy. */
    nearBloomScale: 0.62,
    /** Draw face/contact/rim guides (independent of BVH helper). */
    compositionGuides: false,
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
