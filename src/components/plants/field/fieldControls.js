import { folder } from 'leva';
import { FIELD_DEFAULTS } from './fieldDefaults';

export function createArrangementSchema(defaults = FIELD_DEFAULTS.arrangement) {
  const d = defaults;
  return {
    count: { value: d.count, min: 1, max: 256, step: 1, label: 'flower count' },
    spreadRadius: { value: d.spreadRadius, min: 0, max: 4, step: 0.01 },
    minGap: { value: d.minGap, min: 0, max: 1, step: 0.01, label: 'flower root gap' },
    leanOut: { value: d.leanOut, min: 0, max: 1, step: 0.05, label: 'lean outward' },
    flowerBandSpread: {
      value: d.flowerBandSpread ?? 0.78,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'flower band width',
    },
    bloomClusterCount: {
      value: d.bloomClusterCount ?? 8,
      min: 1,
      max: 16,
      step: 1,
      label: 'bloom clusters',
    },
    clusterShare: {
      value: d.clusterShare ?? 0.75,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'flowers in clusters',
    },
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
    reshuffleOnRespawn: {
      value: d.reshuffleOnRespawn ?? true,
      label: 'reshuffle respawn',
    },
    slotFactor: {
      value: d.slotFactor ?? 3,
      min: 1,
      max: 6,
      step: 1,
      label: 'spawn slots x',
    },
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

export function createLifecycleSchema(defaults = FIELD_DEFAULTS.lifecycle) {
  const d = defaults;
  return {
    phaseSpread: {
      value: d.phaseSpread,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'initial phase spread',
    },
    delay: { value: d.delay, min: 0, max: 10, step: 0.1, label: 'delay (s)' },
    grow: { value: d.grow, min: 0.1, max: 10, step: 0.1, label: 'grow (s)' },
    keep: { value: d.keep, min: 0, max: 20, step: 0.1, label: 'keep (s)' },
    die: { value: d.die, min: 0.1, max: 10, step: 0.1, label: 'die (s)' },
    petalShedFrac: {
      value: d.petalShedFrac ?? 0.75,
      min: 0,
      max: 0.95,
      step: 0.05,
      label: 'petal shed / die',
    },
    shedStemOverlap: {
      value: d.shedStemOverlap ?? 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      label: 'stem/shed overlap',
    },
  };
}

export function createPetalShedSchema(defaults = FIELD_DEFAULTS.petalShed) {
  const d = defaults;
  return {
    shedRise: {
      value: d.shedRise ?? 2,
      min: 0,
      max: 6,
      step: 0.1,
      label: 'rise / stem length',
    },
    shedRiseVariance: {
      value: d.shedRiseVariance ?? 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      label: 'rise variance',
    },
    shedSpread: {
      value: d.shedSpread ?? 0.35,
      min: 0,
      max: 3,
      step: 0.05,
      label: 'spread / stem length',
    },
    shedStagger: {
      value: d.shedStagger ?? 0.55,
      min: 0,
      max: 0.95,
      step: 0.05,
      label: 'stagger',
    },
  };
}

export function createFieldControlsSchema(defaults = FIELD_DEFAULTS) {
  return {
    Arrangement: folder(createArrangementSchema(defaults.arrangement), { collapsed: true }),
    Surround: folder(createSurroundSchema(defaults.surround), { collapsed: true }),
    Lifecycle: folder(createLifecycleSchema(defaults.lifecycle), { collapsed: true }),
    'Petal Shed': folder(createPetalShedSchema(defaults.petalShed), { collapsed: true }),
  };
}
