import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AsyncCompile } from '@core';
import { isDebugRoute } from '../../../core/debugRoute';
import {
  createBatchedStemMaterial,
  createFlowerUniforms,
} from '../look/createFlowerMaterials';
import { FLOWER_LOD_DEBUG_COLORS } from '../vat/flowerCullDefaults';
import { getFlowerBenchLabel, publishFlowerBench } from '../vat/flowerBench';
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
import { computeWindSway } from '../stem/wind';
import { PLANT_WIND_DEFAULTS } from '../wind/plantWind';
import {
  FlowerTypeBatch,
  cullFlowerBatches,
  updateFlowerBatchTips,
} from '../vat/FlowerTypeBatch';
import {
  countActiveFlowerHeads,
  countTotalFlowerSlots,
  readDrawnFlowerCount,
} from '../vat/flowerInstanceCull';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { animatedCentre } from './fieldAnchors';
import {
  DEFAULT_HOP_DECAY,
  pickClumpHeart,
  sampleClumpHop,
  sampleFieldPosition,
} from './fieldClusterLayout';
import { getSimSpeed } from '../lifecycle/simSpeed';
import { enablePlantShadowLayer } from '../../scene/plantShadowLayer';

/**
 * One heart per opening founder. Hearts wander on their own clock; dying
 * flowers pick among them by field × distance. The list is the pick target —
 * the Map is only for looking a founder up while building.
 */
function buildHeartRuntime(plants) {
  const byId = new Map();
  const list = [];
  for (let i = 0; i < plants.length; i += 1) {
    const p = plants[i];
    const id = p.clumpId ?? i;
    let h = byId.get(id);
    if (!h) {
      h = {
        id,
        anchorIndex: p.anchorIndex ?? 0,
        cx: p.position[0],
        cz: p.position[2],
        beat: -1,
        relocateTick: 0,
      };
      byId.set(id, h);
      list.push(h);
    }
    if ((p.generation ?? 1) === 0) {
      h.cx = p.position[0];
      h.cz = p.position[2];
      h.anchorIndex = p.anchorIndex ?? h.anchorIndex;
    }
  }
  return { byId, list };
}

/** Sim-seconds between heart hops. Default migrateSpeed 0.035 → 10s. */
function heartPeriod(migrateSpeed) {
  return 0.35 / Math.max(migrateSpeed, 0.001);
}

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
 * Single plant field system: one merged stem mesh + GPU-culled VAT heads per type,
 * plus one instanced leaf mesh.
 */
