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
  restoreLifecycleProgress,
} from '../lifecycle/plantLifecycle';
import { computeWindSway } from '../stem/wind';
import { PLANT_WIND_DEFAULTS } from '../wind/plantWind';
import {
  FlowerTypeBatch,
  updateFlowerBatchTips,
} from '../vat/FlowerTypeBatch';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { stableRandomRange } from '@core';
import { animatedCentre, sampleAnchorField } from './fieldAnchors';
import { getSimSpeed } from '../lifecycle/simSpeed';

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

/** Salt for the seeded respawn pick. */
const S_RESPAWN = 20;

/** Scratch for the respawn weighting, so the hot path allocates nothing. */
const _slotWeights = [];

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
/**
 * Hand a respawning plant a free slot from its OWN anchor + role bucket, so a
 * rebirth reshuffles inside its cluster instead of dissolving it. Matching on
 * radius alone let a plant at one cluster reappear at another with the same
 * distance-from-body, and over a few minutes the clusters homogenized back into
 * the even ring the anchors exist to replace.
 *
 * Seeded on the plant's own respawn counter rather than Math.random(): lifecycle
 * timings, positions and colours are all already seeded, so this was the last
 * source of nondeterminism, and CanvasCapture needs the same tableau twice.
 * Also O(1) instead of a map+sort over every free slot on every respawn.
 */
