import { useMemo } from 'react';
import { useControls } from 'leva';
import { stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { ProceduralStem, STEM_RANDOMIZABLE_RANGES } from './ProceduralStem';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// VAT flower types spawned in the field. Add a meta path here and each new type
// is intermixed automatically (seeded per-stem pick below).
const FLOWER_TYPES = ['/Dahlia_Flower/Dahlia_Flower_meta.json'];
FLOWER_TYPES.forEach(preloadVATAssets);

// Salt per attribute — keeps each random stream independent
const S_LENGTH = 0, S_RADIUS = 1, S_LEAN = 2, S_BEND = 3;
const S_TAPER  = 4, S_FLARE  = 5;
const S_TYPE   = 6, S_HUE    = 7, S_LIGHT = 8;

function randomParams(i, seed, lenMin, lenMax, radMin, radMax, leanMin, leanMax,
                      bendMin, bendMax, taperMin, taperMax, flareMin, flareMax) {
  return {
    stemLength:        stableRandomRange(i, S_LENGTH, seed, lenMin,   lenMax),
    stemRadius:        stableRandomRange(i, S_RADIUS, seed, radMin,   radMax),
    leanAngle:         stableRandomRange(i, S_LEAN,   seed, leanMin,  leanMax),
    bendDegree:        stableRandomRange(i, S_BEND,   seed, bendMin,  bendMax),
    radiusAttenuation: stableRandomRange(i, S_TAPER,  seed, taperMin, taperMax),
    baseFlare:         stableRandomRange(i, S_FLARE,  seed, flareMin, flareMax),
  };
}

export function StemArrangement({ position = [0, 0, 0] }) {
  const R = STEM_RANDOMIZABLE_RANGES;

  const { count, spreadRadius, stagger, arrangementSeed } = useControls('Arrangement', {
    count:           { value: 7,   min: 1,   max: 30,  step: 1 },
    spreadRadius:    { value: 0.3, min: 0,   max: 1.5, step: 0.01 },
    stagger:         { value: 0.3, min: 0,   max: 2,   step: 0.05, label: 'stagger (s)' },
    arrangementSeed: { value: 0,   min: 0,   max: 999, step: 1,    label: 'seed' },
  }, { collapsed: true });

  // vec2 [min, max] ranges — control the sampling window for each randomized param
  const {
    stemLength:        [lenMin,   lenMax],
    stemRadius:        [radMin,   radMax],
    leanAngle:         [leanMin,  leanMax],
    bendDegree:        [bendMin,  bendMax],
    radiusAttenuation: [taperMin, taperMax],
    baseFlare:         [flareMin, flareMax],
  } = useControls('Stem Ranges', {
    stemLength:        { value: [0.3,   1.32], min: R.stemLength.min,        max: R.stemLength.max,        step: 0.01,  label: 'length' },
    stemRadius:        { value: [0.006, 0.02], min: R.stemRadius.min,        max: R.stemRadius.max,        step: 0.001, label: 'radius' },
    leanAngle:         { value: [2,     25],   min: R.leanAngle.min,         max: R.leanAngle.max,         step: 0.5,   label: 'lean °' },
    bendDegree:        { value: [0.05,  0.25], min: R.bendDegree.min,        max: R.bendDegree.max,        step: 0.005, label: 'bend' },
    radiusAttenuation: { value: [0.3,   0.7],  min: R.radiusAttenuation.min, max: R.radiusAttenuation.max, step: 0.01,  label: 'taper' },
    baseFlare:         { value: [0.1,   0.4],  min: R.baseFlare.min,         max: R.baseFlare.max,         step: 0.01,  label: 'flare' },
  }, { collapsed: true });

  // Per-phase duration windows (seconds); each stem seeds its own from these
  const {
    delay: [delayMin, delayMax],
    grow:  [growMin,  growMax],
    keep:  [keepMin,  keepMax],
    die:   [dieMin,   dieMax],
  } = useControls('Lifecycle', {
    delay: { value: [0,   1.5], min: 0,   max: 10, step: 0.1, label: 'delay (s)' },
    grow:  { value: [5, 10], min: 0.1, max: 10, step: 0.1, label: 'grow (s)' },
    keep:  { value: [10,   20],   min: 0,   max: 20, step: 0.1, label: 'keep (s)' },
    die:   { value: [1.5, 3],   min: 0.1, max: 10, step: 0.1, label: 'die (s)' },
  }, { collapsed: true });

  // Slight per-flower color spread (HSL offsets)
  const { hueRange, lightRange } = useControls('Flower Variation', {
    hueRange:   { value: 0.04, min: 0, max: 0.5, step: 0.005, label: 'hue ±' },
    lightRange: { value: 0.05, min: 0, max: 0.3, step: 0.005, label: 'light ±' },
  }, { collapsed: true });

  // Shared, stable object of lifecycle windows passed to every stem
  const lifecycleRanges = useMemo(() => ({
    delay: [delayMin, delayMax],
    grow:  [growMin,  growMax],
    keep:  [keepMin,  keepMax],
    die:   [dieMin,   dieMax],
  }), [delayMin, delayMax, growMin, growMax, keepMin, keepMax, dieMin, dieMax]);

  // Primitive number deps — stable across re-renders, only recompute when values actually change
  const stems = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const angle = i * GOLDEN_ANGLE;
      const r = i === 0 ? 0 : spreadRadius * Math.sqrt(i / (count - 1));
      const typeIdx = Math.floor(
        stableRandomRange(i, S_TYPE, arrangementSeed, 0, FLOWER_TYPES.length),
      ) % FLOWER_TYPES.length;
      return {
        position:       [Math.cos(angle) * r, 0, Math.sin(angle) * r],
        timeOffset:     i * stagger,
        seedOverride:   i * 13 + 1,
        flowerMeta:     FLOWER_TYPES[typeIdx],
        colorOverride: {
          hueShift:   stableRandomRange(i, S_HUE,   arrangementSeed, -hueRange,   hueRange),
          lightShift: stableRandomRange(i, S_LIGHT, arrangementSeed, -lightRange, lightRange),
        },
        paramsOverride: randomParams(
          i, arrangementSeed,
          lenMin, lenMax, radMin, radMax, leanMin, leanMax,
          bendMin, bendMax, taperMin, taperMax, flareMin, flareMax,
        ),
      };
    });
  }, [count, spreadRadius, stagger, arrangementSeed, hueRange, lightRange,
      lenMin, lenMax, radMin, radMax, leanMin, leanMax,
      bendMin, bendMax, taperMin, taperMax, flareMin, flareMax]);

  return (
    <group position={position}>
      {stems.map(({ position: pos, timeOffset, seedOverride, flowerMeta, colorOverride, paramsOverride }, i) => (
        <ProceduralStem
          key={i}
          position={pos}
          timeOffset={timeOffset}
          seedOverride={seedOverride}
          flowerMeta={flowerMeta}
          colorOverride={colorOverride}
          paramsOverride={paramsOverride}
          lifecycleRanges={lifecycleRanges}
        />
      ))}
    </group>
  );
}
