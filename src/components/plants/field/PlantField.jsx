import { useEffect, useMemo, useRef } from 'react';
import { useControls } from 'leva';
import { stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../look/flowerControls';
import { clearPointFromDisc, clearPointFromHosts } from './bodyBounds';
import { buildAnchorClusterSlots } from './fieldClusterLayout';
import { deriveFieldAnchors } from './fieldAnchors';
import { createFieldControlsSchema } from './fieldControls';
import { setSimSpeed } from '../lifecycle/simSpeed';
import { FIELD_DEFAULTS } from './fieldDefaults';
import { createStemSchema } from '../stem/stemControls';
import { STEM_DEFAULTS } from '../stem/stemDefaults';
import { useLifecyclePauseHotkey } from '../lifecycle/useLifecyclePauseHotkey';
import { PlantSystem } from './PlantSystem';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { BodyBoundsDebug } from '../../scene/BodyBoundsDebug';
import { CompositionDebug } from './CompositionDebug';
import { PLANT_WIND_DEFAULTS } from '../wind/plantWind';

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
const S_ROLE_SIZE = 18;
const S_BLOOM = 19;
const S_HEIGHT = 22;

/**
 * Long-tailed height. Most stems stay low and a few reach right up, because a
 * uniform range gives every stem a similar height and the side view collapses
 * into a mat. The bias exponent is what makes tall stems rare rather than average.
 */
const HEIGHT_MIN = 0.6;
const HEIGHT_MAX = 1.95;
const HEIGHT_BIAS = 2.6;

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
const ROLE_ID = { primary: 0, secondary: 1, echo: 2 };

/** Heights (field local Y) sampled for closest-point vs the lying suit. */
const CLEAR_HEIGHTS = [0.05, 0.2, 0.4, 0.7, 1.0, 1.35];

/**
 * `sizeMul` scales the flower HEAD (via stemRadius, which is what `scaleMuls`
 * reads). `heightMul` scales the stem only.
 *
 * They were one variable, which welded tall to large — so height varied only as
 * much as head size did, and from a grazing camera the whole field read as a flat
 * mat. Splitting them is what lets a tall thin stem carry the silhouette while a
 * dense core still holds the largest blooms.
 */
function randomParams(i, seed, lenMin, lenMax, radMin, radMax, leanMin, leanMax,
  bendMin, bendMax, taperMin, taperMax, flareMin, flareMax, sizeMul = 1,
  heightMul = 1) {
  return {
    stemLength: stableRandomRange(i, S_LENGTH, seed, lenMin, lenMax) * heightMul,
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
  // Keep-out only for now. The field is still centred on the body; the backpack
  // becomes a layout anchor in its own right in a later phase.
  backpackBounds = null,
  onStemBases,
  wind = PLANT_WIND_DEFAULTS,
}) {
  const lifecyclePausedRef = useLifecyclePauseHotkey();

  const fieldSchema = useMemo(() => createFieldControlsSchema(), []);
  const {
    count, spreadRadius, leanOut, phaseSpread, arrangementSeed, simSpeed,
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
    layoutMode,
    showAnchors,
    showAnchorField,
    fieldFlat,
    fieldThreshold,
    fieldResolution,
    anchorReach,
    edgeNoiseAmount,
    edgeNoiseFrequency,
    warpAmount,
    warpFrequency,
    gapAmount,
    gapFrequency,
    founderShare,
    hopRange,
    primaryCount,
    migrateDist,
    migrateSpeed,
    migrateThreshold,
    delay: [delayMin, delayMax],
    grow: [growMin, growMax],
    keep: [keepMin, keepMax],
    die: [dieMin, dieMax],
  } = useControls('Field', fieldSchema, { collapsed: true });

  // The rate lives in a module-level ref shared with the climbers and the
  // standalone stems, so it is pushed rather than passed down.
  useEffect(() => { setSimSpeed(simSpeed); }, [simSpeed]);

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
  // Both hosts sit on the ground the flowers grow from, so both must be cleared
  // or stems plant straight through the backpack.
  const clearanceHosts = useMemo(() => (
    surroundEnabled
      ? [bodyBounds, backpackBounds]
        .filter((host) => host?.bvh)
        .map((host) => ({ bvh: host.bvh, localBox: host.localBox }))
      : []
  ), [surroundEnabled, bodyBounds, backpackBounds]);
  // `spreadRadius` directly. A `max(spreadRadius, minGap * sqrt(count))` term used
  // to sit here, fed by a `min gap` knob — but nothing in the layout enforces a
  // minimum flower separation, so all that term did was silently raise the size
  // ramp radius once minGap crossed ~0.185. Misnamed, undocumented in effect, and
  // filed as spiral-only when it applied to both layouts. Removed outright.
  const effectiveSpread = spreadRadius;

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

  // Anchors are derived but NOT yet consumed by the layout — this phase exists so
  // a bad anchor set is visible before the sampler depends on it. Keyed only on
  // the bounds version and the anchor knobs, so scrubbing `count` or
  // `positionJitter` never re-probes the BVH.
  const anchorSet = useMemo(() => {
    if (!bvh || !bodyBounds?.capsules?.length) {
      return { anchors: [], diagnostics: { found: 0, expected: 0, issues: [] } };
    }
    return deriveFieldAnchors({
      capsules: bodyBounds.capsules,
      bodyRight: bodyBounds.bodyRight,
      backpackBox: backpackBounds?.localBox ?? null,
      hosts: clearanceHosts,
      clearMargin,
      reachScale: anchorReach,
    });
  }, [
    bvh, clearanceHosts, boundsVersion, bodyBounds, backpackBounds, clearMargin,
    anchorReach,
  ]);

  // Relative bloom size per role, for the debug legend. Radial base is held at
  // mid-field so the legend isolates the ROLE factor, and it lives here because
  // this is where the constants are — the debug view previously re-derived the
  // formula and went stale silently.
  const sizeLegend = useMemo(() => {
    const base = nearSizeMin + (1 - nearSizeMin) * Math.pow(0.5, 0.65);
    return {
      echo: base * Math.pow(DEPTH_SIZE_DECAY, 6),
      secondary: base,
      primary: base * PRIMARY_SIZE_BOOST,
    };
  }, [nearSizeMin]);

  const anchorFieldOptions = useMemo(() => ({
    edgeNoiseAmount,
    edgeNoiseFrequency,
    warpAmount,
    warpFrequency,
    gapAmount,
    gapFrequency,
    seed: arrangementSeed,
    // Hard keep-out, so the visualized field cannot promise density on a limb
    // that the clearance chain would reject.
    hosts: clearanceHosts,
    clearMargin,
  }), [
    edgeNoiseAmount, edgeNoiseFrequency, warpAmount, warpFrequency,
    gapAmount, gapFrequency, arrangementSeed, clearanceHosts, clearMargin,
  ]);

  // Same field, minus the BVH keep-out. The sampler pushes candidates out of the
  // mesh instead of discarding them, so paying for closest-point queries inside
  // its accept/reject roll would be pure waste.
  // Everything PlantSystem needs to weight a respawning plant toward wherever the
  // field has drifted to. Sampled only on respawn, never per plant per frame.
  // Null in spiral mode or when migration is off, in which case respawn falls back
  // to a uniform pick inside the cluster.
  const migration = useMemo(() => {
    if (layoutMode !== 'anchors' || !(migrateDist > 0) || !anchorSet.anchors.length) {
      return null;
    }
    return {
      anchors: anchorSet.anchors,
      options: {
        edgeNoiseAmount,
        edgeNoiseFrequency,
        warpAmount,
        warpFrequency,
        gapAmount,
        gapFrequency,
        seed: arrangementSeed,
        migrateDist,
        migrateSpeed,
      },
      threshold: migrateThreshold,
    };
  }, [
    layoutMode, anchorSet, edgeNoiseAmount, edgeNoiseFrequency, warpAmount,
    warpFrequency, gapAmount, gapFrequency, arrangementSeed, migrateDist,
    migrateSpeed, migrateThreshold,
  ]);

  const anchorSamplerOptions = useMemo(() => ({
    edgeNoiseAmount,
    edgeNoiseFrequency,
    warpAmount,
    warpFrequency,
    gapAmount,
    gapFrequency,
    seed: arrangementSeed,
  }), [
    edgeNoiseAmount, edgeNoiseFrequency, warpAmount, warpFrequency,
    gapAmount, gapFrequency, arrangementSeed,
  ]);

  // Surfaces derivation problems that are otherwise invisible: an anchor whose
  // inner ring is buried in the suit would push every candidate out to the same
  // silhouette contour and look exactly like the spiral it replaced.
  useEffect(() => {
    const { issues, found, expected } = anchorSet.diagnostics;
    if (!expected) return;
    // Positions are the thing you cannot read off a screenshot, and every
    // rebalance decision depends on them.
    // Positions only when the overlay is on: useful when tuning, noise otherwise.
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

  const { stems, slotPool } = useMemo(() => {
    // Wait for posed MeshBVH before planting.
    if (!bvh) return { stems: [], slotPool: [] };

    // Roles come out of the dispersal tree rather than a separate rule: a
    // founder is a primary, its first offspring a secondary, deeper generations
    // the quiet echoes.
    //
    // But primaries are capped SCENE-WIDE, not per anchor. Every cluster having
    // its own focal flower averages the image back out to uniform — the same
    // failure as even spacing, one level up. Founders beyond the cap stay as
    // dispersal seeds and simply read as secondaries.
    /**
     * Allocated round-robin across anchors so the cap spreads over clusters
     * rather than going entirely to whichever anchor comes first. Takes the slots
     * as arguments because it can only run AFTER sampling.
     */
    /**
     * Role from LOCAL DENSITY, not dispersal depth.
     *
     * Depth was an artifact of tree traversal order with no relationship to the
     * field. Ranking by the density each flower actually stands in makes the
     * hierarchy causal, and makes the answer to "why does the farthest flower
     * exist" literally true: it is the last echo at the edge of a mass.
     *
     * Percentile-based rather than absolute thresholds, so it adapts when the field
     * knobs change instead of needing re-tuning.
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
      // The radial ramp stays the base and roles modulate it. With primaries this
      // rare the ramp carries most of the size variation, so replacing it would
      // flatten the field into three discrete sizes.
      const radialBase = nearSizeMin + (1 - nearSizeMin) * Math.pow(slot.rimT, 0.65);
      const sizeJit = stableRandomRange(slotIndex, S_ROLE_SIZE, arrangementSeed, -0.08, 0.08);
      const depth = slot.generation ?? 0;
      const sizeMul = radialBase
        * Math.pow(DEPTH_SIZE_DECAY, depth)
        * (role === 'primary' ? PRIMARY_SIZE_BOOST : 1)
        * (1 + sizeJit);
      // Independent of size on purpose, so tall does not imply large.
      const heightU = stableRandomRange(slotIndex, S_HEIGHT, arrangementSeed, 0, 1);
      const heightMul = HEIGHT_MIN
        + (HEIGHT_MAX - HEIGHT_MIN) * Math.pow(heightU, HEIGHT_BIAS);
      // Bloom ceiling scales the VAT frame, so an echo stays a bud or half-open
      // however long it lives. Clamped so nothing reads as a bare stick.
      const bloomJit = stableRandomRange(slotIndex, S_BLOOM, arrangementSeed, -0.05, 0.05);
      // Also depth-driven: a clump core opens fully while its fringe stays budded,
      // which is the multi-scale read without needing any extra geometry.
      // Density-driven, not depth-driven: a flower is budded because it stands at
      // the fringe of a mass, not because a traversal counter reached 2.
      const density = slot.fieldValue ?? 0;
      const bloomCeiling = Math.min(1, Math.max(
        MIN_BLOOM,
        MIN_BLOOM + (1 - MIN_BLOOM) * Math.pow(density, BLOOM_DENSITY_POW) + bloomJit,
      ));
      return {
        position: [slot.x, 0, slot.z],
        leanOutwardAngle: slot.leanOutwardAngle,
        slotIndex,
        rimT: slot.rimT,
        // Metadata for later phases; nothing reads these yet.
        anchorId: slot.anchorId,
        anchorIndex: slot.anchorIndex,
        role,
        generation: slot.generation,
        bloomCeiling,
        // Anchor + role identity, so a respawning plant can only take a slot from
        // its own cluster and band.
        // Already stamped on the slot above; read it back so the two can never drift.
        groupKey: slot.groupKey ?? ((slot.anchorIndex ?? 0) * 8 + (ROLE_ID[role] ?? 1)),
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
          heightMul,
        ),
      };
    };

    if (layoutMode === 'anchors' && anchorSet.anchors.length) {
      const { slots: anchorSlotsRaw, liveIndices: anchorLiveRaw, diagnostics } = buildAnchorClusterSlots({
        // Live slots go against the TRUE field, so the composition opens tight to
        // the masses as drawn. Only the respawn spares use the inflated envelope —
        // they have to already exist where the drift is heading, since nothing
        // rebuilds the pool at runtime. These were both the envelope until the
        // migration gate was removed; with no gate hiding the margin, live slots out
        // there just read as a vague halo around every mass.
        anchors: anchorSet.anchors,
        envelopeAnchors: migrateDist > 0
          ? anchorSet.anchors.map((a) => ({ ...a, radius: a.radius + migrateDist }))
          : anchorSet.anchors,
        variantSpread: migrateDist,
        count,
        slotFactor,
        clearanceHosts,
        clearMargin,
        clearHeights: CLEAR_HEIGHTS,
        head: resolvedHeadLocal,
        faceClearRadius,
        bodyCenter: compositionGuide.center,
        nearR: compositionGuide.nearR,
        farR: compositionGuide.farR,
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
          `[PlantField] anchor layout short by ${diagnostics.shortfall} of ${count}`
          + ` (${diagnostics.attempts} attempts) — widen reach or lower count`,
        );
      }
      const classes = classifyByDensity(anchorSlotsRaw, anchorLiveRaw, primaryCount);

      // Stamp the respawn bucket onto every SLOT, not just the live stems.
      // PlantSystem buckets free slots by `slot.groupKey`; writing it only onto the
      // stem meant every free slot fell into bucket -1 while every plant looked for
      // a bucket >= 0, so the reshuffle silently never fired.
      for (let si = 0; si < anchorSlotsRaw.length; si += 1) {
        const slot = anchorSlotsRaw[si];
        // A variant inherits its owner's role: it is a short hop away, so it sits in
        // comparable density, and it must share the bucket to be a valid target.
        const roleIndex = slot.ownerSlot >= 0 ? slot.ownerSlot : si;
        const role = roleOf(roleIndex, classes);
        slot.groupKey = (slot.anchorIndex ?? 0) * 8 + (ROLE_ID[role] ?? 1);
      }
      return {
        stems: anchorLiveRaw.map(
          (slotIndex) => buildStem(anchorSlotsRaw[slotIndex], slotIndex, classes),
        ),
        slotPool: anchorSlotsRaw,
      };
    }

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

      const [cxPos, czPos, ok] = clearPointFromHosts(
        posX, posZ, clearanceHosts, clearMargin, CLEAR_HEIGHTS,
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
        const [px2, pz2, ok2] = clearPointFromHosts(
          fx, fz, clearanceHosts, clearMargin, CLEAR_HEIGHTS,
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
  }, [layoutMode, anchorSet, anchorSamplerOptions, compositionGuide,
    // migrateDist sizes the spare envelope, and was missing here: the pool was
    // built once at mount and never rebuilt, so dragging `migrate range` changed
    // the drift while the slots it needed to move into stayed put.
    founderShare, hopRange, primaryCount, migrateDist,
    count, effectiveSpread, arrangementSeed, positionJitter, roseRatio, slotFactor,
    bvh, clearanceHosts, clearMargin, faceClearRadius, contactPow, nearSizeMin,
    boundsVersion, bodyBounds, resolvedHeadLocal,
    lenMin, lenMax, radMin, radMax, leanMin, leanMax,
    bendMin, bendMax, taperMin, taperMax, flareMin, flareMax]);

  useEffect(() => {
    if (!onStemBases) return;
    // Report every spawn slot, not just the occupied ones — a plant can respawn
    // into any of them, and ground foliage must already be cleared there.
    const bases = reshuffleOnRespawn
      ? slotPool.map((s) => ({ x: s.x, z: s.z }))
      : stems.map((s) => ({ x: s.position[0], z: s.position[2] }));
    onStemBases(bases);
  }, [stems, slotPool, reshuffleOnRespawn, onStemBases]);

  return (
    <group position={position}>
      <BodyBoundsDebug
        geometry={bodyBounds?.geometry ?? null}
        // Needs the baked BVH, but NOT the keep-out toggle: a debug switch should
        // show what it says it shows.
        visible={Boolean(showDebug && bodyBounds?.geometry)}
        depth={bvhDepth}
      />
      <CompositionDebug
        visible={Boolean(showCompositionDebug || showAnchors || showAnchorField)}
        anchors={anchorSet.anchors}
        // Passed in, never re-derived. The old version duplicated the size formula
        // and silently went stale the moment depth decay and the primary boost were
        // added — it was under-reporting echo size by ~3x.
        sizeLegend={sizeLegend}
        showGuides={showCompositionDebug}
        showAnchors={showAnchors}
        showAnchorField={showAnchorField}
        fieldFlat={fieldFlat}
        fieldThreshold={fieldThreshold}
        fieldResolution={fieldResolution}
        fieldOptions={anchorFieldOptions}
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
        reshuffleOnRespawn={reshuffleOnRespawn}
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
        migration={migration}
        lifecyclePausedRef={lifecyclePausedRef}
        flowerControlsById={flowerControlsById}
        flowerColorVariationById={flowerColorVariationById}
        stemLookControls={stemLookControls}
        leafControls={leafControls}
        wind={wind}
      />
    </group>
  );
}