function takeGroupSlot(byGroup, groupKey, plantSeed, tick, pool, fieldAt) {
  const bucket = byGroup.get(groupKey);
  if (!bucket || !bucket.length) return -1;

  let at = -1;
  if (fieldAt && pool) {
    // Weighted by the density at each candidate RIGHT NOW. This is what makes the
    // composition migrate: the field drifts, and every flower that finishes its
    // cycle is more likely to reappear where the field currently is. Clumps creep
    // across the ground over a few generations, and no lifecycle is ever cut short
    // to achieve it — which is the whole reason the old fade gate is gone.
    //
    // A bucket holds ~20 slots and this runs only on respawn, so it is a handful
    // of arithmetic evaluations. No BVH: pool slots are already keep-out validated.
    let total = 0;
    for (let k = 0; k < bucket.length; k += 1) {
      const slot = pool[bucket[k]];
      const w = slot ? Math.max(0, fieldAt(slot.x, slot.z) - fieldAt.floor) : 0;
      _slotWeights[k] = w;
      total += w;
    }
    if (total <= 1e-6) {
      // Every spare in this cluster is in dead ground — the field has drifted past
      // this whole bucket. Decline the move and leave the plant where it is: it
      // stands on a slot the builder accepted, which beats relocating it into the
      // margin. `generationSeen` still advances, so this costs one attempt per
      // lifecycle rather than retrying every frame.
      return -1;
    }
    let roll = stableRandomRange(plantSeed, S_RESPAWN, tick, 0, total);
    at = bucket.length - 1;
    for (let k = 0; k < bucket.length; k += 1) {
      roll -= _slotWeights[k];
      if (roll <= 0) { at = k; break; }
    }
  } else {
    // No migration to consult, so any spare in the cluster is as good as another.
    at = Math.min(
      bucket.length - 1,
      Math.floor(stableRandomRange(plantSeed, S_RESPAWN, tick, 0, bucket.length)),
    );
  }
  const slotIndex = bucket[at];
  bucket.splice(at, 1);
  return slotIndex;
}

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
  migration = null,
  lifecyclePausedRef = null,
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
    // Reused every frame so the respawn field sampler allocates nothing.
    migrateOptions: null,
    migrateCentres: [],
    // Scaled, pausable simulation time. Kept here rather than read off the render
    // clock so speed changes and the Space pause apply to the field drift too.
    simTime: 0,
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
        yaw: 0,
        // Home slot + the lean azimuth the curve was baked for; a new slot's yaw
        // is the delta from this, which keeps "lean outward" pointing outward.
        slotIndex: stem.slotIndex ?? -1,
        baseLeanAngle: stem.leanOutwardAngle ?? 0,
        // Immutable: the band this plant's size was baked for. Matching against
        // the *current* slot instead would let it random-walk inward or outward
        // over many respawns and wreck the near/far size hierarchy.
        homeRimT: stem.rimT ?? 0,
        // Normalized once here so the per-frame loop needs no fallback.
        bloomCeiling: stem.bloomCeiling ?? 1,
        // 0 so a plant grows IN rather than popping when its slot first gains density.
        // Anchor + role identity. Matched on respawn so a plant can only take a
        // slot from its own cluster, or the clusters homogenize over minutes.
        homeGroupKey: stem.groupKey ?? -1,
        respawnTick: 0,
        generationSeen: 0,
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
    stems, leanOut, stemSegments, radialSegs, lifecycleRanges, phaseSpread,
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
    // Also bucketed by anchor+role so a respawn can be constrained to its own
    // cluster. Falls back to the flat list when the layout has no groups.
    const byGroup = new Map();
    (slotPool ?? []).forEach((slot, idx) => {
      if (taken.has(idx)) return;
      const key = slot.groupKey ?? -1;
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(idx); else byGroup.set(key, [idx]);
    });
    runtimeRef.current.freeSlotsByGroup = byGroup;
    if (byGroup.size === 1 && byGroup.has(-1)) {
      // Every free slot landed in the fallback bucket, which means no plant can
      // ever match one and the respawn reshuffle is dead. This exact bug shipped
      // once already.
      console.warn(
        `[PlantSystem] respawn reshuffle disabled: ${byGroup.get(-1).length}`
        + ' free slots have no groupKey',
      );
    }
  }, [stemBuild, slotPool]);

  useEffect(() => () => {
    stemBuild.geometry?.dispose();
    stemBuild.plantData?.tex.dispose();
    stemMaterial?.dispose();
  }, [stemBuild, stemMaterial]);

  const plantsByType = useMemo(() => {
    const map = new Map();
    FLOWER_TYPES.forEach((t) => map.set(t.id, { type: t, plants: [], indices: [] }));
    stemBuild.plants.forEach((p, i) => {
      const id = p.flowerType.id;
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

    const paused = Boolean(lifecyclePausedRef?.current);
    // Simulation clock. Lifecycle progress and the field drift both read it, so
    // changing the rate moves the flowers and the masses they sit on together.
    // Clamp first, then scale: the clamp exists to stop a backgrounded tab from
    // skipping a whole cycle on refocus, and scaling before it would defeat that.
    const dt = Math.min(delta, 0.1) * getSimSpeed();
    if (!paused) rt.simTime += dt;
    const simTime = rt.simTime;

    // Migration preamble, once per frame rather than once per plant. The animated
    // centres depend only on time, and the options object is mutated in place so
    // the hot loop allocates nothing.
    let migrateOptions = null;
    let fieldAt = null;
    if (migration) {
      if (!rt.migrateOptions) rt.migrateOptions = { ...migration.options };
      migrateOptions = rt.migrateOptions;
      Object.assign(migrateOptions, migration.options);
      const centres = rt.migrateCentres;
      centres.length = migration.anchors.length;
      for (let a = 0; a < migration.anchors.length; a += 1) {
        centres[a] = animatedCentre(
          // simTime, not clock.elapsedTime: the drift has to scale with the sim
          // rate and freeze with the Space pause. On the render clock, pausing the
          // flowers left the masses sliding along underneath them.
          migration.anchors[a], simTime,
          migration.options.migrateRange, migration.options.migrateSpeed,
        );
      }
      migrateOptions.centres = centres;
      // Consumed only on respawn, so this closure is built once per frame and on
      // most frames is never called.
      fieldAt = (x, z) => sampleAnchorField(
        x, z, migration.anchors, migrateOptions,
      );
      fieldAt.floor = migration.threshold ?? 0;
    }
    const { data, width, tex } = plantData;
    const time = clock.elapsedTime;
    const pool = slotPool ?? [];
    const freeSlots = rt.freeSlots ?? (rt.freeSlots = []);

    for (let i = 0; i < plants.length; i++) {
      const plant = plants[i];
      const [swayX, swayZ] = computeWindSway(
        plant.position[0],
        plant.position[2],
        time,
        wind,
      );

      if (!paused) advanceLifecycleState(plant.lifecycle, dt, lifecycleRanges);
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
      // Read once and never scaled: the lifecycle alone owns how grown a stem is.
      const stemGrow = growthState.growth;

      // Respawn shuffle: the clock wrapped, so hand this plant a different slot.
      // Gated on stemGrow ~ 0 so it only ever teleports while fully retracted —
      // if the wrap frame is already visible we simply retry once it is not.
      if (
        reshuffleOnRespawn
        && plant.lifecycle.generation !== plant.generationSeen
        && stemGrow <= 0.001
      ) {
        const byGroup = runtimeRef.current.freeSlotsByGroup;
        const grouped = plant.homeGroupKey >= 0 && byGroup;
        const nextSlot = grouped
          ? takeGroupSlot(
            byGroup, plant.homeGroupKey, plant.seed, plant.respawnTick, pool, fieldAt,
          )
          : takeSimilarSlot(pool, freeSlots, plant.homeRimT);
        if (nextSlot >= 0) {
          if (plant.slotIndex >= 0) {
            if (grouped) {
              // Released to homeGroupKey, never to the slot's own group. They are
              // equal by construction; writing it this way stops a mislabelled slot
              // from leaking a plant into a neighbouring cluster.
              const home = byGroup.get(plant.homeGroupKey);
              if (home) home.push(plant.slotIndex);
              else byGroup.set(plant.homeGroupKey, [plant.slotIndex]);
            } else {
              freeSlots.push(plant.slotIndex);
            }
          }
          const slot = pool[nextSlot];
          plant.slotIndex = nextSlot;
          plant.position[0] = slot.x;
          plant.position[2] = slot.z;
          // Turn by the change in outward azimuth so the stem keeps leaning away
          // from the body at its new spot (and reads as a different plant).
          plant.yaw = slot.leanOutwardAngle - plant.baseLeanAngle;
          plant.respawnTick += 1;
        }
        plant.generationSeen = plant.lifecycle.generation;
      }

      // No migration gate. It used to scale stemGrow by the local density, which
      // meant a flower halfway through blooming shrank back down because the field
      // had moved off it — the lifecycle got interrupted, and it read as a flower
      // growing in reverse for no visible reason. It also cost ~45% of the built
      // count in permanently dormant plants.
      //
      // Migration now expresses itself through WHERE the next flower appears, not
      // by retracting live ones: the field weights the respawn pick above, so every
      // plant runs a full grow/hold/shed/retract cycle wherever it stands.
      plant.stemGrow = stemGrow;
      // Ceiling applied HERE rather than inside computeBloomLifecycle: that
      // function deliberately forces flowerFrame to 1 during petal shed to avoid
      // a pop, and the ramp reaches 1 at openEnd, so scaling the result holds the
      // shed at exactly the value the ramp just arrived at — continuous either way.
      plant.flowerFrame = flowerFrame * plant.bloomCeiling;
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
