import { FIELD_DEFAULTS } from '../field/fieldDefaults';

export const CLIMB_DEFAULTS = {
  enabled: true,
  /** Total short tendrils across body + backpack. */
  count: 512,
  /** Fraction assigned to body (rest → backpack when available). */
  bodyRatio: 0.62,
  arrangementSeed: 0,
  /** Samples along each wrap path (cheaper for dense packs). */
  sampleCount: 12,
  stepLength: 0.042,
  turns: 0.55,
  climbBias: 0.55,
  /** Surface offset so tubes sit just off the mesh. */
  clearGap: 0.007,
  peelAt: 0.85,
  /** Scales bone / pack capsule radii used for hitch + orbit. */
  capsuleRadiusScale: 1,
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
    showDebug: false,
    showSeeds: true,
    showPaths: true,
    showDirs: true,
    showBounds: true,
    showCapsules: true,
    /** How many tendril paths to draw (stride across full set). */
    pathCount: 24,
  },
};
