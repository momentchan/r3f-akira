import { useEffect, useMemo, useRef } from 'react';
import { folder, useControls } from 'leva';
import { stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../look/flowerControls';
import { ProceduralStem } from '../stem/ProceduralStem';
import { clearPointFromBvh } from './bodyBounds';
import { createFieldControlsSchema } from './fieldControls';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { BodyBoundsDebug } from '../../scene/BodyBoundsDebug';

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
const S_SPIN = 9;
const S_ANG_JIT = 10;
const S_RAD_JIT = 11;

/** Heights (field local Y) sampled for closest-point vs the lying suit. */
const CLEAR_HEIGHTS = [0.05, 0.2, 0.4, 0.7, 1.0, 1.35];

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

export function PlantField({
  position = [0, 0, 0],
  bodyBounds = null,
}) {
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
    positionJitter, roseOuterBias,
    enabled: surroundEnabled,
    showDebug,
    clearMargin,
    bvhDepth,
    stemSegments, radialSegs, bloomStart, bloomFrac, stemYMax,
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

  const boundsVersion = bodyBounds?.version ?? 0;
  const bvh = surroundEnabled ? bodyBounds?.bvh : null;
  const effectiveSpread = Math.max(spreadRadius, minGap * Math.sqrt(count));

  const stems = useMemo(() => {
    // Wait for posed MeshBVH before planting.
    if (!bvh) return [];

    const fieldSpin = stableRandomRange(0, S_SPIN, arrangementSeed, 0, Math.PI * 2);
    const maxAngleJit = positionJitter * GOLDEN_ANGLE * 0.45;
    const maxRadJit = positionJitter * 0.18;
    const cx = bodyBounds?.localBox
      ? (bodyBounds.localBox.min.x + bodyBounds.localBox.max.x) * 0.5
      : 0;
    const cz = bodyBounds?.localBox
      ? (bodyBounds.localBox.min.z + bodyBounds.localBox.max.z) * 0.5
      : 0;
    const box = bodyBounds?.localBox;
    const halfX = box ? (box.max.x - box.min.x) * 0.5 : effectiveSpread * 0.35;
    const halfZ = box ? (box.max.z - box.min.z) * 0.5 : effectiveSpread * 0.35;
    // Seed near the body; BVH push settles them just outside the mesh.
    const nearR = Math.max(0.05, Math.min(halfX, halfZ) * 0.2);
    const farR = Math.max(effectiveSpread, Math.hypot(halfX, halfZ) + 0.6);

    const out = [];
    let attempts = 0;
    const maxAttempts = count * 8;

    for (let i = 0; out.length < count && attempts < maxAttempts; attempts += 1, i += 1) {
      const ringT = count <= 1 ? 0 : (out.length / Math.max(count - 1, 1));
      const angleJit = out.length === 0
        ? 0
        : stableRandomRange(attempts, S_ANG_JIT, arrangementSeed, -maxAngleJit, maxAngleJit);
      const radScale = out.length === 0
        ? 1
        : stableRandomRange(attempts, S_RAD_JIT, arrangementSeed, 1 - maxRadJit, 1 + maxRadJit);

      const angle = attempts * GOLDEN_ANGLE + fieldSpin + angleJit;
      // Bias samples close to the body (pow > 1 keeps more stems in the near band).
      const r = (nearR + Math.pow(ringT, 1.75) * (farR - nearR)) * radScale;
      let posX = cx + Math.cos(angle) * r;
      let posZ = cz + Math.sin(angle) * r;

      const [cxPos, czPos, ok] = clearPointFromBvh(
        posX, posZ, bvh, clearMargin, CLEAR_HEIGHTS,
      );
      if (!ok) continue;
      posX = cxPos;
      posZ = czPos;

      const pRose = (1 - roseOuterBias) * 0.5 + roseOuterBias * ringT;
      const typeRoll = stableRandomRange(attempts, S_TYPE, arrangementSeed, 0, 1);
      const flowerType = typeRoll < pRose ? ROSE_TYPE : DAHLIA_TYPE;
      const { hueRange = 0, lightRange = 0 } = flowerControlsById[flowerType.id] ?? {};

      out.push({
        position: [posX, 0, posZ],
        leanOutwardAngle: Math.atan2(posX - cx, posZ - cz),
        seed: attempts * 13 + 1 + arrangementSeed * 17,
        flowerType,
        colorOverride: {
          hueShift: stableRandomRange(attempts, S_HUE, arrangementSeed, -hueRange, hueRange),
          lightShift: stableRandomRange(attempts, S_LIGHT, arrangementSeed, -lightRange, lightRange),
        },
        params: randomParams(
          attempts, arrangementSeed,
          lenMin, lenMax, radMin, radMax, leanMin, leanMax,
          bendMin, bendMax, taperMin, taperMax, flareMin, flareMax,
        ),
      });
    }

    return out;
  }, [count, effectiveSpread, arrangementSeed, positionJitter, roseOuterBias,
    bvh, clearMargin, boundsVersion, bodyBounds, flowerControlsById,
    lenMin, lenMax, radMin, radMax, leanMin, leanMax,
    bendMin, bendMax, taperMin, taperMax, flareMin, flareMax]);

  return (
    <group position={position}>
      <BodyBoundsDebug
        geometry={bodyBounds?.geometry ?? null}
        visible={Boolean(showDebug && surroundEnabled && bodyBounds?.geometry)}
        depth={bvhDepth}
      />
      {stems.map(({ position: pos, leanOutwardAngle, seed, flowerType, colorOverride, params }, i) => (
        <ProceduralStem
          key={`${boundsVersion}-${i}`}
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
