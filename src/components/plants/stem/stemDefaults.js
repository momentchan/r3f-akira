import { FLOWER_DEFAULTS } from '../look/flowerDefaults';

// VAT flower/stem vertex-color split threshold (feeds part-color tagging).
export const STEM_Y_MAX = 0.05;

export const STEM_RANGES = Object.freeze({
  stemLength: { min: 0.05, max: 2 },
  stemRadius: { min: 0.002, max: 0.06 },
  leanAngle: { min: 0, max: 45 },
  bendDegree: { min: 0, max: 0.35 },
  radiusAttenuation: { min: 0, max: 1 },
  baseFlare: { min: 0, max: 1 },
});

/** Defaults owned by the top-level Stem Leva panel. */
export const STEM_DEFAULTS = Object.freeze({
  geometry: {
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
  look: { ...FLOWER_DEFAULTS.stem },
  leaves: {
    leafCount: 2,
    leafSpan: [0.3, 0.8],
    leafScale: 0.17,
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
});

export const DEFAULT_STEM_LOOK = FLOWER_DEFAULTS.stem;
