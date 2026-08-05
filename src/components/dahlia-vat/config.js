import { folder } from 'leva';

// Single source of truth for the procedural stem + VAT flower field.
// All tunable numbers, path constants, and Leva schema builders live here so the
// settings aren't scattered across the components. StemArrangement is the only
// place that registers these panels; ProceduralStem/DahliaVAT are props-driven.

// ── Paths ──────────────────────────────────────────────────────────
export const FLOWER_META = '/Dahlia_Flower/Dahlia_Flower_meta.json';

// VAT flower types spawned in the field. Add a meta path here and it is
// intermixed automatically (seeded per-stem pick in StemArrangement).
export const FLOWER_TYPES = [FLOWER_META];

// ── Hard bounds for the randomized stem geometry (Leva slider limits) ──
export const STEM_RANGES = {
  stemLength:        { min: 0.05, max: 2 },
  stemRadius:        { min: 0.002, max: 0.06 },
  leanAngle:         { min: 0,    max: 45 },
  bendDegree:        { min: 0,    max: 0.35 },
  radiusAttenuation: { min: 0,    max: 1 },
  baseFlare:         { min: 0,    max: 1 },
};

// VAT flower/stem vertex-color split threshold (feeds part-color tagging).
export const STEM_Y_MAX = 0.05;

// Per-phase duration windows (seconds) — the field default + the standalone
// fallback for ProceduralStem. The 'Lifecycle' panel is seeded from this.
export const DEFAULT_LIFECYCLE_RANGES = {
  delay: [0, 1.5],
  grow:  [5, 10],
  keep:  [10, 20],
  die:   [1.5, 3],
};

// ── Leva schema builders (plain objects; no folders) ────────────────

// Field layout: how many stems, how far they spread, phase spread, field seed.
export function createArrangementSchema() {
  return {
    count:           { value: 7,   min: 1,   max: 30,  step: 1 },
    spreadRadius:    { value: 0.3, min: 0,   max: 1.5, step: 0.01 },
    // 1 = each stem starts at a random point in its cycle (continuous spawning);
    // 0 = all stems start together (synchronized wave).
    phaseSpread:     { value: 1,   min: 0,   max: 1,   step: 0.01, label: 'phase spread' },
    arrangementSeed: { value: 0,   min: 0,   max: 999, step: 1,    label: 'seed' },
  };
}

// All stem settings in one panel, split into two subfolders:
//   Ranges    = per-stem randomized geometry ([min, max] windows, bounds STEM_RANGES)
//   Structure = global mesh resolution + bloom timing + flower size (one value each)
export function createStemSchema() {
  const R = STEM_RANGES;
  return {
    Ranges: folder({
      stemLength:        { value: [0.3,   1.32], min: R.stemLength.min,        max: R.stemLength.max,        step: 0.01,  label: 'length' },
      stemRadius:        { value: [0.006, 0.02], min: R.stemRadius.min,        max: R.stemRadius.max,        step: 0.001, label: 'radius' },
      leanAngle:         { value: [2,     25],   min: R.leanAngle.min,         max: R.leanAngle.max,         step: 0.5,   label: 'lean °' },
      bendDegree:        { value: [0.05,  0.25], min: R.bendDegree.min,        max: R.bendDegree.max,        step: 0.005, label: 'bend' },
      radiusAttenuation: { value: [0.3,   0.7],  min: R.radiusAttenuation.min, max: R.radiusAttenuation.max, step: 0.01,  label: 'taper' },
      baseFlare:         { value: [0.1,   0.4],  min: R.baseFlare.min,         max: R.baseFlare.max,         step: 0.01,  label: 'flare' },
    }),
    Structure: folder({
      stemSegments: { value: 32,  min: 4,    max: 128, step: 1 },
      radialSegs:   { value: 8,   min: 3,    max: 16,  step: 1 },
      bloomStart:   { value: 0.23, min: 0,   max: 1,   step: 0.01, label: 'bloom start' },
      bloomFrac:    { value: 0.3, min: 0,    max: 0.5, step: 0.01, label: 'bloom frac' },
      flowerSize:   { value: 4.2, min: 0,    max: 20,  step: 0.1,  label: 'flower / radius' },
      stemYMax:     { value: STEM_Y_MAX, min: -0.5, max: 0.5, step: 0.01, label: 'stem Y max' },
    }, { collapsed: true }),
  };
}

// Per-phase duration windows (seconds); each stem seeds its own from these.
export function createLifecycleSchema() {
  const L = DEFAULT_LIFECYCLE_RANGES;
  return {
    delay: { value: L.delay, min: 0,   max: 10, step: 0.1, label: 'delay (s)' },
    grow:  { value: L.grow,  min: 0.1, max: 10, step: 0.1, label: 'grow (s)' },
    keep:  { value: L.keep,  min: 0,   max: 20, step: 0.1, label: 'keep (s)' },
    die:   { value: L.die,   min: 0.1, max: 10, step: 0.1, label: 'die (s)' },
  };
}

// Slight per-flower color spread (HSL offsets).
export function createFlowerVariationSchema() {
  return {
    hueRange:   { value: 0.04, min: 0, max: 0.5, step: 0.005, label: 'hue ±' },
    lightRange: { value: 0.05, min: 0, max: 0.3, step: 0.005, label: 'light ±' },
  };
}

// Global wind: downwind gusts that bend the stem (shader) and carry the flower.
export function createWindSchema() {
  return {
    windStrength: { value: 0.05, min: 0,   max: 0.15, step: 0.001, label: 'strength' },
    windAngle:    { value: 30,   min: 0,   max: 360,  step: 1,     label: 'angle °' },
    windScale:    { value: 1.5,  min: 0.1, max: 6,    step: 0.1,   label: 'gust scale' },
    windSpeed:    { value: 0.6,  min: 0,   max: 4,    step: 0.05,  label: 'gust speed' },
  };
}
