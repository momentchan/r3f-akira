import { Suspense, useEffect, useMemo, useRef } from 'react';
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
  buildStemCurve,
  buildStemTubeGeometry,
  GROWTH_START_SCALE,
} from '../stem/buildStemTube';
import {
  advanceLifecycleState,
  computeBloomLifecycle,
  computeGrowthLifecycle,
  createLifecycleState,
  lifecycleLength,
  restoreLifecycleProgress,
} from '../lifecycle/plantLifecycle';
import { computeWindSway, windMask } from '../stem/wind';
import { PLANT_WIND_DEFAULTS } from '../wind/plantWind';
import {
  FlowerTypeBatch,
  updateFlowerBatchTips,
} from '../vat/FlowerTypeBatch';
import { FLOWER_TYPES } from '../vat/flowerTypes';

const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();

/**
 * Per-plant data, one texel column per plant:
 *   row 0 = [stemGrow, swayX, swayZ, _]
 *   row 1 = [offsetX, offsetY, offsetZ, yaw]   (runtime placement)
 * Row 1 is what lets a plant move + turn on respawn without rebuilding the
 * merged stem geometry.
 */
const PLANT_DATA_ROWS = 2;

function createPlantDataTexture(count, rows = PLANT_DATA_ROWS) {
  const width = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(count));
  const data = new Float32Array(width * rows * 4);
  const tex = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, data, width, rows };
}

/**
 * Take a free slot for a respawning plant, preferring one at a similar distance
 * from the body: stem size is baked per slot, so a rim-sized plant reappearing
 * next to the suit would break the near/far size hierarchy. Picks randomly among
 * the closest few so the field still reshuffles.
 */
function takeSimilarSlot(pool, freeSlots, targetRimT) {
  if (!freeSlots.length) return -1;
  let bestAt = 0;
  if (freeSlots.length > 1) {
    const ranked = freeSlots
      .map((slotIndex, at) => ({
        at,
        d: Math.abs((pool[slotIndex]?.rimT ?? 0) - targetRimT),
      }))
      .sort((a, b) => a.d - b.d);
    const k = Math.min(4, ranked.length);
    bestAt = ranked[Math.floor(Math.random() * k)].at;
  }
  const slotIndex = freeSlots[bestAt];
  freeSlots.splice(bestAt, 1);
  return slotIndex;
}

/**
 * Single plant field system: one merged stem mesh + instanced VAT heads per type.
 * Leaves are deferred (v1) for density.
 */
