import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AsyncCompile } from '@core';
import {
  createBatchedStemMaterial,
  createFlowerUniforms,
} from '../look/createFlowerMaterials';
import { FieldLeaves } from '../stem/FieldLeaves';
import { syncStemLookControls } from '../stem/stemControls';
import {
  buildCurveSampleTable,
  buildStemCurve,
  buildStemTubeGeometry,
  GROWTH_START_SCALE,
} from '../stem/buildStemTube';
import {
  advanceLifecycleState,
  applyLifecycleRanges,
  computeBloomLifecycle,
  computeGrowthLifecycle,
  createLifecycleState,
  restoreLifecycleProgress,
} from '../lifecycle/plantLifecycle';
import { computeWindSway, PLANT_WIND_DEFAULTS } from '../wind/plantWind';
import {
  FlowerTypeBatch,
  cullFlowerBatches,
  updateFlowerBatchTips,
} from '../vat/FlowerTypeBatch';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { getSimSpeed } from '../lifecycle/simSpeed';
import { enablePlantShadowLayer } from '../../scene/plantShadowLayer';
import { HeartDebug } from './HeartDebug';
import { hopHearts, respawnPlant } from './fieldMigrate';
import {
  applyStemLayout,
  createPlantDataTexture,
  stemsTubeKey,
  writePlantState,
} from './fieldPlantData';
import {
  mountFlowerCullHud,
  pollFlowerCullCounts,
  tickFlowerCullFps,
  unmountFlowerCullHud,
} from './flowerCullHud';

const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();
const _windSway = [0, 0];

function createFieldPlant(stem, plantId, { stemSegments, radialSegs, leanOut, ranges, stagger }) {
  const curve = buildStemCurve({
    seed: stem.seed,
    stemLength: stem.params.stemLength,
    leanAngle: stem.params.leanAngle,
    bendDegree: stem.params.bendDegree,
    leanOutwardAngle: stem.leanOutwardAngle,
    leanOut,
  });
  const geometry = buildStemTubeGeometry(curve, {
    stemRadius: stem.params.stemRadius,
    stemSegments,
    radialSegs,
    radiusAttenuation: stem.params.radiusAttenuation,
    baseFlare: stem.params.baseFlare,
    plantId,
  });
  return {
    geometry,
    plant: {
      ...stem,
      plantId,
      curve,
      curveTable: buildCurveSampleTable(curve, stemSegments),
      position: [stem.position[0], stem.position[1], stem.position[2]],
      yaw: 0,
      slotIndex: stem.slotIndex ?? -1,
      baseLeanAngle: stem.leanOutwardAngle ?? 0,
      bloomCeiling: stem.bloomCeiling ?? 1,
      respawnTick: 0,
      generationSeen: 0,
      lifecycle: createLifecycleState({
        seed: stem.seed,
        ranges,
        initialStagger: stagger,
        rerollEachGeneration: true,
      }),
    },
  };
}

/**
 * Merged stems, GPU-culled VAT heads, leaves, lifecycle, heart hops.
 * PlantField authors opening stems and hearts.
 */
