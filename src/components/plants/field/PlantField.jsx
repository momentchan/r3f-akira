import { useEffect, useMemo } from 'react';
import { useControls } from 'leva';
import { stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../look/flowerControls';
import { buildAnchorClusterSlots, DEFAULT_HOP_DECAY } from './fieldClusterLayout';
import { deriveFieldAnchors } from './fieldAnchors';
import { createFieldControlsSchema } from './fieldControls';
import { FIELD_DEFAULTS } from './fieldDefaults';
import { createStemSchema } from '../stem/stemControls';
import { STEM_DEFAULTS } from '../stem/stemDefaults';
import { useLifecyclePauseHotkey } from '../lifecycle/useLifecyclePauseHotkey';
import { PlantSystem } from './PlantSystem';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { BodyBoundsDebug } from '../../scene/BodyBoundsDebug';
import { CompositionDebug } from './CompositionDebug';
import { PLANT_WIND_DEFAULTS } from '../wind/plantWind';

const DAHLIA_TYPE = FLOWER_TYPES.find((t) => t.id === 'dahlia');
const ROSE_TYPE = FLOWER_TYPES.find((t) => t.id === 'rose');

[DAHLIA_TYPE, ROSE_TYPE].forEach(({ metaUrl, lodMetaUrl }) => {
  preloadVATAssets(metaUrl);
  if (lodMetaUrl) preloadVATAssets(lodMetaUrl);
});

const S_RADIUS = 1;
const S_LEAN = 2;
const S_BEND = 3;
const S_TAPER = 4;
const S_FLARE = 5;
const S_TYPE = 6;
const S_HUE = 7;
const S_LIGHT = 8;
const S_ROLE_SIZE = 18;
const S_BLOOM = 19;
const S_HEIGHT = 22;

/**
 * Size and bloom decay CONTINUOUSLY with dispersal depth rather than snapping to
 * three role buckets. Three buckets read as three sizes; a continuous decay reads
 * as one plant — a large bloom at the core of each clump with progressively
 * smaller, tighter ones packed around it.
 */
const DEPTH_SIZE_DECAY = 0.88;
/** The few the eye lands on get a boost on top of being founders. */
const PRIMARY_SIZE_BOOST = 1.35;
/** Frame 0 is a closed bud, so a floor here keeps a fringe bloom from vanishing. */
const MIN_BLOOM = 0.32;
/** Lower = fringe flowers close up faster as density drops. */
const BLOOM_DENSITY_POW = 0.75;
/** Minimum world distance between two primaries, so they never merge visually. */
const PRIMARY_SEPARATION = 0.55;
/** Share of the non-primary field promoted to secondary; the remainder are echoes. */
const SECONDARY_SHARE = 0.34;

/** Heights (field local Y) sampled for closest-point vs the lying suit. */
const CLEAR_HEIGHTS = [0.05, 0.2, 0.4, 0.7, 1.0, 1.35];

/**
 * `sizeMul` scales the flower HEAD (via stemRadius). Stem length is passed in
 * already rolled, so tall does not imply large.
 */
function randomParams(i, seed, radMin, radMax, leanMin, leanMax,
  bendMin, bendMax, taperMin, taperMax, flareMin, flareMax, sizeMul, stemLength) {
  return {
    stemLength,
    stemRadius: stableRandomRange(i, S_RADIUS, seed, radMin, radMax) * sizeMul,
    leanAngle: stableRandomRange(i, S_LEAN, seed, leanMin, leanMax),
    bendDegree: stableRandomRange(i, S_BEND, seed, bendMin, bendMax),
    radiusAttenuation: stableRandomRange(i, S_TAPER, seed, taperMin, taperMax),
    baseFlare: stableRandomRange(i, S_FLARE, seed, flareMin, flareMax),
  };
}


export function PlantField({
  position = [0, 0, 0],
  bodyBounds = null,
  backpackBounds = null,
  onStemBases,
  wind = PLANT_WIND_DEFAULTS,
  cullControls = null,
}) {
  const lifecyclePausedRef = useLifecyclePauseHotkey();

  const fieldSchema = useMemo(() => createFieldControlsSchema(), []);
  const {
    flowerCount, leanOutward, initialPhaseSpread, arrangementSeed,
    roseRatio,
    petalShedFrac, shedStemOverlap,
    shedRise, shedRiseVariance, shedSpread, shedStagger,
    clearBody,
    bvhHelper,
    meshClearDistance,
    faceClearRadius,
    bvhHelperDepth,
    showAnchors,
    densityField,
    gridResolution,
    reachScale,
    shapeWarp,
    warpScale,
    barePatches,
    patchScale,
    founderShare,
    hopRange,
    primaryCount,
    migrateRange,
    migrateSpeed,
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
    lengthExp,
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
  const bvh = clearBody ? bodyBounds?.bvh : null;
  // Both hosts sit on the ground the flowers grow from, so both must be cleared
  // or stems plant straight through the backpack.
  const clearanceHosts = useMemo(() => (
    clearBody
      ? [bodyBounds, backpackBounds]
        .filter((host) => host?.bvh)
        .map((host) => ({ bvh: host.bvh, localBox: host.localBox }))
      : []
  ), [clearBody, bodyBounds, backpackBounds]);

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
    return {
      center: [cx, cz],
      headLocal: resolvedHeadLocal,
    };
  }, [bodyBounds, resolvedHeadLocal]);

  // Keyed only on the bounds version and the anchor knobs, so scrubbing
  // `flowerCount` never re-probes the BVH.
  const anchorSet = useMemo(() => {
    if (!bvh || !bodyBounds?.capsules?.length) {
      return { anchors: [], diagnostics: { found: 0, expected: 0, issues: [] } };
    }
    return deriveFieldAnchors({
      capsules: bodyBounds.capsules,
      bodyRight: bodyBounds.bodyRight,
      backpackBox: backpackBounds?.localBox ?? null,
      hosts: clearanceHosts,
      clearMargin: meshClearDistance,
      reachScale,
    });
  }, [
    bvh, clearanceHosts, boundsVersion, bodyBounds, backpackBounds, meshClearDistance,
    reachScale,
  ]);

  const anchorFieldOptions = useMemo(() => ({
    shapeWarp,
    warpScale,
    barePatches,
    patchScale,
    seed: arrangementSeed,
    // Hard keep-out, so the visualized field cannot promise density on a limb
    // that the clearance chain would reject.
    hosts: clearanceHosts,
    meshClearDistance,
  }), [
    shapeWarp, warpScale,
    barePatches, patchScale, arrangementSeed, clearanceHosts, meshClearDistance,
  ]);

  // Runtime hearts + death-time pick. PlantSystem wanders each founder heart
  // on a clock, then a dying flower chooses among them by field × distance
  // and hops. Null when there are no anchors.
  const migration = useMemo(() => {
    if (!anchorSet.anchors.length) return null;
    return {
      anchors: anchorSet.anchors,
      options: {
        shapeWarp,
        warpScale,
        barePatches,
        patchScale,
        seed: arrangementSeed,
        migrateRange,
        migrateSpeed,
        hosts: clearanceHosts,
        meshClearDistance,
      },
      clearanceHosts,
      meshClearDistance,
      clearHeights: CLEAR_HEIGHTS,
      head: resolvedHeadLocal,
      faceClearRadius,
      bodyCenter: compositionGuide.center,
      hopMin: Math.min(hopRange[0], hopRange[1]),
      hopMax: Math.max(hopRange[0], hopRange[1]),
      hopDecay: DEFAULT_HOP_DECAY,
    };
  }, [
    anchorSet, shapeWarp,
    warpScale, barePatches, patchScale, arrangementSeed, migrateRange,
    migrateSpeed, clearanceHosts, meshClearDistance,
    resolvedHeadLocal, faceClearRadius, compositionGuide, hopRange,
  ]);

  const anchorSamplerOptions = useMemo(() => ({
    shapeWarp,
    warpScale,
    barePatches,
    patchScale,
    seed: arrangementSeed,
    hosts: clearanceHosts,
    meshClearDistance,
  }), [
    shapeWarp, warpScale,
    barePatches, patchScale, arrangementSeed, clearanceHosts, meshClearDistance,
  ]);

  // Surfaces derivation problems that are otherwise invisible: an anchor whose
  // inner ring is buried in the suit would push every candidate out to the same
  // silhouette contour and look exactly like the spiral it replaced.
  useEffect(() => {
    const { issues, found, expected } = anchorSet.diagnostics;
    if (!expected) return;
    // Positions are the thing you cannot read off a screenshot, and every
    // rebalance decision depends on them — but only while the overlay is on,
    // since they are noise otherwise.
    if (showAnchors && anchorSet.anchors.length) {
      console.info(`[PlantField] anchors ${found}/${expected}`);
      for (const a of anchorSet.anchors) {
        console.info(
          `  ${a.id} src=${a.sourceId}`
          + ` at(${a.x.toFixed(2)}, ${a.z.toFixed(2)})`
          + ` w=${a.weight.toFixed(2)} inner=${a.inner.toFixed(2)} reach=${a.radius.toFixed(2)}`,
        );
      }
    }
    if (issues.length) {
      console.warn(
        `[PlantField] anchors ${found}/${expected}`,
        issues.map((i) => (i.reason === 'buried'
          ? `${i.id}:buried at(${i.at}) start=${i.startInner} reach=${i.reach} best=${i.bestClear}`
          : `${i.id}:${i.reason}`)).join(' | '),
      );
    }
  }, [anchorSet, showAnchors]);

  const { stems } = useMemo(() => {
    // Wait for posed MeshBVH before planting.
    if (!bvh) return { stems: [] };

    /**
     * Role from local density, capped scene-wide. One primary per cluster
     * averages the image back to uniform. Ranking by the density each flower
     * stands in keeps the hierarchy causal.
     */
    const classifyByDensity = (slotList, liveList, wanted) => {
      const ranked = liveList
        .map((li) => ({ li, f: slotList[li]?.fieldValue ?? 0 }))
        .sort((a, b) => b.f - a.f);

      // Primaries: the densest slots, but never adjacent — two focal blooms side by
      // side read as one clump, which wastes the scene-wide cap.
      const primaries = new Set();
      const taken = [];
      for (const { li } of ranked) {
        if (primaries.size >= wanted) break;
        const slot = slotList[li];
        if (!slot) continue;
        let tooClose = false;
        for (const t of taken) {
          if (Math.hypot(slot.x - t.x, slot.z - t.z) < PRIMARY_SEPARATION) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        primaries.add(li);
        taken.push(slot);
      }

      // The rest split by percentile of the same ranking.
      const rest = ranked.filter((r) => !primaries.has(r.li));
      const secondaryCut = Math.floor(rest.length * SECONDARY_SHARE);
      const secondaries = new Set(rest.slice(0, secondaryCut).map((r) => r.li));
      return { primaries, secondaries };
    };

    const roleOf = (slotIndex, classes) => {
      if (!classes) return 'secondary';
      if (classes.primaries.has(slotIndex)) return 'primary';
      return classes.secondaries.has(slotIndex) ? 'secondary' : 'echo';
    };

    const buildStem = (slot, slotIndex, classes = null) => {
      const typeRoll = stableRandomRange(slotIndex, S_TYPE, arrangementSeed, 0, 1);
      const flowerType = typeRoll < roseRatio ? ROSE_TYPE : DAHLIA_TYPE;
      const role = roleOf(slotIndex, classes);
      // Size comes from the clump, not from distance to the body: depth decay
      // (core large, fringe small) plus a rare primary boost.
      const sizeJit = stableRandomRange(slotIndex, S_ROLE_SIZE, arrangementSeed, -0.08, 0.08);
      const depth = slot.generation ?? 0;
      const sizeMul = Math.pow(DEPTH_SIZE_DECAY, depth)
        * (role === 'primary' ? PRIMARY_SIZE_BOOST : 1)
        * (1 + sizeJit);
      // Independent of size on purpose, so tall does not imply large.
      // One roll inside stemLength, biased toward min so a grazing camera
      // does not read a mat. lengthExp is how rare the max is.
      const heightU = stableRandomRange(slotIndex, S_HEIGHT, arrangementSeed, 0, 1);
      const stemLength = lenMin + (lenMax - lenMin) * Math.pow(heightU, lengthExp);
      const bloomJit = stableRandomRange(slotIndex, S_BLOOM, arrangementSeed, -0.05, 0.05);
      // Bloom ceiling scales the VAT frame, so an echo stays a bud or half-open.
      // Density-driven: a flower is budded because it stands at the fringe of a
      // mass, not because a traversal counter reached 2.
      const density = slot.fieldValue ?? 0;
      const bloomCeiling = Math.min(1, Math.max(
        MIN_BLOOM,
        MIN_BLOOM + (1 - MIN_BLOOM) * Math.pow(density, BLOOM_DENSITY_POW) + bloomJit,
      ));
      return {
        position: [slot.x, 0, slot.z],
        leanOutwardAngle: slot.leanOutwardAngle,
        slotIndex,
        anchorIndex: slot.anchorIndex,
        generation: slot.generation,
        clumpId: slot.clumpId ?? slotIndex,
        bloomCeiling,
        seed: slotIndex * 13 + 1 + arrangementSeed * 17,
        flowerType,
        colorVariationUnit: {
          hue: stableRandomRange(slotIndex, S_HUE, arrangementSeed, -1, 1),
          light: stableRandomRange(slotIndex, S_LIGHT, arrangementSeed, -1, 1),
        },
        params: randomParams(
          slotIndex, arrangementSeed,
          radMin, radMax, leanMin, leanMax,
          bendMin, bendMax, taperMin, taperMax, flareMin, flareMax,
          sizeMul,
          stemLength,
        ),
      };
    };

    if (!anchorSet.anchors.length) return { stems: [] };

    const { slots: anchorSlotsRaw, liveIndices: anchorLiveRaw, diagnostics } = buildAnchorClusterSlots({
      anchors: anchorSet.anchors,
      count: flowerCount,
      clearanceHosts,
      clearMargin: meshClearDistance,
      clearHeights: CLEAR_HEIGHTS,
      head: resolvedHeadLocal,
      faceClearRadius,
      bodyCenter: compositionGuide.center,
      arrangementSeed,
      fieldOptions: anchorSamplerOptions,
      founderShare,
      hopMin: Math.min(hopRange[0], hopRange[1]),
      hopMax: Math.max(hopRange[0], hopRange[1]),
    });
    if (diagnostics.shortfall > 0) {
      // Under-filling silently is the failure that costs an afternoon: the
      // field looks thin and the cause is invisible.
      console.warn(
        `[PlantField] anchor layout short by ${diagnostics.shortfall} of ${flowerCount}`
        + ` (${diagnostics.attempts} attempts) — widen reach or lower flowerCount`,
      );
    }
    const classes = classifyByDensity(anchorSlotsRaw, anchorLiveRaw, primaryCount);

    return {
      stems: anchorLiveRaw.map(
        (slotIndex) => buildStem(anchorSlotsRaw[slotIndex], slotIndex, classes),
      ),
    };
  }, [anchorSet, anchorSamplerOptions, compositionGuide,
    founderShare, hopRange, primaryCount,
    flowerCount, arrangementSeed, roseRatio,
    bvh, clearanceHosts, meshClearDistance, faceClearRadius,
    boundsVersion, resolvedHeadLocal,
    lenMin, lenMax, lengthExp, radMin, radMax, leanMin, leanMax,
    bendMin, bendMax, taperMin, taperMax, flareMin, flareMax]);

  useEffect(() => {
    if (!onStemBases) return;
    onStemBases(stems.map((s) => ({ x: s.position[0], z: s.position[2] })));
  }, [stems, onStemBases]);

  return (
    <group position={position}>
      <BodyBoundsDebug
        geometry={bodyBounds?.geometry ?? null}
        // Needs the baked BVH, but NOT the keep-out toggle: a debug switch should
        // show what it says it shows.
        visible={Boolean(bvhHelper && bodyBounds?.geometry)}
        depth={bvhHelperDepth}
      />
      <CompositionDebug
        visible={Boolean(showAnchors || densityField)}
        anchors={anchorSet.anchors}
        showAnchors={showAnchors}
        densityField={densityField}
        gridResolution={gridResolution}
        fieldOptions={anchorFieldOptions}
        center={compositionGuide.center}
        headLocal={compositionGuide.headLocal}
        faceClearRadius={faceClearRadius}
      />
      <PlantSystem
        stems={stems}
        leanOut={leanOutward}
        phaseSpread={initialPhaseSpread}
        stemSegments={stemSegments}
        radialSegs={radialSegs}
        stemYMax={stemYMax}
        bloomStart={bloomStart}
        bloomFrac={bloomFrac}
        petalShedFrac={petalShedFrac}
        shedStemOverlap={shedStemOverlap}
        shedControls={shedControls}
        lifecycleRanges={lifecycleRanges}
        migration={migration}
        lifecyclePausedRef={lifecyclePausedRef}
        flowerControlsById={flowerControlsById}
        flowerColorVariationById={flowerColorVariationById}
        stemLookControls={stemLookControls}
        leafControls={leafControls}
        cullControls={cullControls}
        wind={wind}
      />
    </group>
  );
}
