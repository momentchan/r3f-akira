import { folder } from 'leva';
import { FIELD_DEFAULTS } from './fieldDefaults';

export function createArrangementSchema(defaults = FIELD_DEFAULTS.arrangement) {
  const d = defaults;
  return {
    count: { value: d.count, min: 1, max: 256, step: 1 },
    spreadRadius: { value: d.spreadRadius, min: 0, max: 4, step: 0.01 },
    minGap: { value: d.minGap, min: 0, max: 1, step: 0.01, label: 'min gap' },
    leanOut: { value: d.leanOut, min: 0, max: 1, step: 0.05, label: 'lean outward' },
    phaseSpread: { value: d.phaseSpread, min: 0, max: 1, step: 0.01, label: 'phase spread' },
    arrangementSeed: { value: d.arrangementSeed, min: 0, max: 999, step: 1, label: 'seed' },
    positionJitter: {
      value: d.positionJitter ?? 0.35,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'position jitter',
    },
    roseRatio: {
      value: d.roseRatio ?? 0.45,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'rose ratio',
    },
    // Respawn shuffle: plants hop to a different validated slot each rebirth
    // instead of regrowing in place forever.
    reshuffleOnRespawn: {
      value: d.reshuffleOnRespawn ?? true,
      label: 'reshuffle respawn',
    },
    slotFactor: {
      value: d.slotFactor ?? 3,
      min: 1,
      max: 6,
      step: 1,
      label: 'spawn slots ×',
    },
    // Death: petals shrink about their own centres and lift away, then the stem
    // retracts. 0 = the old behaviour (bloom rewinds while the stem shrinks).
    petalShedFrac: {
      value: d.petalShedFrac ?? 0.75,
      min: 0,
      max: 0.95,
      step: 0.05,
      label: 'petal shed / die',
    },
    // 0 = stem waits for every petal to go (staged), 1 = both start together.
    shedStemOverlap: {
      value: d.shedStemOverlap ?? 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      label: 'stem/shed overlap',
    },
    shedRise: {
      value: d.shedRise ?? 2,
      min: 0,
      max: 6,
      step: 0.1,
      label: 'shed rise (× stem)',
    },
    shedRiseVariance: {
      value: d.shedRiseVariance ?? 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      label: 'shed rise ±',
    },
    shedSpread: {
      value: d.shedSpread ?? 0.35,
      min: 0,
      max: 3,
      step: 0.05,
      label: 'shed spread (× stem)',
    },
    shedStagger: {
      value: d.shedStagger ?? 0.55,
      min: 0,
      max: 0.95,
      step: 0.05,
      label: 'shed stagger',
    },
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

export function createSurroundSchema(defaults = FIELD_DEFAULTS.surround) {
  const d = defaults;
  return {
    enabled: { value: d.enabled, label: 'surround body' },
    showDebug: { value: d.showDebug, label: 'show BVH debug' },
    clearMargin: {
      value: d.clearMargin,
      min: 0.05,
      max: 1.2,
      step: 0.01,
      label: 'mesh clear distance',
    },
    faceClearRadius: {
      value: d.faceClearRadius ?? 0.38,
      min: 0,
      max: 1.2,
      step: 0.01,
      label: 'face clear radius',
    },
    contactPow: {
      value: d.contactPow ?? 2.55,
      min: 1,
      max: 4,
      step: 0.05,
      label: 'contact density',
    },
    nearSizeMin: {
      value: d.nearSizeMin ?? 0.48,
      min: 0.25,
      max: 1,
      step: 0.01,
      label: 'near bloom scale',
    },
    showCompositionDebug: {
      value: d.showCompositionDebug ?? false,
      label: 'show composition guides',
    },
    bvhDepth: {
      value: d.bvhDepth,
      min: 3,
      max: 20,
      step: 1,
      label: 'BVH helper depth',
    },
  };
}

export function createFieldControlsSchema(defaults = FIELD_DEFAULTS) {
  return {
    Arrangement: folder(createArrangementSchema(defaults.arrangement), { collapsed: true }),
    Surround: folder(createSurroundSchema(defaults.surround), { collapsed: true }),
    Lifecycle: folder(createLifecycleSchema(defaults.lifecycle), { collapsed: true }),
  };
}
