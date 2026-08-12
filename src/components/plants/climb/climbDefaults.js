import { FIELD_DEFAULTS } from '../field/fieldDefaults';

export const CLIMB_DEFAULTS = {
  enabled: true,
  /** Step-3 look-dev region filter. */
  region: 'all',
  /** Total helix coils across body + backpack (pitch-based allocation). */
  count: 120,
  /** Fraction assigned to body (rest → backpack when available). */
  bodyRatio: 0.62,
  arrangementSeed: 0,
  /** Samples along each independent arc. */
  sampleCount: 48,
  /** Average axial spacing between ring stations. */
  stepLength: 0.075,
  /** Seeded movement inside each station cell (0 = even, 1 = near cell edges). */
  stationJitter: 0.45,
  /** Full turns per coil (1 = one loop around limb). */
  turns: 1,
  /** Independent-ring surface coverage (180 reaches the opposite side). */
  ringArcDegrees: 220,
  /** Strength of the cubic bend into the ring tangent. */
  rootBendStrength: 0.55,
  /** Blend axial advance vs circumferential wrap (1 = pure helix). */
  climbBias: 0.55,
  /** Outward distance from the BVH surface (visual mesh inflation). */
  clearGap: 0.03,
  peelAt: 1,
  /** Max coils stacked on one limb capsule. */
  maxCoilsPerCapsule: 12,
  stemRadius: 0.0028,
  radiusAttenuation: 0.35,
  baseFlare: 0.12,
  stemSegments: 12,
  radialSegs: 3,
  /** `settle` = grow once then hold; `loop` = field-style lifecycle. */
  animMode: 'settle',
  phaseSpread: 1,
  lifecycle: { ...FIELD_DEFAULTS.lifecycle },
  wind: {
    windStrength: 0.02,
    windAngle: 30,
    windScale: 1.8,
    windSpeed: 0.45,
  },
  debug: {
    showDebug: true,
    showSeeds: true,
    showPaths: true,
    showHitch: false,
    showDirs: false,
    showBounds: false,
    showCapsules: false,
    showCapsuleLabels: false,
    showDiagnostics: false,
    debugSingleHelix: false,
    debugCapsuleId: 'calf.r',
    /** How many tendril paths to draw (stride across full set). */
    pathCount: 48,
  },
};
