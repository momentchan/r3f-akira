import { folder } from 'leva';
import { STEM_Y_MAX } from './paths';
import { FIELD_DEFAULTS, STEM_RANGES } from './fieldDefaults';

export function createArrangementSchema(defaults = FIELD_DEFAULTS.arrangement) {
  const d = defaults;
  return {
    count: { value: d.count, min: 1, max: 30, step: 1 },
    spreadRadius: { value: d.spreadRadius, min: 0, max: 1.5, step: 0.01 },
    minGap: { value: d.minGap, min: 0, max: 1, step: 0.01, label: 'min gap' },
    leanOut: { value: d.leanOut, min: 0, max: 1, step: 0.05, label: 'lean outward' },
    phaseSpread: { value: d.phaseSpread, min: 0, max: 1, step: 0.01, label: 'phase spread' },
    arrangementSeed: { value: d.arrangementSeed, min: 0, max: 999, step: 1, label: 'seed' },
  };
}

export function createStemGeometrySchema(defaults = FIELD_DEFAULTS.stemGeometry) {
  const d = defaults;
  const R = STEM_RANGES;
  return {
    Ranges: folder({
      stemLength: { value: d.stemLength, min: R.stemLength.min, max: R.stemLength.max, step: 0.01, label: 'length' },
      stemRadius: { value: d.stemRadius, min: R.stemRadius.min, max: R.stemRadius.max, step: 0.001, label: 'radius' },
      leanAngle: { value: d.leanAngle, min: R.leanAngle.min, max: R.leanAngle.max, step: 0.5, label: 'lean °' },
      bendDegree: { value: d.bendDegree, min: R.bendDegree.min, max: R.bendDegree.max, step: 0.005, label: 'bend' },
      radiusAttenuation: {
        value: d.radiusAttenuation,
        min: R.radiusAttenuation.min,
        max: R.radiusAttenuation.max,
        step: 0.01,
        label: 'taper',
      },
      baseFlare: { value: d.baseFlare, min: R.baseFlare.min, max: R.baseFlare.max, step: 0.01, label: 'flare' },
    }),
    Structure: folder({
      stemSegments: { value: d.stemSegments, min: 4, max: 128, step: 1 },
      radialSegs: { value: d.radialSegs, min: 3, max: 16, step: 1 },
      bloomStart: { value: d.bloomStart, min: 0, max: 1, step: 0.01, label: 'bloom start' },
      bloomFrac: { value: d.bloomFrac, min: 0, max: 0.5, step: 0.01, label: 'bloom frac' },
      flowerSize: { value: d.flowerSize, min: 0, max: 20, step: 0.1, label: 'flower / radius' },
      stemYMax: { value: STEM_Y_MAX, min: -0.5, max: 0.5, step: 0.01, label: 'stem Y max' },
    }, { collapsed: true }),
  };
}

export function createLifecycleSchema(defaults = FIELD_DEFAULTS.lifecycle) {
  const d = defaults;
  return {
    delay: { value: d.delay, min: 0, max: 10, step: 0.1, label: 'delay (s)' },
    grow: { value: d.grow, min: 0.1, max: 10, step: 0.1, label: 'grow (s)' },
    keep: { value: d.keep, min: 0, max: 20, step: 0.1, label: 'keep (s)' },
    die: { value: d.die, min: 0.1, max: 10, step: 0.1, label: 'die (s)' },
  };
}

export function createLeafSchema(defaults = FIELD_DEFAULTS.leaves) {
  const d = defaults;
  return {
    leafCount: { value: d.leafCount, min: 0, max: 12, step: 1, label: 'count' },
    leafSpan: { value: d.leafSpan, min: 0, max: 1, step: 0.01, label: 'spawn range' },
    leafScale: { value: d.leafScale, min: 0.05, max: 1.2, step: 0.01, label: 'size / stem len' },
    scaleVariance: { value: d.scaleVariance, min: 0, max: 1, step: 0.05, label: 'size variance' },
    droop: { value: d.droop, min: -1.2, max: 1.2, step: 0.01, label: 'droop (rad)' },
    leafBend: { value: d.leafBend, min: -2, max: 2, step: 0.05, label: 'bend (curl)' },
    curlStrengthStart: { value: d.curlStrengthStart, min: 0, max: 8, step: 0.1, label: 'curl str: start' },
    curlStrengthEnd: { value: d.curlStrengthEnd, min: 0, max: 8, step: 0.1, label: 'curl str: end' },
    curlPowerStart: { value: d.curlPowerStart, min: 0.2, max: 8, step: 0.05, label: 'curl pow: start' },
    curlPowerEnd: { value: d.curlPowerEnd, min: 0.2, max: 8, step: 0.05, label: 'curl pow: end' },
    bendStrength: { value: d.bendStrength, min: 0, max: 12, step: 0.1, label: 'wind flex' },
    bendVariance: { value: d.bendVariance, min: 0, max: 1, step: 0.05, label: 'curl variance' },
    colorLevels: { value: d.colorLevels, min: 1, max: 16, step: 1, label: 'toon smoothness' },
  };
}

export function createWindSchema(defaults = FIELD_DEFAULTS.wind) {
  const d = defaults;
  return {
    windStrength: { value: d.windStrength, min: 0, max: 0.15, step: 0.001, label: 'strength' },
    windAngle: { value: d.windAngle, min: 0, max: 360, step: 1, label: 'angle °' },
    windScale: { value: d.windScale, min: 0.1, max: 6, step: 0.1, label: 'gust scale' },
    windSpeed: { value: d.windSpeed, min: 0, max: 4, step: 0.05, label: 'gust speed' },
  };
}

export function createFieldControlsSchema(defaults = FIELD_DEFAULTS) {
  return {
    Arrangement: folder(createArrangementSchema(defaults.arrangement), { collapsed: true }),
    'Stem Geometry': folder(createStemGeometrySchema(defaults.stemGeometry), { collapsed: true }),
    Lifecycle: folder(createLifecycleSchema(defaults.lifecycle), { collapsed: true }),
    Wind: folder(createWindSchema(defaults.wind), { collapsed: true }),
    Leaves: folder(createLeafSchema(defaults.leaves), { collapsed: true }),
  };
}