export function PlantSystem({
  stems,
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
  cullControls = null,
  wind = PLANT_WIND_DEFAULTS,
}) {
  const runtimeRef = useRef({
    plants: [],
    plantData: null,
    stemMesh: null,
    flowerBatches: {},
    light: null,
    // Reused every frame so the respawn field sampler allocates nothing.
    migrateOptions: null,
    migrateCentres: [],
    hearts: [],
    // Scaled, pausable simulation time. Kept here rather than read off the render
    // clock so speed changes and the Space pause apply to the field drift too.
    simTime: 0,
    cullReadPending: false,
    cullReadAt: 0,
    tipsFrozen: false,
    fpsFrames: 0,
    fpsAcc: 0,
  });

  const freezeTips = Boolean(cullControls?.freezeTips);
  const forceAllLow = Boolean(cullControls?.forceAllLow);
  const noFlowerShadows = cullControls?.flowerCastShadows === false;
  const hideStems = Boolean(cullControls?.hideStems);
  const hideLeaves = Boolean(cullControls?.hideLeaves);
  const freezeMigrate = Boolean(cullControls?.freezeMigrate);
  const lowShadowCasters = Boolean(cullControls?.lowShadowCasters);
  const benchMode = getFlowerBenchLabel({
    freezeTips,
    forceAllLow,
    noFlowerShadows,
    lowShadowCasters,
    hideStems,
    hideLeaves,
    freezeMigrate,
  });

  // Lifecycle timing does not shape geometry, so it must not be a rebuild input.
  // Read through refs and applied in place below; see the stemBuild deps note.
  const lifecycleRangesRef = useRef(lifecycleRanges);
  lifecycleRangesRef.current = lifecycleRanges;
  const phaseSpreadRef = useRef(phaseSpread);
  phaseSpreadRef.current = phaseSpread;
  const cullHudRef = useRef(null);

  useEffect(() => {
    const showStats = isDebugRoute();
    const showLegend = cullControls?.tintDrawn;
    if (!showStats && !showLegend) {
      cullHudRef.current?.root.remove();
      cullHudRef.current = null;
      return undefined;
    }

    const rgbCss = ([r, g, b]) => (
      `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
    );

    const root = document.createElement('div');
    root.className = 'flower-cull-hud';

    let totalEl = null;
    let activeEl = null;
    let drawnEl = null;
    let fpsEl = null;
    let benchEl = null;
    if (showStats) {
      totalEl = document.createElement('span');
      activeEl = document.createElement('span');
      drawnEl = document.createElement('span');
      fpsEl = document.createElement('span');
      benchEl = document.createElement('span');
      totalEl.textContent = 'total 0';
      activeEl.textContent = 'active 0';
      drawnEl.textContent = 'drawn 0';
      fpsEl.textContent = 'fps —';
      benchEl.textContent = `bench ${getFlowerBenchLabel(cullControls)}`;
      root.append(totalEl, activeEl, drawnEl, fpsEl, benchEl);
    }

    let legendEl = null;
    if (showLegend) {
      legendEl = document.createElement('div');
      legendEl.className = 'flower-cull-lod-legend';
      for (const [label, color] of [
        ['LOD0 hi-poly', FLOWER_LOD_DEBUG_COLORS.hi],
        ['LOD1 low-poly', FLOWER_LOD_DEBUG_COLORS.lo],
      ]) {
        const row = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.background = rgbCss(color);
        row.append(swatch, document.createTextNode(label));
        legendEl.append(row);
      }
      root.append(legendEl);
    }

    document.body.appendChild(root);
    cullHudRef.current = { root, totalEl, activeEl, drawnEl, fpsEl, benchEl, legendEl };
    return () => {
      root.remove();
      cullHudRef.current = null;
    };
  }, [
    cullControls?.tintDrawn,
    cullControls?.freezeTips,
    cullControls?.forceAllLow,
    cullControls?.flowerCastShadows,
    cullControls?.lowShadowCasters,
    cullControls?.hideStems,
    cullControls?.hideLeaves,
    cullControls?.freezeMigrate,
  ]);

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
        // Same segment count as the tube above, so the head tracks the geometry
        // it is attached to rather than the ideal curve.
        curveTable: buildCurveSampleTable(curve, stemSegments),
        // Mutated at runtime, so clone rather than aliasing the layout memo.
        position: [stem.position[0], stem.position[1], stem.position[2]],
        yaw: 0,
        // Home slot + the lean azimuth the curve was baked for; a new slot's yaw
        // is the delta from this, which keeps "lean outward" pointing outward.
        slotIndex: stem.slotIndex ?? -1,
        baseLeanAngle: stem.leanOutwardAngle ?? 0,
        // Normalized once here so the per-frame loop needs no fallback.
        bloomCeiling: stem.bloomCeiling ?? 1,
        respawnTick: 0,
        generationSeen: 0,
        lifecycle: createLifecycleState({
          seed: stem.seed,
          ranges: lifecycleRangesRef.current,
          initialStagger: phaseSpreadRef.current,
          rerollEachGeneration: true,
        }),
      };
    });

    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());

    return { geometry: merged, plantData, plants };
    // lifecycleRanges and phaseSpread are deliberately NOT deps. Neither shapes
    // geometry, and listing them meant nudging a timing slider rebuilt all 256
    // tubes and re-ran mergeGeometries. phaseSpread was pure waste either way:
    // the restore effect below overwrites `age` from the previous generation, so
    // the fresh stagger was discarded the moment it was computed.
  }, [stems, leanOut, stemSegments, radialSegs]);

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
          // Layout rebuilds reset generationSeen to 0; a restored lifecycle that
          // already wrapped would otherwise hop on the first frame.
          next[i].generationSeen = prev[i].generationSeen;
        }
      }
    }
    runtimeRef.current.plants = next;
    runtimeRef.current.plantData = stemBuild.plantData;
    runtimeRef.current.hearts = buildHeartRuntime(next).list;
  }, [stemBuild]);

  // Timing changes reach living plants here instead of through a geometry rebuild.
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

  useFrame(({ scene, clock, gl, camera }, delta) => {
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
      // for..in rather than Object.values: this runs every frame and the latter
      // allocates an array each time.
      for (const id in flowerBatches) {
        flowerBatches[id].flowerUniforms.lightDir.value.copy(dir);
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
    if (migration?.anchors?.length) {
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
          migration.options.migrateRange ?? 0, migration.options.migrateSpeed ?? 0,
        );
      }
      migrateOptions.centres = centres;

      // Hearts hop on their own clock, staggered per id so the whole field does
      // not jump in one frame. migrateRange 0 freezes them; flowers still pick
      // among the frozen set.
      const range = freezeMigrate ? 0 : (migration.options.migrateRange ?? 0);
      const speed = freezeMigrate ? 0 : (migration.options.migrateSpeed ?? 0);
      if (range > 0 && speed > 0 && rt.hearts.length) {
        const period = heartPeriod(speed);
        const hopDecay = migration.hopDecay ?? DEFAULT_HOP_DECAY;
        for (let h = 0; h < rt.hearts.length; h += 1) {
          const heart = rt.hearts[h];
          const phase = (heart.id * 0.728) % 1;
          const beat = Math.floor(simTime / period - phase);
          // First observe: sync the counter without hopping, so spawn layout
          // is the opening composition rather than an instant relocate.
          if (heart.beat < 0) {
            heart.beat = beat;
            continue;
          }
          if (beat === heart.beat) continue;
          heart.beat = beat;
          const sample = {
            anchors: migration.anchors,
            fieldOptions: migrateOptions,
            clearanceHosts: migration.clearanceHosts,
            clearMargin: migration.meshClearDistance,
            clearHeights: migration.clearHeights,
            head: migration.head,
            faceClearRadius: migration.faceClearRadius,
            seed: heart.id * 17 + 1,
            tick: heart.relocateTick,
          };
          // Creep first: a field-weighted hop of up to migrateRange. If the
          // local patch has gone bare, catch the drifted mass on this anchor.
          const crept = sampleClumpHop({
            ...sample,
            from: { x: heart.cx, z: heart.cz },
            generation: 1,
            hopMin: range * 0.25,
            hopMax: range,
            hopDecay,
          });
          const next = crept ?? sampleFieldPosition({
            ...sample,
            anchorIndex: heart.anchorIndex,
          });
          if (next) {
            heart.cx = next.x;
            heart.cz = next.z;
          }
          heart.relocateTick += 1;
        }
      }
    }
    const { data, width, tex } = plantData;
    const time = clock.elapsedTime;

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

      // Respawn: pick a live heart by field × distance, then hop around it.
      // Hearts have already moved on their own clock this frame. Gated on
      // stemGrow ~ 0 so it only ever teleports while fully retracted.
      if (
        plant.lifecycle.generation !== plant.generationSeen
        && stemGrow <= 0.001
      ) {
        if (!freezeMigrate && migrateOptions && rt.hearts.length) {
          const [bx, bz] = migration.bodyCenter ?? [0, 0];
          const hopMin = migration.hopMin ?? 0.07;
          const hopMax = migration.hopMax ?? 0.2;
          const hopDecay = migration.hopDecay ?? DEFAULT_HOP_DECAY;
          const sample = {
            anchors: migration.anchors,
            fieldOptions: migrateOptions,
            clearanceHosts: migration.clearanceHosts,
            clearMargin: migration.meshClearDistance,
            clearHeights: migration.clearHeights,
            head: migration.head,
            faceClearRadius: migration.faceClearRadius,
            seed: plant.seed,
            tick: plant.respawnTick,
          };
          const heart = pickClumpHeart({
            hearts: rt.hearts,
            x: plant.position[0],
            z: plant.position[2],
            anchors: migration.anchors,
            fieldOptions: migrateOptions,
            attractRadius: hopMax * 3,
            seed: plant.seed,
            tick: plant.respawnTick,
          });
          if (heart) {
            const got = sampleClumpHop({
              ...sample,
              from: { x: heart.cx, z: heart.cz },
              generation: plant.generation ?? 1,
              hopMin,
              hopMax,
              hopDecay,
            });
            if (got) {
              plant.position[0] = got.x;
              plant.position[2] = got.z;
              plant.yaw = Math.atan2(got.x - bx, got.z - bz) - plant.baseLeanAngle;
              plant.clumpId = heart.id;
            }
            plant.respawnTick += 1;
          }
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
      // by retracting live ones: hearts wander on a timer, a death picks among
      // them by field × distance, then hops. Every plant still runs a full
      // grow/hold/shed/retract cycle wherever it stands.
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
    // Texels past plants.length are never written, and the backing Float32Array
    // starts zeroed, so there is nothing to clear here.
    tex.needsUpdate = true;

    if (freezeTips) {
      if (!rt.tipsFrozen) {
        updateFlowerBatchTips(flowerBatches, plants);
        rt.tipsFrozen = true;
      }
    } else {
      rt.tipsFrozen = false;
      updateFlowerBatchTips(flowerBatches, plants);
    }
    const tint = cullControls?.tintDrawn ? 1 : 0;
    for (const id in flowerBatches) {
      const batch = flowerBatches[id];
      const tints = batch.debugTints ?? (batch.debugTint ? [batch.debugTint] : []);
      for (let i = 0; i < tints.length; i += 1) {
        if (tints[i]) tints[i].value = tint;
      }
    }
    cullFlowerBatches(gl, camera, flowerBatches, {
      enabled: cullControls?.enabled !== false,
    });

    rt.fpsFrames += 1;
    rt.fpsAcc += delta;
    if (rt.fpsAcc >= 1) {
      const fps = rt.fpsFrames / rt.fpsAcc;
      publishFlowerBench({
        mode: benchMode,
        fps,
        at: performance.now(),
      });
      const hud = cullHudRef.current;
      if (hud?.fpsEl) hud.fpsEl.textContent = `fps ${fps.toFixed(1)}`;
      rt.fpsFrames = 0;
      rt.fpsAcc = 0;
    }

    if (isDebugRoute() && !rt.cullReadPending && clock.elapsedTime - rt.cullReadAt > 0.25) {
      rt.cullReadPending = true;
      rt.cullReadAt = clock.elapsedTime;
      const total = countTotalFlowerSlots(flowerBatches);
      const active = countActiveFlowerHeads(flowerBatches);
      readDrawnFlowerCount(gl, flowerBatches).then((drawn) => {
        rt.cullReadPending = false;
        const hud = cullHudRef.current;
        if (!hud?.totalEl) return;
        hud.totalEl.textContent = `total ${total}`;
        hud.activeEl.textContent = `active ${active}`;
        hud.drawnEl.textContent = `drawn ${drawn}`;
      }).catch(() => {
        rt.cullReadPending = false;
      });
    }
  }, 1);

  if (!stems.length || !stemBuild.geometry || !stemMaterial) {
    return null;
  }

  return (
    <AsyncCompile id={`plant-system-${stems.length}`}>
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
              lodDistance={cullControls?.lodDistance}
              forceAllLow={forceAllLow}
              noFlowerShadows={noFlowerShadows}
              lowShadowCasters={lowShadowCasters}
            />
          </Suspense>
        ))}
      </group>
    </AsyncCompile>
  );
}
