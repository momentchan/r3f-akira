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
} from './config';
import { FLOWER_TYPES } from './flowerTypes';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DAHLIA_TYPE = FLOWER_TYPES.find((t) => t.id === 'dahlia');
const ROSE_TYPE = FLOWER_TYPES.find((t) => t.id === 'rose');

FLOWER_TYPES.forEach(({ metaUrl }) => preloadVATAssets(metaUrl));

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
// from config.js / per-type flower defaults). Builds per-stem params and hands
// ProceduralStem everything as props, including the matching flower look panel.
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

  // One Leva panel per species so Rose / Dahlia materials can diverge.
  // Unrolled (not looped) to satisfy Rules of Hooks; add a block when adding a type.
  const dahliaSchema = useMemo(
    () => createFlowerControlsSchema(DAHLIA_TYPE.materialDefaults),
    [],
  );
  const roseSchema = useMemo(
    () => createFlowerControlsSchema(ROSE_TYPE.materialDefaults),
    [],
  );
  const dahliaControls = useControls(DAHLIA_TYPE.label, dahliaSchema, { collapsed: true });
  const roseControls = useControls(ROSE_TYPE.label, roseSchema, { collapsed: true });
  const flowerControlsById = useMemo(() => ({
    [DAHLIA_TYPE.id]: dahliaControls,
    [ROSE_TYPE.id]: roseControls,
  }), [dahliaControls, roseControls]);

  const { count, spreadRadius, minGap, leanOut, phaseSpread, arrangementSeed } =
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

  // Shared, stable object of lifecycle windows passed to every stem
  const lifecycleRanges = useMemo(() => ({
    delay: [delayMin, delayMax],
    grow:  [growMin,  growMax],
    keep:  [keepMin,  keepMax],
    die:   [dieMin,   dieMax],
  }), [delayMin, delayMax, growMin, growMax, keepMin, keepMax, dieMin, dieMax]);

  // Size-aware spacing: grow the field radius with count so bases keep ≥ minGap apart
  // (the golden-angle spiral is already evenly spaced, so scaling the radius scales the
  // gap). spreadRadius acts as a floor.
  const effectiveSpread = Math.max(spreadRadius, minGap * Math.sqrt(count));

  // Primitive number deps — stable across re-renders, only recompute when values change
  const stems = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const angle = i * GOLDEN_ANGLE;
      const r = i === 0 ? 0 : effectiveSpread * Math.sqrt(i / (count - 1));
      const posX = Math.cos(angle) * r;
      const posZ = Math.sin(angle) * r;
      const typeIdx = Math.floor(
        stableRandomRange(i, S_TYPE, arrangementSeed, 0, FLOWER_TYPES.length),
      ) % FLOWER_TYPES.length;
      const flowerType = FLOWER_TYPES[typeIdx];
      return {
        position:     [posX, 0, posZ],
        // Azimuth pointing away from the field centre (in ProceduralStem's lean
        // convention x=sin, z=cos) — the stem leans outward by `leanOut`.
        leanOutwardAngle: Math.atan2(posX, posZ),
        seed:         i * 13 + 1,
        flowerType,
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
  }, [count, effectiveSpread, arrangementSeed, hueRange, lightRange,
      lenMin, lenMax, radMin, radMax, leanMin, leanMax,
      bendMin, bendMax, taperMin, taperMax, flareMin, flareMax]);

  return (
    <group position={position}>
      {stems.map(({ position: pos, leanOutwardAngle, seed, flowerType, colorOverride, params }, i) => (
        <ProceduralStem
          key={i}
          position={pos}
          leanOutwardAngle={leanOutwardAngle}
          leanOut={leanOut}
          phaseSpread={phaseSpread}
          seed={seed}
          flowerType={flowerType}
          flowerControls={flowerControlsById[flowerType.id]}
          colorOverride={colorOverride}
          params={params}
          stemSegments={stemSegments}
          radialSegs={radialSegs}
          flowerSize={flowerSize}
          stemYMax={stemYMax}
          bloomStart={bloomStart}
          bloomFrac={bloomFrac}
          lifecycleRanges={lifecycleRanges}
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
