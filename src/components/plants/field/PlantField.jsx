import { useMemo } from 'react';
import { useControls } from 'leva';
import { preloadVATAssets } from '@core/vat';
import { createFlowerControlsSchema } from '../look/flowerControls';
import { deriveFieldAnchors } from './fieldAnchors';
import { buildFieldStems } from './buildFieldStems';
import { FIELD_CONTROLS_SCHEMA, pinOverridesFromFieldControls } from './fieldControls';
import { STEM_CONTROLS_SCHEMA } from '../stem/stemControls';
import { STEM_DEFAULTS } from '../stem/stemDefaults';
import { FieldRuntime } from './FieldRuntime';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { BvhHelperDebug } from '../../scene/BvhHelperDebug';
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
    showHearts,
    densityField,
    gridResolution,
    reachScale,
    hipWeight, hipReach, hipElong,
    handLWeight, handLReach, handLElong,
    bootLWeight, bootLReach, bootLElong,
    backpackWeight, backpackReach, backpackElong,
    shapeWarp,
    warpScale,
    barePatches,
    patchScale,
    hearts: heartFrac,
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

  const bodyCenter = useMemo(() => {
    const box = bodyBounds?.localBox;
    const cx = box ? (box.min.x + box.max.x) * 0.5 : 0;
    const cz = box ? (box.min.z + box.max.z) * 0.5 : 0;
    return [cx, cz];
  }, [bodyBounds]);

  const pinOverrides = useMemo(() => pinOverridesFromFieldControls({
    hipWeight, hipReach, hipElong,
    handLWeight, handLReach, handLElong,
    bootLWeight, bootLReach, bootLElong,
    backpackWeight, backpackReach, backpackElong,
  }), [
    hipWeight, hipReach, hipElong,
    handLWeight, handLReach, handLElong,
    bootLWeight, bootLReach, bootLElong,
    backpackWeight, backpackReach, backpackElong,
  ]);

  // Four density masses on posed contact (torso, forearm.l, calf.l, backpack).
  const anchors = useMemo(() => {
    if (!bodyBounds?.bvh || !bodyBounds?.capsules?.length) return [];
    return deriveFieldAnchors({
      capsules: bodyBounds.capsules,
      bodyRight: bodyBounds.bodyRight,
      backpackBox: backpackBounds?.localBox ?? null,
      reachScale,
      pinOverrides,
    });
  }, [bodyBounds, backpackBounds, reachScale, pinOverrides]);

  const fieldOptions = useMemo(() => ({
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

  // Hearts wander; dying flowers hop around one. Density field stays on the anchors.
  const migration = useMemo(() => {
    if (!anchors.length) return null;
    return {
      anchors,
      options: fieldOptions,
      clearanceHosts,
      meshClearDistance,
      bodyCenter,
      hopMin: Math.min(hopRange[0], hopRange[1]),
      hopMax: Math.max(hopRange[0], hopRange[1]),
      migrateRange,
      migrateSpeed,
    };
  }, [
    anchors, fieldOptions,
    migrateRange, migrateSpeed, clearanceHosts, meshClearDistance,
    bodyCenter, hopRange,
  ]);

  const { stems, hearts } = useMemo(() => buildFieldStems({
    anchors,
    flowerCount,
    clearanceHosts,
    meshClearDistance,
    bodyCenter,
    arrangementSeed,
    fieldOptions,
    hearts: heartFrac,
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
  }), [anchors, fieldOptions, bodyCenter,
    heartFrac, hopRange,
    flowerCount, arrangementSeed, roseRatio,
    clearanceHosts, meshClearDistance,
    lenMin, lenMax, lengthExp, radMin, radMax, leanMin, leanMax,
    bendMin, bendMax, taperMin, taperMax,     flareMin, flareMax]);

  return (
    <group position={position}>
      <BvhHelperDebug
        geometry={bodyBounds?.geometry ?? null}
        visible={Boolean(bvhHelper && bodyBounds?.geometry)}
        depth={bvhHelperDepth}
      />
      <BvhHelperDebug
        geometry={backpackBounds?.geometry ?? null}
        visible={Boolean(bvhHelper && backpackBounds?.geometry)}
        depth={bvhHelperDepth}
      />
      <CompositionDebug
        visible={Boolean(showAnchors || densityField)}
        anchors={anchors}
        showAnchors={showAnchors}
        densityField={densityField}
        gridResolution={gridResolution}
        fieldOptions={fieldOptions}
        center={bodyCenter}
      />
      <FieldRuntime
        stems={stems}
        hearts={hearts}
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
        showHearts={showHearts}
        flowerControlsById={flowerControlsById}
        stemLookControls={stemLookControls}
        leafControls={leafControls}
        cullControls={cullControls}
        wind={wind}
      />
    </group>
  );
}
