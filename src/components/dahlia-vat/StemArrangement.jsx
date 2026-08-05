import { useMemo } from 'react';
import { useControls } from 'leva';
import { stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../flower/flowerControls';
import { ProceduralStem } from './ProceduralStem';
import {
  createArrangementSchema,
  createFlowerVariationSchema,
  createLifecycleSchema,
  createStemSchema,
  FLOWER_TYPES,
} from './config';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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

// The single settings surface: every Leva panel for the field lives here (schemas
// from config.js). Builds per-stem params and hands ProceduralStem everything as
// props, including the shared 'Flower' shader controls.
export function StemArrangement({ position = [0, 0, 0] }) {
  const arrangementSchema = useMemo(() => createArrangementSchema(), []);
  const stemSchema = useMemo(() => createStemSchema(), []);
  const lifecycleSchema = useMemo(() => createLifecycleSchema(), []);
  const variationSchema = useMemo(() => createFlowerVariationSchema(), []);
  const flowerSchema = useMemo(
    () => createFlowerControlsSchema({ mask: { edgeWidth: 0.001 } }),
    [],
  );

  const { count, spreadRadius, stagger, arrangementSeed } =
    useControls('Arrangement', arrangementSchema, { collapsed: true });

  // One 'Stem' panel — Ranges (vec2 windows) + Structure (single values)
  const {
    stemSegments, radialSegs, bloomStart, bloomFrac, flowerSize, stemYMax,
    stemLength:        [lenMin,   lenMax],
    stemRadius:        [radMin,   radMax],
    leanAngle:         [leanMin,  leanMax],
    bendDegree:        [bendMin,  bendMax],
    radiusAttenuation: [taperMin, taperMax],
    baseFlare:         [flareMin, flareMax],
  } = useControls('Stem', stemSchema, { collapsed: true });

  const {
    delay: [delayMin, delayMax],
    grow:  [growMin,  growMax],
    keep:  [keepMin,  keepMax],
    die:   [dieMin,   dieMax],
  } = useControls('Lifecycle', lifecycleSchema, { collapsed: true });

  const { hueRange, lightRange } =
    useControls('Flower Variation', variationSchema, { collapsed: true });

  // Shared shader look — registered ONCE, passed to every plant
  const flowerControls = useControls('Flower', flowerSchema, { collapsed: true });

  // Shared, stable object of lifecycle windows passed to every stem
  const lifecycleRanges = useMemo(() => ({
    delay: [delayMin, delayMax],
    grow:  [growMin,  growMax],
    keep:  [keepMin,  keepMax],
    die:   [dieMin,   dieMax],
  }), [delayMin, delayMax, growMin, growMax, keepMin, keepMax, dieMin, dieMax]);

  // Primitive number deps — stable across re-renders, only recompute when values change
  const stems = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const angle = i * GOLDEN_ANGLE;
      const r = i === 0 ? 0 : spreadRadius * Math.sqrt(i / (count - 1));
      const typeIdx = Math.floor(
        stableRandomRange(i, S_TYPE, arrangementSeed, 0, FLOWER_TYPES.length),
      ) % FLOWER_TYPES.length;
      return {
        position:     [Math.cos(angle) * r, 0, Math.sin(angle) * r],
        timeOffset:   i * stagger,
        seed:         i * 13 + 1,
        flowerMeta:   FLOWER_TYPES[typeIdx],
        colorOverride: {
          hueShift:   stableRandomRange(i, S_HUE,   arrangementSeed, -hueRange,   hueRange),
          lightShift: stableRandomRange(i, S_LIGHT, arrangementSeed, -lightRange, lightRange),
        },
        params: randomParams(
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
      {stems.map(({ position: pos, timeOffset, seed, flowerMeta, colorOverride, params }, i) => (
        <ProceduralStem
          key={i}
          position={pos}
          timeOffset={timeOffset}
          seed={seed}
          flowerMeta={flowerMeta}
          colorOverride={colorOverride}
          params={params}
          stemSegments={stemSegments}
          radialSegs={radialSegs}
          flowerSize={flowerSize}
          stemYMax={stemYMax}
          bloomStart={bloomStart}
          bloomFrac={bloomFrac}
          lifecycleRanges={lifecycleRanges}
          flowerControls={flowerControls}
        />
      ))}
    </group>
  );
}
