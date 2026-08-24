import { useEffect, useMemo } from 'react';
import { useControls } from 'leva';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../look/flowerControls';
import { DEFAULT_HOP_DECAY } from './fieldClusterLayout';
import { deriveFieldAnchors } from './fieldAnchors';
import { buildFieldStems } from './buildFieldStems';
import { FIELD_CONTROLS_SCHEMA } from './fieldControls';
import { STEM_CONTROLS_SCHEMA } from '../stem/stemControls';
import { STEM_DEFAULTS } from '../stem/stemDefaults';
import { FieldRuntime } from './FieldRuntime';
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

const DAHLIA_CONTROLS_SCHEMA = createFlowerControlsSchema(DAHLIA_TYPE.materialDefaults);
const ROSE_CONTROLS_SCHEMA = createFlowerControlsSchema(ROSE_TYPE.materialDefaults);

export function PlantField({
  position = [0, 0, 0],
  bodyBounds = null,
  backpackBounds = null,
  onStemBases,
  wind = PLANT_WIND_DEFAULTS,
  cullControls = null,
}) {
  const {
    flowerCount, leanOutward, initialPhaseSpread, arrangementSeed,
    roseRatio,
    petalShedFrac, shedStemOverlap,
    shedRise, shedRiseVariance, shedSpread, shedStagger,
    bvhHelper,
    meshClearDistance,
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
    migrateRange,
    migrateSpeed,
    delay: [delayMin, delayMax],
    grow: [growMin, growMax],
    keep: [keepMin, keepMax],
    die: [dieMin, dieMax],
  } = useControls('Field', FIELD_CONTROLS_SCHEMA, { collapsed: true });

  const stemControls = useControls('Stem', STEM_CONTROLS_SCHEMA, { collapsed: true });
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

  const dahliaControls = useControls(
    'Flower.Dahlia',
    DAHLIA_CONTROLS_SCHEMA,
    { collapsed: true },
  );
  const roseControls = useControls(
    'Flower.Rose',
    ROSE_CONTROLS_SCHEMA,
    { collapsed: true },
  );
  const flowerControlsById = useMemo(() => ({
    [DAHLIA_TYPE.id]: dahliaControls,
    [ROSE_TYPE.id]: roseControls,
  }), [dahliaControls, roseControls]);

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

  // Body and backpack both sit on the grow plane.
  const clearanceHosts = useMemo(() => (
    [bodyBounds, backpackBounds]
      .filter((host) => host?.bvh)
      .map((host) => ({ bvh: host.bvh, localBox: host.localBox }))
  ), [bodyBounds, backpackBounds]);

  const compositionGuide = useMemo(() => {
    const box = bodyBounds?.localBox;
    const cx = box ? (box.min.x + box.max.x) * 0.5 : 0;
    const cz = box ? (box.min.z + box.max.z) * 0.5 : 0;
    return { center: [cx, cz] };
  }, [bodyBounds]);

  // Bounds + reach only — changing flowerCount must not re-probe the BVH.
  const anchorSet = useMemo(() => {
    if (!bodyBounds?.bvh || !bodyBounds?.capsules?.length) {
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
    bodyBounds, backpackBounds, meshClearDistance,
    reachScale,
  ]);

  const anchorFieldOptions = useMemo(() => ({
    shapeWarp,
    warpScale,
    barePatches,
    patchScale,
    seed: arrangementSeed,
    // Same keep-out as planting, so the overlay does not show illegal density.
    hosts: clearanceHosts,
    meshClearDistance,
  }), [
    shapeWarp, warpScale,
    barePatches, patchScale, arrangementSeed, clearanceHosts, meshClearDistance,
  ]);

  // Hearts wander; dying flowers hop around one. Density field stays on the anchors.
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
        hosts: clearanceHosts,
        meshClearDistance,
      },
      clearanceHosts,
      meshClearDistance,
      bodyCenter: compositionGuide.center,
      hopMin: Math.min(hopRange[0], hopRange[1]),
      hopMax: Math.max(hopRange[0], hopRange[1]),
      hopDecay: DEFAULT_HOP_DECAY,
      migrateRange,
      migrateSpeed,
    };
  }, [
    anchorSet, shapeWarp,
    warpScale, barePatches, patchScale, arrangementSeed,
    migrateRange, migrateSpeed, clearanceHosts, meshClearDistance,
    compositionGuide, hopRange,
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

  // Buried anchors dump every slot onto the silhouette — log while the overlay is on.
  useEffect(() => {
    const { issues, found, expected } = anchorSet.diagnostics;
    if (!expected) return;
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

  const { stems, diagnostics } = useMemo(() => buildFieldStems({
    anchors: anchorSet.anchors,
    flowerCount,
    clearanceHosts,
    meshClearDistance,
    bodyCenter: compositionGuide.center,
    arrangementSeed,
    fieldOptions: anchorSamplerOptions,
    founderShare,
    hopMin: Math.min(hopRange[0], hopRange[1]),
    hopMax: Math.max(hopRange[0], hopRange[1]),
    roseRatio,
    dahliaType: DAHLIA_TYPE,
    roseType: ROSE_TYPE,
    lenMin,
    lenMax,
    lengthExp,
    radMin,
    radMax,
    leanMin,
    leanMax,
    bendMin,
    bendMax,
    taperMin,
    taperMax,
    flareMin,
    flareMax,
  }), [anchorSet, anchorSamplerOptions, compositionGuide,
    founderShare, hopRange,
    flowerCount, arrangementSeed, roseRatio,
    clearanceHosts, meshClearDistance,
    lenMin, lenMax, lengthExp, radMin, radMax, leanMin, leanMax,
    bendMin, bendMax, taperMin, taperMax, flareMin, flareMax]);

  useEffect(() => {
    if (!diagnostics?.shortfall) return;
    console.warn(
      `[PlantField] anchor layout short by ${diagnostics.shortfall} of ${flowerCount}`
      + ` (${diagnostics.attempts} attempts) — widen reach or lower flowerCount`,
    );
  }, [diagnostics, flowerCount]);

  useEffect(() => {
    if (!onStemBases) return;
    onStemBases(stems.map((s) => ({ x: s.position[0], z: s.position[2] })));
  }, [stems, onStemBases]);

  return (
    <group position={position}>
      <BodyBoundsDebug
        geometry={bodyBounds?.geometry ?? null}
        visible={Boolean(bvhHelper && bodyBounds?.geometry)}
        depth={bvhHelperDepth}
      />
      <BodyBoundsDebug
        geometry={backpackBounds?.geometry ?? null}
        visible={Boolean(bvhHelper && backpackBounds?.geometry)}
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
      />
      <FieldRuntime
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
        flowerControlsById={flowerControlsById}
        stemLookControls={stemLookControls}
        leafControls={leafControls}
        cullControls={cullControls}
        wind={wind}
      />
    </group>
  );
}
