import { useEffect, useMemo, useRef } from 'react';
import { folder, useControls } from 'leva';
import { stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../look/flowerControls';
import { ProceduralStem } from '../stem/ProceduralStem';
import { createFieldControlsSchema } from './fieldControls';
import { FLOWER_TYPES } from '../vat/flowerTypes';


const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DAHLIA_TYPE = FLOWER_TYPES.find((t) => t.id === 'dahlia');
const ROSE_TYPE = FLOWER_TYPES.find((t) => t.id === 'rose');

FLOWER_TYPES.forEach(({ metaUrl }) => preloadVATAssets(metaUrl));

const S_LENGTH = 0;
const S_RADIUS = 1;
const S_LEAN = 2;
const S_BEND = 3;
const S_TAPER = 4;
const S_FLARE = 5;
const S_TYPE = 6;
const S_HUE = 7;
const S_LIGHT = 8;

function randomParams(i, seed, lenMin, lenMax, radMin, radMax, leanMin, leanMax,
  bendMin, bendMax, taperMin, taperMax, flareMin, flareMax) {
  return {
    stemLength: stableRandomRange(i, S_LENGTH, seed, lenMin, lenMax),
    stemRadius: stableRandomRange(i, S_RADIUS, seed, radMin, radMax),
    leanAngle: stableRandomRange(i, S_LEAN, seed, leanMin, leanMax),
    bendDegree: stableRandomRange(i, S_BEND, seed, bendMin, bendMax),
    radiusAttenuation: stableRandomRange(i, S_TAPER, seed, taperMin, taperMax),
    baseFlare: stableRandomRange(i, S_FLARE, seed, flareMin, flareMax),
  };
}

export function PlantField({ position = [0, 0, 0] }) {
  // Shared across the field — Space toggles grow/stop for every plant's lifecycle.
  const lifecyclePausedRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== 'Space' || event.repeat) return;

      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
        return;
      }

      event.preventDefault();
      lifecyclePausedRef.current = !lifecyclePausedRef.current;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const fieldSchema = useMemo(() => createFieldControlsSchema(), []);
  const {
    count, spreadRadius, minGap, leanOut, phaseSpread, arrangementSeed,
    stemSegments, radialSegs, bloomStart, bloomFrac, flowerSize, stemYMax,
    stemLength: [lenMin, lenMax],
    stemRadius: [radMin, radMax],
    leanAngle: [leanMin, leanMax],
    bendDegree: [bendMin, bendMax],
    radiusAttenuation: [taperMin, taperMax],
    baseFlare: [flareMin, flareMax],
    delay: [delayMin, delayMax],
    grow: [growMin, growMax],
    keep: [keepMin, keepMax],
    die: [dieMin, dieMax],
    windStrength, windAngle, windScale, windSpeed,
    leafCount, leafSpan, leafScale, scaleVariance, droop, leafBend,
    curlStrengthStart, curlStrengthEnd, curlPowerStart, curlPowerEnd,
    bendStrength, bendVariance, colorLevels,
  } = useControls('Field', fieldSchema, { collapsed: true });

  // Unrolled per species for Rules of Hooks; both nest under Look.
  const dahliaSchema = useMemo(
    () => createFlowerControlsSchema(DAHLIA_TYPE.materialDefaults),
    [],
  );
  const roseSchema = useMemo(
    () => createFlowerControlsSchema(ROSE_TYPE.materialDefaults),
    [],
  );
  const dahliaControls = useControls('Look', {
    Dahlia: folder(dahliaSchema, { collapsed: true }),
  }, { collapsed: true });
  const roseControls = useControls('Look', {
    Rose: folder(roseSchema, { collapsed: true }),
  }, { collapsed: true });
  const flowerControlsById = useMemo(() => ({
    [DAHLIA_TYPE.id]: dahliaControls,
    [ROSE_TYPE.id]: roseControls,
  }), [dahliaControls, roseControls]);

  const curlStrength = useMemo(
    () => [curlStrengthStart, curlStrengthEnd],
    [curlStrengthStart, curlStrengthEnd],
  );
  const curlPower = useMemo(
    () => [curlPowerStart, curlPowerEnd],
    [curlPowerStart, curlPowerEnd],
  );

  const lifecycleRanges = useMemo(() => ({
    delay: [delayMin, delayMax],
    grow: [growMin, growMax],
    keep: [keepMin, keepMax],
    die: [dieMin, dieMax],
  }), [delayMin, delayMax, growMin, growMax, keepMin, keepMax, dieMin, dieMax]);

  const effectiveSpread = Math.max(spreadRadius, minGap * Math.sqrt(count));

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
      const { hueRange = 0, lightRange = 0 } = flowerControlsById[flowerType.id] ?? {};
      return {
        position: [posX, 0, posZ],
        leanOutwardAngle: Math.atan2(posX, posZ),
        seed: i * 13 + 1,
        flowerType,
        colorOverride: {
          hueShift: stableRandomRange(i, S_HUE, arrangementSeed, -hueRange, hueRange),
          lightShift: stableRandomRange(i, S_LIGHT, arrangementSeed, -lightRange, lightRange),
        },
        params: randomParams(
          i, arrangementSeed,
          lenMin, lenMax, radMin, radMax, leanMin, leanMax,
          bendMin, bendMax, taperMin, taperMax, flareMin, flareMax,
        ),
      };
    });
  }, [count, effectiveSpread, arrangementSeed, flowerControlsById,
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
          lifecyclePausedRef={lifecyclePausedRef}
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
