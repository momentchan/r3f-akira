import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useControls } from 'leva';
import { stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../look/flowerControls';
import { clearPointFromBvh } from './bodyBounds';
import { createFieldControlsSchema } from './fieldControls';
import { createStemSchema } from '../stem/stemControls';
import { STEM_DEFAULTS } from '../stem/stemDefaults';
import { useLifecyclePauseHotkey } from '../lifecycle/useLifecyclePauseHotkey';
import { computeDurations, lifecycleLength } from '../lifecycle/plantLifecycle';
import { PlantSystem } from './PlantSystem';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { BodyBoundsDebug } from '../../scene/BodyBoundsDebug';
import { CompositionDebug } from './CompositionDebug';
import { PLANT_WIND_DEFAULTS } from '../wind/plantWind';
import { buildGroundFlowerStems } from '../groundTendrils/buildGroundFlowerStems';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DAHLIA_TYPE = FLOWER_TYPES.find((t) => t.id === 'dahlia');
const ROSE_TYPE = FLOWER_TYPES.find((t) => t.id === 'rose');

[DAHLIA_TYPE, ROSE_TYPE].forEach(({ metaUrl }) => preloadVATAssets(metaUrl));

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
  bendMin, bendMax, taperMin, taperMax, flareMin, flareMax, sizeMul = 1) {
  return {
    stemLength: stableRandomRange(i, S_LENGTH, seed, lenMin, lenMax) * sizeMul,
    stemRadius: stableRandomRange(i, S_RADIUS, seed, radMin, radMax) * sizeMul,
    leanAngle: stableRandomRange(i, S_LEAN, seed, leanMin, leanMax),
    bendDegree: stableRandomRange(i, S_BEND, seed, bendMin, bendMax),
    radiusAttenuation: stableRandomRange(i, S_TAPER, seed, taperMin, taperMax),
    baseFlare: stableRandomRange(i, S_FLARE, seed, flareMin, flareMax),
  };
}

/** Push XZ away from a soft circular keep-out (helmet pocket). */
function clearPointFromDisc(x, z, cx, cz, radius) {
  if (radius <= 1e-5) return [x, z, true];
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= radius) return [x, z, true];
  if (d < 1e-5) {
    return [cx + radius, cz, true];
  }
  const s = radius / d;
  return [cx + dx * s, cz + dz * s, true];
}

