export const STEM_RANGES = {
  stemLength: { min: 0.05, max: 2 },
  stemRadius: { min: 0.002, max: 0.06 },
  leanAngle: { min: 0, max: 45 },
  bendDegree: { min: 0, max: 0.35 },
  radiusAttenuation: { min: 0, max: 1 },
  baseFlare: { min: 0, max: 1 },
};

export const FIELD_DEFAULTS = {
  arrangement: {
    count: 28,
    spreadRadius: 2.1,
    minGap: 0.12,
    leanOut: 0.85,
    phaseSpread: 1,
    arrangementSeed: 0,
    positionJitter: 0.35,
    roseOuterBias: 0.75,
  },
  /** Keep flowers off the body via MeshBVH closest-point distance. */
  surround: {
    enabled: true,
    /** MeshBVHHelper is the costly bit — off by default. */
    showDebug: false,
    /** Min distance from posed mesh surface to a stem base. */
    clearMargin: 0.12,
    /** BVHHelper display depth when showDebug is on (keep low). */
    bvhDepth: 8,
  },
  stemGeometry: {
    stemLength: [0.7, 1.32],
    stemRadius: [0.006, 0.02],
    leanAngle: [2, 25],
    bendDegree: [0.05, 0.25],
    radiusAttenuation: [0.3, 0.7],
    baseFlare: [0.1, 0.4],
    stemSegments: 32,
    radialSegs: 8,
    bloomStart: 0.23,
    bloomFrac: 0.3,
  },
  lifecycle: {
    delay: [0.2, 1.2],
    grow: [5, 10],
    keep: [10, 20],
    die: [1.5, 3],
  },
  wind: {
    windStrength: 0.05,
    windAngle: 30,
    windScale: 1.5,
    windSpeed: 0.6,
  },
  leaves: {
    leafCount: 4,
    leafSpan: [0.3, 0.8],
    leafScale: 0.2,
    scaleVariance: 0.3,
    droop: 0,
    leafBend: 0.5,
    curlStrengthStart: 4,
    curlStrengthEnd: 1,
    curlPowerStart: 6,
    curlPowerEnd: 1,
    bendStrength: 3,
    bendVariance: 0.3,
    colorLevels: 3,
  },
};

// Lifecycle windows used when a stem mounts before Field Leva is available.
export const DEFAULT_LIFECYCLE_RANGES = FIELD_DEFAULTS.lifecycle;
