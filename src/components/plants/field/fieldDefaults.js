export const FIELD_DEFAULTS = {
  arrangement: {
    // Enough blooms to read as a loose band, while preserving open ground.
    count: 80,
    spreadRadius: 2.8,
    minGap: 0.14,
    leanOut: 1.0,
    // Fan stems across both sides of a ground route instead of tracing one line.
    flowerBandSpread: 0.78,
    clusterShare: 0.75,
    arrangementSeed: 0,
    positionJitter: 0.1,
    roseRatio: 0.45,
    reshuffleOnRespawn: true,
    slotFactor: 3,
  },
  /** Keep flowers off the body via MeshBVH closest-point distance. */
  surround: {
    enabled: true,
    /** MeshBVHHelper is the costly bit - off by default. */
    showDebug: false,
    /** Min distance from posed mesh surface to a stem base. */
    clearMargin: 0.12,
    /** Quiet pocket around head/helmet (field units, XZ). */
    faceClearRadius: 0.38,
    /** Higher values pack more stems into the near-body band. */
    contactPow: 1.65,
    /** Near-body bloom scale vs outer; 1 means no size hierarchy. */
    nearSizeMin: 0.62,
    /** Draw face/contact/rim guides (independent of BVH helper). */
    showCompositionDebug: false,
    /** MeshBVHHelper display depth when showDebug is on (keep low). */
    bvhDepth: 8,
  },
  lifecycle: {
    phaseSpread: 1,
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