export function PlantField({
  position = [0, 0, 0],
  bodyBounds = null,
  groundPaths = null,
  groundOffsetY = 0,
  groundCompletedTreesRef = null,
  groundTreeLifecycleRef = null,
  groundFlowerTimingRef = null,
  groundRouteRegistryRef = null,
  onStemBases,
  wind = PLANT_WIND_DEFAULTS,
}) {
  const lifecyclePausedRef = useLifecyclePauseHotkey();
  const usesGroundPaths = Array.isArray(groundPaths);

  const fieldSchema = useMemo(() => createFieldControlsSchema(), []);
  const {
    count, spreadRadius, minGap, leanOut, phaseSpread, arrangementSeed,
    flowerBandSpread, bloomClusterCount, clusterShare,
    positionJitter, roseRatio, reshuffleOnRespawn, slotFactor,
    petalShedFrac, shedStemOverlap,
    shedRise, shedRiseVariance, shedSpread, shedStagger,
    enabled: surroundEnabled,
    showDebug,
    clearMargin,
    faceClearRadius,
    contactPow,
    nearSizeMin,
    showCompositionDebug,
    bvhDepth,
    delay: [delayMin, delayMax],
    grow: [growMin, growMax],
    keep: [keepMin, keepMax],
    die: [dieMin, dieMax],
  } = useControls('Field', fieldSchema, { collapsed: true });

  const stemSchema = useMemo(() => createStemSchema(), []);
  const stemControls = useControls('Stem', stemSchema, { collapsed: true });
  const {
    stemSegments, radialSegs, bloomStart, bloomFrac, stemYMax,
    stemLength: [lenMin, lenMax],
    stemRadius: [radMin, radMax],
    leanAngle: [leanMin, leanMax],
    bendDegree: [bendMin, bendMax],
    radiusAttenuation: [taperMin, taperMax],
    baseFlare: [flareMin, flareMax],
    leafCount,
    leafSpan,
    leafScale,
    scaleVariance,
    droop,
    leafBend,
    curlStrengthStart,
    curlStrengthEnd,
    curlPowerStart,
    curlPowerEnd,
    bendStrength,
    bendVariance,
    colorLevels: leafColorLevels,
  } = stemControls;

  const stemLookControls = useMemo(() => ({
    stemColorLevels: stemControls.stemColorLevels,
    stemThresholdLow: stemControls.stemThresholdLow,
    stemThresholdHigh: stemControls.stemThresholdHigh,
    stemShadowColor: STEM_DEFAULTS.look.shadowColor,
    stemHighlightColor: STEM_DEFAULTS.look.highlightColor,
    stemEdgeColor: STEM_DEFAULTS.look.edgeColor,
    stemEdgeThreshold: stemControls.stemEdgeThreshold,
    stemEdgeSoftness: stemControls.stemEdgeSoftness,
  }), [
    stemControls.stemColorLevels,
    stemControls.stemThresholdLow,
    stemControls.stemThresholdHigh,
    stemControls.stemEdgeThreshold,
    stemControls.stemEdgeSoftness,
  ]);

  const leafControls = useMemo(() => ({
    leafCount,
    leafSpan,
    leafScale,
    scaleVariance,
    droop,
    leafBend,
    curlStrength: [curlStrengthStart, curlStrengthEnd],
    curlPower: [curlPowerStart, curlPowerEnd],
    bendStrength,
    bendVariance,
    colorLevels: leafColorLevels,
  }), [
    leafCount, leafSpan, leafScale, scaleVariance, droop, leafBend,
    curlStrengthStart, curlStrengthEnd, curlPowerStart, curlPowerEnd,
    bendStrength, bendVariance, leafColorLevels,
  ]);

  const dahliaSchema = useMemo(
    () => createFlowerControlsSchema(DAHLIA_TYPE.materialDefaults),
    [],
  );
  const roseSchema = useMemo(
    () => createFlowerControlsSchema(ROSE_TYPE.materialDefaults),
    [],
  );
  // Schema object must stay referentially stable — a new `{ Dahlia: folder(...) }`
  // each render remounts Leva inputs and rebuilds the plant field (lifecycle restart).
  const dahliaControls = useControls('Flower.Dahlia', dahliaSchema, { collapsed: true });
  const roseControls = useControls('Flower.Rose', roseSchema, { collapsed: true });
  const flowerControlsById = useMemo(() => ({
    [DAHLIA_TYPE.id]: dahliaControls,
    [ROSE_TYPE.id]: roseControls,
  }), [dahliaControls, roseControls]);

  // Live color ranges are applied by the flower batch without rebuilding stems.
  const flowerColorVariationById = useMemo(() => ({
    [DAHLIA_TYPE.id]: {
      hueRange: dahliaControls.hueRange
        ?? DAHLIA_TYPE.materialDefaults?.colorVariation?.hueRange
        ?? 0,
      lightRange: dahliaControls.lightRange
        ?? DAHLIA_TYPE.materialDefaults?.colorVariation?.lightRange
        ?? 0,
    },
    [ROSE_TYPE.id]: {
      hueRange: roseControls.hueRange
        ?? ROSE_TYPE.materialDefaults?.colorVariation?.hueRange
        ?? 0,
      lightRange: roseControls.lightRange
        ?? ROSE_TYPE.materialDefaults?.colorVariation?.lightRange
        ?? 0,
    },
  }), [
    dahliaControls.hueRange,
    dahliaControls.lightRange,
    roseControls.hueRange,
    roseControls.lightRange,
  ]);

  const shedControls = useMemo(
    () => ({ shedRise, shedRiseVariance, shedSpread, shedStagger }),
    [shedRise, shedRiseVariance, shedSpread, shedStagger],
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

  const resolvedHeadLocal = useMemo(() => {
    const box = bodyBounds?.localBox;
    const cx = box ? (box.min.x + box.max.x) * 0.5 : 0;
    const cz = box ? (box.min.z + box.max.z) * 0.5 : 0;
    const base = bodyBounds?.headLocal;
    return {
      x: base?.x ?? cx,
      y: base?.y ?? 0,
      z: base?.z ?? cz,
      found: Boolean(base),
    };
  }, [bodyBounds]);

  const compositionGuide = useMemo(() => {
    const box = bodyBounds?.localBox;
    const cx = box ? (box.min.x + box.max.x) * 0.5 : 0;
    const cz = box ? (box.min.z + box.max.z) * 0.5 : 0;
    const halfX = box ? (box.max.x - box.min.x) * 0.5 : effectiveSpread * 0.35;
    const halfZ = box ? (box.max.z - box.min.z) * 0.5 : effectiveSpread * 0.35;
    const nearR = Math.max(0.05, Math.min(halfX, halfZ) * 0.35);
    const farR = Math.max(effectiveSpread, Math.hypot(halfX, halfZ) + 0.6);
    return {
      center: [cx, cz],
      nearR,
      farR,
      headLocal: resolvedHeadLocal,
    };
  }, [bodyBounds, effectiveSpread, resolvedHeadLocal]);

  const { stems, slotPool } = useMemo(() => {
    // Ground-vine mode is authoritative: an empty array means the vine layout
    // is still loading, not that the field should fall back to its old layout.
    if (usesGroundPaths) {
      if (!groundPaths.length) return { stems: [], slotPool: [] };
      return {
        stems: buildGroundFlowerStems({
          paths: groundPaths,
          count,
          minSpacing: minGap,
          pathRange: [0.18, 0.92],
          roseRatio,
          layoutSeed: arrangementSeed + 7001,
          roseType: ROSE_TYPE,
          dahliaType: DAHLIA_TYPE,
          maxPathDepth: 1,
          flowerBandSpread,
          bloomClusterCount,
          clusterShare,
          stemGeometry: {
            stemLength: [lenMin, lenMax],
            stemRadius: [radMin, radMax],
            leanAngle: [leanMin, leanMax],
            bendDegree: [bendMin, bendMax],
            radiusAttenuation: [taperMin, taperMax],
            baseFlare: [flareMin, flareMax],
          },
        }),
        slotPool: [],
      };
    }

    // Wait for posed MeshBVH before planting.
    if (!bvh) return { stems: [], slotPool: [] };

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
    // Wider near band = denser contact clustering on the suit silhouette.
    const nearR = Math.max(0.05, Math.min(halfX, halfZ) * 0.35);
    const farR = Math.max(effectiveSpread, Math.hypot(halfX, halfZ) + 0.6);
    const head = resolvedHeadLocal;
    const densPow = Math.max(contactPow, 1);

    // Generate MORE validated slots than live plants: the extras are the pool a
    // plant hops to when it respawns, so a rebirth never lands in the same spot.
    const poolFactor = Math.max(1, Math.round(slotFactor ?? 1));
    const poolTotal = count * poolFactor;

    const slots = [];
    let attempts = 0;
    const maxAttempts = poolTotal * 24;

    for (; slots.length < poolTotal && attempts < maxAttempts; attempts += 1) {
      const ringT = poolTotal <= 1 ? 0 : (slots.length / Math.max(poolTotal - 1, 1));
      const angleJit = slots.length === 0
        ? 0
        : stableRandomRange(attempts, S_ANG_JIT, arrangementSeed, -maxAngleJit, maxAngleJit);
      const radScale = slots.length === 0
        ? 1
        : stableRandomRange(attempts, S_RAD_JIT, arrangementSeed, 1 - maxRadJit, 1 + maxRadJit);

      const angle = attempts * GOLDEN_ANGLE + fieldSpin + angleJit;
      // Higher contactPow packs more stems into the near band; rim stays looser.
      const r = (nearR + Math.pow(ringT, densPow) * (farR - nearR)) * radScale;
      let posX = cx + Math.cos(angle) * r;
      let posZ = cz + Math.sin(angle) * r;

      const [cxPos, czPos, ok] = clearPointFromBvh(
        posX, posZ, bvh, clearMargin, CLEAR_HEIGHTS,
      );
      if (!ok) continue;
      posX = cxPos;
      posZ = czPos;

      // Quiet pocket around helmet / face.
      if (faceClearRadius > 0) {
        const [fx, fz] = clearPointFromDisc(
          posX, posZ, head.x, head.z, faceClearRadius,
        );
        // Re-check mesh clearance after face push.
        const [px2, pz2, ok2] = clearPointFromBvh(
          fx, fz, bvh, clearMargin, CLEAR_HEIGHTS,
        );
        if (!ok2) continue;
        posX = px2;
        posZ = pz2;
        // Still inside face disc after mesh push → skip.
        if (Math.hypot(posX - head.x, posZ - head.z) < faceClearRadius * 0.92) {
          continue;
        }
      }

      // Distance from the body drives the bloom size hierarchy, and it is what a
      // respawning plant matches on so its baked size still suits the new spot.
      const distC = Math.hypot(posX - cx, posZ - cz);
      const rimT = Math.min(1, Math.max(0, (distC - nearR) / Math.max(farR - nearR, 1e-4)));

      slots.push({
        x: posX,
        z: posZ,
        rimT,
        leanOutwardAngle: Math.atan2(posX - cx, posZ - cz),
      });
    }

    // Live plants take every Nth slot so they still span the full near→rim range
    // (taking the first `count` would bunch them all in the inner band).
    const stride = Math.max(1, Math.floor(slots.length / Math.max(count, 1)));
    const out = [];
    for (let k = 0; k < count; k += 1) {
      const slotIndex = k * stride;
      const slot = slots[slotIndex];
      if (!slot) break;

      const typeRoll = stableRandomRange(slotIndex, S_TYPE, arrangementSeed, 0, 1);
      const flowerType = typeRoll < roseRatio ? ROSE_TYPE : DAHLIA_TYPE;
      // Bloom size hierarchy: smaller near the body, fuller toward the rim.
      const sizeMul = nearSizeMin + (1 - nearSizeMin) * Math.pow(slot.rimT, 0.65);

      out.push({
        position: [slot.x, 0, slot.z],
        leanOutwardAngle: slot.leanOutwardAngle,
        slotIndex,
        rimT: slot.rimT,
        seed: slotIndex * 13 + 1 + arrangementSeed * 17,
        flowerType,
        colorVariationUnit: {
          hue: stableRandomRange(slotIndex, S_HUE, arrangementSeed, -1, 1),
          light: stableRandomRange(slotIndex, S_LIGHT, arrangementSeed, -1, 1),
        },
        params: randomParams(
          slotIndex, arrangementSeed,
          lenMin, lenMax, radMin, radMax, leanMin, leanMax,
          bendMin, bendMax, taperMin, taperMax, flareMin, flareMax,
          sizeMul,
        ),
      });
    }

    return { stems: out, slotPool: slots };
  }, [usesGroundPaths, groundPaths, count, minGap, flowerBandSpread,
    bloomClusterCount, clusterShare,
    effectiveSpread, arrangementSeed, positionJitter, roseRatio, slotFactor,
    bvh, clearMargin, faceClearRadius, contactPow, nearSizeMin,
    boundsVersion, bodyBounds, resolvedHeadLocal,
    lenMin, lenMax, radMin, radMax, leanMin, leanMax,
    bendMin, bendMax, taperMin, taperMax, flareMin, flareMax]);

  useEffect(() => {
    if (!groundFlowerTimingRef) return;
    const durationByTreeId = new Map();
    const generationByTreeId = new Map();
    for (const stem of stems) {
      if (!stem.sourceTreeId) continue;
      const generation = stem.sourceTreeGeneration ?? 0;
      const duration = lifecycleLength(computeDurations(
        stem.seed + generation * 131,
        lifecycleRanges,
      ));
      generationByTreeId.set(stem.sourceTreeId, generation);
      durationByTreeId.set(
        stem.sourceTreeId,
        Math.max(durationByTreeId.get(stem.sourceTreeId) ?? 0, duration),
      );
    }
    groundFlowerTimingRef.current = {
      ready: true,
      maxDuration: delayMax + growMax + keepMax + dieMax,
      treeIds: new Set(
        stems.map((stem) => stem.sourceTreeId).filter(Boolean),
      ),
      durationByTreeId,
      generationByTreeId,
    };
  }, [
    groundFlowerTimingRef,
    stems,
    lifecycleRanges,
    delayMax,
    growMax,
    keepMax,
    dieMax,
  ]);

  useEffect(() => {
    if (!onStemBases) return;
    // Report every spawn slot, not just the occupied ones — a plant can respawn
    // into any of them, and ground foliage must already be cleared there.
    const bases = !usesGroundPaths && reshuffleOnRespawn
      ? slotPool.map((s) => ({ x: s.x, z: s.z }))
      : stems.map((s) => ({ x: s.position[0], z: s.position[2] }));
    onStemBases(bases);
  }, [stems, slotPool, reshuffleOnRespawn, usesGroundPaths, onStemBases]);

  const groundLifecycleGate = useCallback(
    (plant) => !usesGroundPaths
      || Boolean(groundCompletedTreesRef?.current?.has(plant.sourceTreeId)),
    [usesGroundPaths, groundCompletedTreesRef],
  );

  return (
    <group
      position={[
        position[0],
        position[1] + (usesGroundPaths ? groundOffsetY : 0),
        position[2],
      ]}
    >
      <BodyBoundsDebug
        geometry={bodyBounds?.geometry ?? null}
        visible={Boolean(showDebug && surroundEnabled && bodyBounds?.geometry)}
        depth={bvhDepth}
      />
      <CompositionDebug
        visible={Boolean(showCompositionDebug && surroundEnabled)}
        center={compositionGuide.center}
        headLocal={compositionGuide.headLocal}
        faceClearRadius={faceClearRadius}
        nearR={compositionGuide.nearR}
        farR={compositionGuide.farR}
        nearSizeMin={nearSizeMin}
        clearMargin={clearMargin}
      />
      <PlantSystem
        stems={stems}
        slotPool={slotPool}
        reshuffleOnRespawn={usesGroundPaths ? false : reshuffleOnRespawn}
        leanOut={leanOut}
        phaseSpread={phaseSpread}
        stemSegments={stemSegments}
        radialSegs={radialSegs}
        stemYMax={stemYMax}
        bloomStart={bloomStart}
        bloomFrac={bloomFrac}
        petalShedFrac={petalShedFrac}
        shedStemOverlap={shedStemOverlap}
        shedControls={shedControls}
        lifecycleRanges={lifecycleRanges}
        lifecyclePausedRef={lifecyclePausedRef}
        lifecycleGate={groundLifecycleGate}
        treeLifecycleRef={usesGroundPaths ? groundTreeLifecycleRef : null}
        flowerTimingRef={usesGroundPaths ? groundFlowerTimingRef : null}
        routeRegistryRef={usesGroundPaths ? groundRouteRegistryRef : null}
        flowerControlsById={flowerControlsById}
        flowerColorVariationById={flowerColorVariationById}
        stemLookControls={stemLookControls}
        leafControls={leafControls}
        wind={wind}
      />
    </group>
  );
}
