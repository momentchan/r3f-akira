import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useControls } from 'leva';
import { stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../flower/flowerControls';
import { ProceduralStem } from './ProceduralStem';
import {
  createArrangementSchema,
  createFlowerVariationSchema,
  createLeafSchema,
  createLifecycleSchema,
  createStemSchema,
  createWindSchema,
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
  // Precompile camera + shadow-map pipelines once at startup so the first stem
  // birth (and its first shadow render) doesn't stall on a synchronous compile.
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const raf = requestAnimationFrame(() => gl.compileAsync?.(scene, camera));
    return () => cancelAnimationFrame(raf);
  }, [gl, scene, camera]);

  const arrangementSchema = useMemo(() => createArrangementSchema(), []);
  const stemSchema = useMemo(() => createStemSchema(), []);
  const lifecycleSchema = useMemo(() => createLifecycleSchema(), []);
  const variationSchema = useMemo(() => createFlowerVariationSchema(), []);
  const windSchema = useMemo(() => createWindSchema(), []);
  const leafSchema = useMemo(() => createLeafSchema(), []);
  const flowerSchema = useMemo(
    () => createFlowerControlsSchema({ mask: { edgeWidth: 0.001 } }),
    [],
  );

  const { count, spreadRadius, phaseSpread, arrangementSeed } =
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

  const { windStrength, windAngle, windScale, windSpeed } =
    useControls('Wind', windSchema, { collapsed: true });

  const {
    leafCount, leafSpan, leafScale, scaleVariance, droop, leafBend,
    curlStrengthStart, curlStrengthEnd, curlPowerStart, curlPowerEnd,
    bendStrength, bendVariance, colorLevels,
  } = useControls('Leaves', leafSchema, { collapsed: true });

  // Assemble the [start, end] curl vectors (stable refs) from the scalar sliders.
  const curlStrength = useMemo(
    () => [curlStrengthStart, curlStrengthEnd], [curlStrengthStart, curlStrengthEnd],
  );
  const curlPower = useMemo(
    () => [curlPowerStart, curlPowerEnd], [curlPowerStart, curlPowerEnd],
  );

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
  }, [count, spreadRadius, arrangementSeed, hueRange, lightRange,
      lenMin, lenMax, radMin, radMax, leanMin, leanMax,
      bendMin, bendMax, taperMin, taperMax, flareMin, flareMax]);

  return (
    <group position={position}>
      {stems.map(({ position: pos, seed, flowerMeta, colorOverride, params }, i) => (
        <ProceduralStem
          key={i}
          position={pos}
          phaseSpread={phaseSpread}
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
          windAngle={windAngle}
          windStrength={windStrength}
          windScale={windScale}
          windSpeed={windSpeed}
          leafCount={leafCount}
          leafSpan={leafSpan}
          leafScale={leafScale}
          scaleVariance={scaleVariance}
          droop={droop}
          leafBend={leafBend}
          curlStrength={curlStrength}
          curlPower={curlPower}
          bendStrength={bendStrength}
          bendVariance={bendVariance}
          colorLevels={colorLevels}
        />
      ))}
    </group>
  );
}