export function FieldRuntime({
  stems,
  hearts = [],
  leanOut = 0,
  phaseSpread = 1,
  stemSegments = 32,
  radialSegs = 8,
  stemYMax = 0.05,
  bloomStart = 0.23,
  bloomFrac = 0.3,
  petalShedFrac = 0,
  shedStemOverlap = 0,
  shedControls = null,
  lifecycleRanges,
  migration = null,
  showHearts = false,
  flowerControlsById,
  stemLookControls = null,
  leafControls = null,
  cullControls = null,
  wind = PLANT_WIND_DEFAULTS,
}) {
  const runtimeRef = useRef({
    plants: [],
    plantData: null,
    flowerBatches: {},
    light: null,
    migrateOptions: null,
    hearts: [],
    simTime: 0,
    cullReadPending: false,
    cullReadAt: 0,
    tipsFrozen: false,
    fpsFrames: 0,
    fpsAcc: 0,
  });

  const {
    freezeTips = false,
    forceAllLow = false,
    flowerCastShadows = true,
    hideStems = false,
    hideLeaves = false,
    freezeMigrate = false,
    lowShadowCasters = false,
    tintDrawn = false,
    enabled: gpuCull = true,
    lodDistance,
  } = cullControls ?? {};
  const noFlowerShadows = flowerCastShadows === false;

  const lifecycleRangesRef = useRef(lifecycleRanges);
  lifecycleRangesRef.current = lifecycleRanges;
  const phaseSpreadRef = useRef(phaseSpread);
  phaseSpreadRef.current = phaseSpread;
  const cullHudRef = useRef(null);

  useEffect(() => {
    cullHudRef.current = mountFlowerCullHud(tintDrawn);
    return () => {
      unmountFlowerCullHud(cullHudRef.current);
      cullHudRef.current = null;
    };
  }, [tintDrawn]);

  const stemFlowerUniforms = useMemo(() => createFlowerUniforms(), []);

  useEffect(() => {
    if (!stemLookControls) return;
    syncStemLookControls(stemLookControls, stemFlowerUniforms);
  }, [stemLookControls, stemFlowerUniforms]);

  const tubeKey = stemsTubeKey(stems);
  // Baked tube identity: seed, species, curve, radius, lean. Placement lives in
  // the plant DataTexture, so a position-only layout change must not remesh.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stems via tubeKey
  const stemBuild = useMemo(() => {
    if (!stems.length) {
      return { geometry: null, plantData: null, plants: [] };
    }

    const plantData = createPlantDataTexture(stems.length);
    const geos = [];
    const plants = stems.map((stem, plantId) => {
      const { geometry, plant } = createFieldPlant(stem, plantId, {
        stemSegments,
        radialSegs,
        leanOut,
        ranges: lifecycleRangesRef.current,
        stagger: phaseSpreadRef.current,
      });
      geos.push(geometry);
      return plant;
    });

    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    return { geometry: merged, plantData, plants };
  }, [tubeKey, leanOut, stemSegments, radialSegs]);

  const stemMaterial = useMemo(() => {
    if (!stemBuild.plantData) return null;
    return createBatchedStemMaterial(stemFlowerUniforms, {
      plantDataTexture: stemBuild.plantData.tex,
      texWidth: stemBuild.plantData.width,
      texRows: stemBuild.plantData.rows,
      maskPow: 2,
      startScale: GROWTH_START_SCALE,
      growthSegments: stemSegments,
    });
  }, [stemBuild.plantData, stemFlowerUniforms, stemSegments]);

  useLayoutEffect(() => {
    const rt = runtimeRef.current;
    const next = stemBuild.plants;
    if (rt.plants !== next) {
      const prev = rt.plants;
      if (prev?.length === next.length) {
        for (let i = 0; i < next.length; i += 1) {
          if (prev[i]?.seed === next[i].seed) {
            restoreLifecycleProgress(
              next[i].lifecycle,
              prev[i].lifecycle,
              lifecycleRanges,
            );
            next[i].generationSeen = prev[i].generationSeen;
          }
        }
      }
      rt.plants = next;
      rt.plantData = stemBuild.plantData;
    }
    applyStemLayout(rt, stems, hearts);
  }, [stemBuild, stems, hearts]);

  useEffect(() => {
    for (const plant of runtimeRef.current.plants) {
      applyLifecycleRanges(plant.lifecycle, lifecycleRanges);
    }
  }, [lifecycleRanges]);

  useEffect(() => () => {
    stemBuild.geometry?.dispose();
    stemBuild.plantData?.tex.dispose();
    stemMaterial?.dispose();
  }, [stemBuild, stemMaterial]);

  const plantsByType = useMemo(() => {
    const map = new Map();
    FLOWER_TYPES.forEach((t) => map.set(t.id, { type: t, plants: [], indices: [] }));
    stemBuild.plants.forEach((p, i) => {
      const bucket = map.get(p.flowerType.id);
      if (!bucket) return;
      bucket.plants.push(p);
      bucket.indices.push(i);
    });
    return [...map.values()].filter((b) => b.plants.length > 0);
  }, [stemBuild.plants]);

  useFrame(({ scene, clock, gl, camera }, delta) => {
    const rt = runtimeRef.current;
    const { plants, plantData, flowerBatches } = rt;
    if (!plants.length || !plantData) return;

    if (!rt.light || !rt.light.parent) {
      rt.light = null;
      scene.traverse((obj) => {
        if (!rt.light && obj.isDirectionalLight) rt.light = obj;
      });
    }
    if (rt.light) {
      rt.light.updateWorldMatrix(true, false);
      rt.light.target.updateWorldMatrix(true, false);
      rt.light.getWorldPosition(_lightWorld);
      rt.light.target.getWorldPosition(_lightTarget);
      const dir = _lightWorld.sub(_lightTarget).normalize();
      stemFlowerUniforms.lightDir.value.copy(dir);
      for (const id in flowerBatches) {
        flowerBatches[id].flowerUniforms.lightDir.value.copy(dir);
      }
    }

    const dt = Math.min(delta, 0.1) * getSimSpeed();
    rt.simTime += dt;

    let fieldOptions = null;
    if (migration?.anchors?.length) {
      if (!rt.migrateOptions) rt.migrateOptions = { ...migration.options };
      fieldOptions = rt.migrateOptions;
      Object.assign(fieldOptions, migration.options);
      if (!freezeMigrate) hopHearts(rt.hearts, migration, fieldOptions, rt.simTime);
    }

    const time = clock.elapsedTime;
    for (let i = 0; i < plants.length; i += 1) {
      const plant = plants[i];
      computeWindSway(
        plant.position[0],
        plant.position[2],
        time,
        wind,
        1,
        _windSway,
      );
      const swayX = _windSway[0];
      const swayZ = _windSway[1];

      advanceLifecycleState(plant.lifecycle, dt, lifecycleRanges);
      const growthState = computeGrowthLifecycle(
        plant.lifecycle.age,
        plant.lifecycle.durations,
        petalShedFrac,
        shedStemOverlap,
      );
      const { flowerFrame, flowerScale, shed } = computeBloomLifecycle(
        plant.lifecycle.age,
        plant.lifecycle.durations,
        bloomFrac,
        bloomStart,
        petalShedFrac,
      );
      const stemGrow = growthState.growth;

      if (
        plant.lifecycle.generation !== plant.generationSeen
        && stemGrow <= 0.001
      ) {
        if (!freezeMigrate && fieldOptions) {
          respawnPlant(plant, rt.hearts, migration, fieldOptions);
        }
        plant.generationSeen = plant.lifecycle.generation;
      }

      plant.stemGrow = stemGrow;
      plant.flowerFrame = flowerFrame * plant.bloomCeiling;
      plant.flowerScale = flowerScale;
      plant.shed = shed;
      plant.swayX = swayX;
      plant.swayZ = swayZ;
    }
    writePlantState(plantData, plants);

    if (!freezeTips || !rt.tipsFrozen) {
      updateFlowerBatchTips(flowerBatches, plants);
    }
    rt.tipsFrozen = freezeTips;

    const tint = tintDrawn ? 1 : 0;
    for (const id in flowerBatches) {
      const tints = flowerBatches[id].debugTints
        ?? (flowerBatches[id].debugTint ? [flowerBatches[id].debugTint] : []);
      for (let i = 0; i < tints.length; i += 1) {
        if (tints[i]) tints[i].value = tint;
      }
    }
    cullFlowerBatches(gl, camera, flowerBatches, {
      enabled: gpuCull,
    });

    rt.fpsFrames += 1;
    rt.fpsAcc += delta;
    if (rt.fpsAcc >= 1) {
      const fps = rt.fpsFrames / rt.fpsAcc;
      tickFlowerCullFps(cullHudRef.current, gl, fps);
      rt.fpsFrames = 0;
      rt.fpsAcc = 0;
    }

    pollFlowerCullCounts(
      cullHudRef.current,
      gl,
      flowerBatches,
      rt,
      clock.elapsedTime,
    );
  });

  if (!stems.length || !stemBuild.geometry || !stemMaterial) {
    return null;
  }

  return (
    <AsyncCompile id={`field-runtime-${stems.length}`}>
      <group>
        <mesh
          ref={enablePlantShadowLayer}
          geometry={stemBuild.geometry}
          material={stemMaterial}
          frustumCulled={false}
          visible={!hideStems}
          castShadow
          receiveShadow
        />
        {!hideLeaves && leafControls && leafControls.leafCount > 0 && (
          <Suspense fallback={null}>
            <FieldLeaves
              plants={stemBuild.plants}
              plantData={stemBuild.plantData}
              flowerUniforms={stemFlowerUniforms}
              {...leafControls}
            />
          </Suspense>
        )}
        {plantsByType.map(({ type, plants: typePlants, indices }) => (
          <Suspense key={type.id} fallback={null}>
            <FlowerTypeBatch
              flowerType={type}
              plants={typePlants}
              plantIndexMap={indices}
              stemYMax={stemYMax}
              flowerControls={flowerControlsById?.[type.id]}
              stemLookControls={stemLookControls}
              shedControls={shedControls}
              runtimeRef={runtimeRef}
              lodDistance={lodDistance}
              forceAllLow={forceAllLow}
              noFlowerShadows={noFlowerShadows}
              lowShadowCasters={lowShadowCasters}
            />
          </Suspense>
        ))}
        <HeartDebug
          runtimeRef={runtimeRef}
          visible={showHearts}
          capacity={stems.length}
        />
      </group>
    </AsyncCompile>
  );
}
