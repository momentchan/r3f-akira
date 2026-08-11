import { FLOWER_DEFAULTS } from '../look/flowerDefaults';
import { STEM_Y_MAX } from './paths';

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
    // Fewer stems = readable arcs across the suit (not wire noise).
    count: 56,
    spreadRadius: 2.8,
    minGap: 0.14,
    leanOut: 1.0,
    phaseSpread: 1,
    arrangementSeed: 0,
    positionJitter: 0.1,
    roseRatio: 0.7,
  },
  /** Keep flowers off the body via MeshBVH closest-point distance. */
  surround: {
    enabled: true,
    /** MeshBVHHelper is the costly bit — off by default. */
    showDebug: false,
    /** Min distance from posed mesh surface to a stem base. */
    clearMargin: 0.12,
    /** Quiet pocket around head/helmet (field units, XZ). */
    faceClearRadius: 0.38,
    /**
     * Spiral density power (>1 packs more stems near the body).
     * Higher = denser contact clustering, looser outer rim.
     */
    contactPow: 1.65,
    /**
     * Near-body bloom scale vs outer (stem length + radius).
     * 0.5 = contact blooms half size; 1 = no hierarchy.
     */
    nearSizeMin: 0.62,
    /** Draw face/contact/rim guides (independent of BVH helper). */
    showCompositionDebug: false,
    /** BVHHelper display depth when showDebug is on (keep low). */
    bvhDepth: 8,
  },
  stemGeometry: {
    stemLength: [0.52, 1.12],
    stemRadius: [0.0055, 0.016],
    leanAngle: [10, 20],
    bendDegree: [0.04, 0.1],
    radiusAttenuation: [0.3, 0.7],
    baseFlare: [0.1, 0.4],
    stemSegments: 24,
    radialSegs: 6,
    bloomStart: 0.23,
    bloomFrac: 0.3,
    stemYMax: STEM_Y_MAX,
  },
  /** Shared stem toon look (was duplicated under each flower Look panel). */
  stemLook: { ...FLOWER_DEFAULTS.stem },
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
  // Leaves deferred while the field runs as one batched system.
  leaves: {
    leafCount: 3,
    leafSpan: [0.3, 0.8],
    leafScale: 0.24,
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