export function PlantSystem({
  stems,
  slotPool = null, // validated spawn slots; plants hop between them on respawn
  reshuffleOnRespawn = true,
  leanOut = 0,
  phaseSpread = 1,
  stemSegments = 32,
  radialSegs = 8,
  stemYMax = 0.05,
  bloomStart = 0.23,
  bloomFrac = 0.3,
  petalShedFrac = 0, // fraction of `die` spent dropping petals before the stem goes
  shedStemOverlap = 0, // 0 = stem waits for every petal, 1 = both start together
  shedControls = null,
  lifecycleRanges,
  lifecyclePausedRef = null,
  lifecycleGate = null,
  treeLifecycleRef = null,
  flowerTimingRef = null,
  routeRegistryRef = null,
  flowerControlsById,
  flowerColorVariationById,
  stemLookControls = null,
  leafControls = null,
  wind = PLANT_WIND_DEFAULTS,
}) {
  const runtimeRef = useRef({
    plants: [],
    plantData: null,
    stemMesh: null,
    flowerBatches: {},
    light: null,
    freeSlots: [],
  });

  // Shared stem look from top-level Stem panel.
  const stemFlowerUniforms = useMemo(() => createFlowerUniforms(), []);

  useEffect(() => {
    if (!stemLookControls) return;
    syncStemLookControls(stemLookControls, stemFlowerUniforms);
  }, [stemLookControls, stemFlowerUniforms]);

  const stemBuild = useMemo(() => {
    if (!stems.length) {
      return { geometry: null, plantData: null, plants: [] };
    }

    const plantData = createPlantDataTexture(stems.length);
    const geos = [];
    const plants = stems.map((stem, plantId) => {
      const curve = buildStemCurve({
        seed: stem.seed,
        stemLength: stem.params.stemLength,
        leanAngle: stem.params.leanAngle,
        bendDegree: stem.params.bendDegree,
        leanOutwardAngle: stem.leanOutwardAngle,
        leanOut,
      });
      // Baked in plant-local space — placement lives in plantData row 1 so a plant
      // can be moved/turned at respawn without re-merging this geometry.
      const geo = buildStemTubeGeometry(curve, {
        stemRadius: stem.params.stemRadius,
        stemSegments,
        radialSegs,
        radiusAttenuation: stem.params.radiusAttenuation,
        baseFlare: stem.params.baseFlare,
        plantId,
      });
      geos.push(geo);

      return {
        ...stem,
        plantId,
        curve,
        // Mutated at runtime, so clone rather than aliasing the layout memo.
        position: [stem.position[0], stem.position[1], stem.position[2]],
        anchorPosition: [stem.position[0], stem.position[1], stem.position[2]],
        yaw: 0,
        // Home slot + the lean azimuth the curve was baked for; a new slot's yaw
        // is the delta from this, which keeps "lean outward" pointing outward.
        slotIndex: stem.slotIndex ?? -1,
        baseLeanAngle: stem.leanOutwardAngle ?? 0,
        // Immutable: the band this plant's size was baked for. Matching against
        // the *current* slot instead would let it random-walk inward or outward
        // over many respawns and wreck the near/far size hierarchy.
        homeRimT: stem.rimT ?? 0,
        generationSeen: 0,
        treeGenerationSeen: -1,
        lifecycle: createLifecycleState({
          seed: stem.seed,
          ranges: lifecycleRanges,
          initialStagger: phaseSpread,
          rerollEachGeneration: true,
        }),
      };
    });

    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());

    return { geometry: merged, plantData, plants };
  }, [
    stems, leanOut, stemSegments, radialSegs,
  ]);

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
  }, [stemBuild.plantData, stemFlowerUniforms]);

  useEffect(() => {
    const prev = runtimeRef.current.plants;
    const next = stemBuild.plants;
    // Keep lifecycle progress across layout rebuilds with the same seeds.
    if (prev?.length && next.length === prev.length) {
      for (let i = 0; i < next.length; i += 1) {
        if (prev[i]?.seed === next[i].seed) {
          restoreLifecycleProgress(
            next[i].lifecycle,
            prev[i].lifecycle,
            lifecycleRanges,
          );
        }
      }
    }
    runtimeRef.current.plants = next;
    runtimeRef.current.plantData = stemBuild.plantData;
    // Slots not occupied by a live plant are the respawn targets.
    const taken = new Set(next.map((p) => p.slotIndex));
    runtimeRef.current.freeSlots = (slotPool ?? [])
      .map((_, idx) => idx)
      .filter((idx) => !taken.has(idx));
  }, [stemBuild, slotPool]);

  // Lifecycle tuning is runtime-only; updating timing must not rebuild merged
  // stem geometry or restart plants from zero.
  useEffect(() => {
    for (const plant of runtimeRef.current.plants) {
      const next = createLifecycleState({
        seed: plant.seed,
        ranges: lifecycleRanges,
        initialStagger: phaseSpread,
        rerollEachGeneration: true,
      });
      restoreLifecycleProgress(next, plant.lifecycle, lifecycleRanges);
      plant.lifecycle = next;
    }
  }, [lifecycleRanges, phaseSpread]);

  useEffect(() => () => {
    stemBuild.geometry?.dispose();
    stemBuild.plantData?.tex.dispose();
    stemMaterial?.dispose();
  }, [stemBuild, stemMaterial]);

  const plantsByType = useMemo(() => {
    const map = new Map();
    FLOWER_TYPES.forEach((t) => map.set(t.id, { type: t, plants: [], indices: [] }));
    stemBuild.plants.forEach((p, i) => {
      const id = p.flowerType?.id;
      const bucket = map.get(id);
      if (!bucket) return;
      const ranges = flowerColorVariationById?.[id] ?? {};
      bucket.plants.push({
        ...p,
        colorOverride: {
          hueShift: (p.colorVariationUnit?.hue ?? 0) * (ranges.hueRange ?? 0),
          lightShift: (p.colorVariationUnit?.light ?? 0) * (ranges.lightRange ?? 0),
        },
      });
      bucket.indices.push(i);
    });
    return [...map.values()].filter((b) => b.plants.length > 0);
  }, [stemBuild.plants, flowerColorVariationById]);

  useFrame(({ scene, clock }, delta) => {
    const rt = runtimeRef.current;
    const { plants, plantData, flowerBatches } = rt;
    if (!plants.length || !plantData) return;

    if (!rt.light) {
      scene.traverse((obj) => {
        if (obj.isDirectionalLight) rt.light = obj;
      });
    }
    const light = rt.light;
    if (light) {
      light.updateWorldMatrix(true, false);
      light.target.updateWorldMatrix(true, false);
      light.getWorldPosition(_lightWorld);
      light.target.getWorldPosition(_lightTarget);
      const dir = _lightWorld.sub(_lightTarget).normalize();
      stemFlowerUniforms.lightDir.value.copy(dir);
      for (const batch of Object.values(flowerBatches)) {
        batch.flowerUniforms.lightDir.value.copy(dir);
      }
    }

    const dt = Math.min(delta, 0.1);
    const paused = Boolean(lifecyclePausedRef?.current);
    const { data, width, tex } = plantData;
    const time = clock.elapsedTime;
    const pool = slotPool ?? [];
    const freeSlots = rt.freeSlots ?? (rt.freeSlots = []);

    for (let i = 0; i < plants.length; i++) {
      const plant = plants[i];
      const anchor = plant.anchorPosition ?? plant.position;
      const [swayX, swayZ] = computeWindSway(
        anchor[0],
        anchor[2],
        time,
        wind,
      );

      // A flower sampled from a moving ground tendril must inherit the
      // tendril's displacement at that exact path parameter. The flower stem's
      // own wind remains height-masked on top of this translated base.
      const attachment = plant.attachmentWind;
      if (attachment?.motionPosition && Number.isFinite(attachment.pathT)) {
        const [attachX, attachZ] = computeWindSway(
          attachment.motionPosition[0],
          attachment.motionPosition[2],
          time,
          wind,
          attachment.response ?? 0,
        );
        const attachMask = windMask(attachment.pathT);
        plant.position[0] = anchor[0] + attachX * attachMask;
        plant.position[1] = anchor[1];
        plant.position[2] = anchor[2] + attachZ * attachMask;
      }

      const treeLifecycle = plant.sourceTreeId
        ? treeLifecycleRef?.current?.get(plant.sourceTreeId)
        : null;
      if (
        treeLifecycle
        && plant.treeGenerationSeen !== treeLifecycle.generation
      ) {
        const routePath = routeRegistryRef?.current?.get(plant.sourcePathId);
        if (routePath && Number.isFinite(plant.sourcePathT)) {
          const routePoint = routePath.curve.getPointAt(plant.sourcePathT);
          const routeTangent = routePath.curve.getTangentAt(plant.sourcePathT);
          routeTangent.y = 0;
          if (routeTangent.lengthSq() < 1e-8) routeTangent.set(0, 0, 1);
          routeTangent.normalize();
          const motionPoint = routePath.curve.getPointAt(0.5);
          plant.anchorPosition[0] = routePoint.x;
          plant.anchorPosition[1] = routePoint.y;
          plant.anchorPosition[2] = routePoint.z;
          plant.position[0] = routePoint.x;
          plant.position[1] = routePoint.y;
          plant.position[2] = routePoint.z;
          plant.yaw = Math.atan2(routeTangent.x, routeTangent.z)
            + (plant.routeFanOffset ?? 0)
            - plant.baseLeanAngle;
          plant.attachmentWind = {
            motionPosition: [motionPoint.x, motionPoint.y, motionPoint.z],
            pathT: plant.sourcePathT,
            response: plant.attachmentWind?.response ?? 0,
          };
        }
        plant.lifecycle = createLifecycleState({
          seed: plant.seed + treeLifecycle.generation * 131,
          ranges: lifecycleRanges,
          initialStagger: 0,
          rerollEachGeneration: false,
        });
        if (treeLifecycle.phase === 'flowers') {
          plant.lifecycle.age = Math.min(
            Math.max(treeLifecycle.flowerAge ?? 0, 0),
            lifecycleLength(plant.lifecycle.durations),
          );
        }
        plant.treeGenerationSeen = treeLifecycle.generation;
      }

      const coordinatedWithTree = Boolean(treeLifecycle);
      if (coordinatedWithTree && flowerTimingRef?.current) {
        const timing = flowerTimingRef.current;
        timing.durationByTreeId ??= new Map();
        timing.generationByTreeId ??= new Map();
        if (timing.generationByTreeId.get(plant.sourceTreeId) !== treeLifecycle.generation) {
          timing.generationByTreeId.set(plant.sourceTreeId, treeLifecycle.generation);
          timing.durationByTreeId.set(plant.sourceTreeId, 0);
        }
        timing.durationByTreeId.set(
          plant.sourceTreeId,
          Math.max(
            timing.durationByTreeId.get(plant.sourceTreeId) ?? 0,
            lifecycleLength(plant.lifecycle.durations),
          ),
        );
      }
      const lifecycleReady = coordinatedWithTree
        ? treeLifecycle.phase === 'flowers'
        : (lifecycleGate ? lifecycleGate(plant) : true);
      if (!paused && lifecycleReady) {
        if (coordinatedWithTree) {
          plant.lifecycle.age = Math.min(
            plant.lifecycle.age + dt,
            lifecycleLength(plant.lifecycle.durations),
          );
        } else {
          advanceLifecycleState(plant.lifecycle, dt, lifecycleRanges);
        }
      }
      // Recomputed (rather than using advance's return) so the petal-shed hold on
      // the stem is applied in both the paused and running paths.
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

      // Respawn shuffle: the clock wrapped, so hand this plant a different slot.
      // Gated on stemGrow ~ 0 so it only ever teleports while fully retracted —
      // if the wrap frame is already visible we simply retry once it is not.
      if (
        reshuffleOnRespawn
        && plant.lifecycle.generation !== plant.generationSeen
        && stemGrow <= 0.001
      ) {
        const nextSlot = takeSimilarSlot(pool, freeSlots, plant.homeRimT);
        if (nextSlot >= 0) {
          if (plant.slotIndex >= 0) freeSlots.push(plant.slotIndex);
          const slot = pool[nextSlot];
          plant.slotIndex = nextSlot;
          plant.position[0] = slot.x;
          plant.position[2] = slot.z;
          // Turn by the change in outward azimuth so the stem keeps leaning away
          // from the body at its new spot (and reads as a different plant).
          plant.yaw = slot.leanOutwardAngle - plant.baseLeanAngle;
        }
        plant.generationSeen = plant.lifecycle.generation;
      }

      plant.stemGrow = stemGrow;
      plant.flowerFrame = flowerFrame;
      plant.flowerScale = flowerScale;
      plant.shed = shed;
      plant.swayX = swayX;
      plant.swayZ = swayZ;

      const o = i * 4;
      data[o] = stemGrow;
      data[o + 1] = swayX;
      data[o + 2] = swayZ;
      data[o + 3] = 0;

      const o1 = (width + i) * 4;
      data[o1] = plant.position[0];
      data[o1 + 1] = plant.position[1];
      data[o1 + 2] = plant.position[2];
      data[o1 + 3] = plant.yaw;
    }
    // Clear unused texels when count < width.
    for (let i = plants.length; i < width; i++) {
      const o = i * 4;
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
      const o1 = (width + i) * 4;
      data[o1] = 0;
      data[o1 + 1] = 0;
      data[o1 + 2] = 0;
      data[o1 + 3] = 0;
    }
    tex.needsUpdate = true;

    updateFlowerBatchTips(flowerBatches, plants);
  }, 1);

  if (!stems.length || !stemBuild.geometry || !stemMaterial) {
    return null;
  }

  return (
    <AsyncCompile id={`plant-system-${stems.length}`}>
      <group>
        <mesh
          geometry={stemBuild.geometry}
          material={stemMaterial}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
        {leafControls && leafControls.leafCount > 0 && (
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
            />
          </Suspense>
        ))}
      </group>
    </AsyncCompile>
  );
}
