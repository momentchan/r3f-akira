import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import { AsyncCompile } from '@core';
import { createBatchedStemMaterial, createFlowerUniforms } from '../look/createFlowerMaterials';
import {
  advanceLifecycleState,
  computeGrowthLifecycle,
  createLifecycleState,
  hashLifecycleIdentity,
  lifecycleLength,
  restoreLifecycleProgress,
} from '../lifecycle/plantLifecycle';
import { useLifecyclePauseHotkey } from '../lifecycle/useLifecyclePauseHotkey';
import { GROWTH_START_SCALE } from '../stem/buildStemTube';
import {
  applyTendrilLookDefaults,
  buildPackedTendrilSystem,
  treeSegmentGrowth,
} from '../tendrils/treeTendrilSystem';
import { computeWindSway, PLANT_WIND_DEFAULTS } from '../wind/plantWind';
import { buildGroundTrees } from './buildGroundTrees';
import { createGroundTendrilControlsSchema } from './groundTendrilControls';
import {
  GROUND_TENDRIL_DEFAULTS,
  GROUND_TENDRIL_HOST_PROFILES,
  GROUND_TENDRIL_INTERNALS,
} from './groundTendrilDefaults';
import { GroundTendrilDebug } from './GroundTendrilDebug';

const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();
const REBUILD_DEBOUNCE_MS = 100;
const DYNAMIC_TREE_ATTRIBUTES = [
  'position',
  'normal',
  'center',
  'previousPosition',
  'previousCenter',
];

function lifecyclePhaseFraction(seed) {
  const value = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function rebuildSnapshot(controls) {
  return {
    bodyTreeCount: controls.bodyTreeCount,
    backpackTreeCount: controls.backpackTreeCount,
    bodyShortTreeCount: controls.bodyShortTreeCount,
    backpackShortTreeCount: controls.backpackShortTreeCount,
    shortTreeLengthScale: controls.shortTreeLengthScale,
    directionCenter: controls.directionCenter,
    directionSpread: controls.directionSpread,
    branchDepth: controls.branchDepth,
    branchesPerLevel: controls.branchesPerLevel,
    trunkLength: controls.trunkLength,
    branchLengthScale: controls.branchLengthScale,
    branchAngleRange: [...controls.branchAngleRange],
    curvature: controls.curvature,
    lengthVariation: controls.lengthVariation,
    tendrilRadius: controls.tendrilRadius,
    radiusDecay: controls.radiusDecay,
    tipRadiusScale: controls.tipRadiusScale,
  };
}

export function GroundTendrils({
  bodyBounds = null,
  backpackBounds = null,
  completedTreesRef: externalCompletedTreesRef = null,
  treeLifecycleRef: externalTreeLifecycleRef = null,
  flowerTimingRef = null,
  routeRegistryRef: externalRouteRegistryRef = null,
  onGroundPaths = null,
  onGroundOffsetY = null,
  wind = PLANT_WIND_DEFAULTS,
}) {
  const lifecyclePausedRef = useLifecyclePauseHotkey();
  const schema = useMemo(
    () => createGroundTendrilControlsSchema(GROUND_TENDRIL_DEFAULTS),
    [],
  );
  const controls = useControls('Ground Tendrils', schema, { collapsed: false });
  const [rebuild, setRebuild] = useState(() => rebuildSnapshot(controls));

  // Geometry-heavy controls settle briefly before rebuilding. Visibility,
  // debug, lifecycle, and ground clearance never enter this dependency set.
  useEffect(() => {
    const id = window.setTimeout(
      () => setRebuild(rebuildSnapshot(controls)),
      REBUILD_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [
    controls.bodyTreeCount,
    controls.backpackTreeCount,
    controls.bodyShortTreeCount,
    controls.backpackShortTreeCount,
    controls.shortTreeLengthScale,
    controls.directionCenter,
    controls.directionSpread,
    controls.branchDepth,
    controls.branchesPerLevel,
    controls.trunkLength,
    controls.branchLengthScale,
    controls.branchAngleRange,
    controls.curvature,
    controls.lengthVariation,
    controls.tendrilRadius,
    controls.radiusDecay,
    controls.tipRadiusScale,
  ]);

  const hosts = useMemo(() => {
    const next = [];
    if (bodyBounds?.geometry && bodyBounds?.localBox) {
      next.push({
        id: 'body',
        geometry: bodyBounds.geometry,
        localBox: bodyBounds.localBox,
      });
    }
    if (backpackBounds?.geometry && backpackBounds?.localBox) {
      next.push({
        id: 'backpack',
        geometry: backpackBounds.geometry,
        localBox: backpackBounds.localBox,
      });
    }
    return next;
  }, [
    bodyBounds?.version,
    bodyBounds?.geometry,
    bodyBounds?.localBox,
    backpackBounds?.version,
    backpackBounds?.geometry,
    backpackBounds?.localBox,
  ]);

  const treeBuildOptions = useMemo(() => ({
    hosts,
    profiles: GROUND_TENDRIL_HOST_PROFILES,
    layoutSeed: GROUND_TENDRIL_INTERNALS.layoutSeed,
    generationSeedStep: GROUND_TENDRIL_INTERNALS.generationSeedStep,
    bodyTreeCount: rebuild.bodyTreeCount,
    backpackTreeCount: rebuild.backpackTreeCount,
    bodyShortTreeCount: rebuild.bodyShortTreeCount,
    backpackShortTreeCount: rebuild.backpackShortTreeCount,
    shortTreeLengthScale: rebuild.shortTreeLengthScale,
    shortTreeBranchDepth: GROUND_TENDRIL_INTERNALS.shortTreeBranchDepth,
    shortTreeDirectionSpread: GROUND_TENDRIL_INTERNALS.shortTreeDirectionSpread,
    shortTreeSeedOffset: GROUND_TENDRIL_INTERNALS.shortTreeSeedOffset,
    directionCenter: rebuild.directionCenter,
    directionSpread: rebuild.directionSpread,
    branchDepth: rebuild.branchDepth,
    branchesPerLevel: rebuild.branchesPerLevel,
    trunkLength: rebuild.trunkLength,
    branchLengthScale: rebuild.branchLengthScale,
    branchAngleRange: rebuild.branchAngleRange,
    curvature: rebuild.curvature,
    lengthVariation: rebuild.lengthVariation,
    radiusDecay: rebuild.radiusDecay,
    tipRadiusScale: rebuild.tipRadiusScale,
    groundY: 0,
    groundGap: 0,
    tendrilRadius: rebuild.tendrilRadius,
    contactBand: GROUND_TENDRIL_INTERNALS.contactBand,
  }), [rebuild, hosts]);

  const paths = useMemo(
    () => (hosts.length ? buildGroundTrees(treeBuildOptions) : []),
    [hosts.length, treeBuildOptions],
  );

  const treeVariants = useMemo(() => {
    const result = new Map();
    for (const path of paths) {
      const logicalTreeId = path.logicalTreeId ?? path.treeId;
      let variants = result.get(logicalTreeId);
      if (!variants) {
        variants = new Map();
        result.set(logicalTreeId, variants);
      }
      const variant = path.routeVariant ?? 0;
      const previous = variants.get(variant);
      const length = Math.max(previous?.length ?? 0, path.pathEndDistance);
      variants.set(variant, { treeId: path.treeId, length });
    }
    return result;
  }, [paths]);

  const flowerUniforms = useMemo(() => {
    const uniforms = createFlowerUniforms();
    applyTendrilLookDefaults(uniforms);
    return uniforms;
  }, []);

  const tendrilBuild = useMemo(() => buildPackedTendrilSystem(paths, {
    stemRadius: rebuild.tendrilRadius,
    stemSegments: GROUND_TENDRIL_INTERNALS.stemSegments,
    radialSegments: GROUND_TENDRIL_INTERNALS.radialSegments,
    radiusAttenuation: rebuild.tipRadiusScale,
    baseFlare: GROUND_TENDRIL_DEFAULTS.baseFlare,
  }), [paths, rebuild.tendrilRadius, rebuild.tipRadiusScale]);

  const material = useMemo(() => {
    if (!tendrilBuild.plantData) return null;
    return createBatchedStemMaterial(flowerUniforms, {
      plantDataTexture: tendrilBuild.plantData.tex,
      texWidth: tendrilBuild.plantData.width,
      maskPow: 2,
      startScale: GROWTH_START_SCALE,
      growthSegments: GROUND_TENDRIL_INTERNALS.stemSegments,
    });
  }, [tendrilBuild.plantData, flowerUniforms]);

  const lifecycleRanges = useMemo(() => ({
    delay: controls.restTimeRange,
    grow: controls.growthTimeRange,
    // The shared flower system supplies keep per tree at runtime.
    keep: [0, 0],
    die: controls.retractTimeRange,
  }), [
    controls.restTimeRange,
    controls.growthTimeRange,
    controls.retractTimeRange,
  ]);
  const lifecyclesRef = useRef(new Map());
  const localCompletedTreesRef = useRef(new Set());
  const localTreeLifecycleRef = useRef(new Map());
  const localRouteRegistryRef = useRef(new Map());
  const completedTreesRef = externalCompletedTreesRef ?? localCompletedTreesRef;
  const treeLifecycleRef = externalTreeLifecycleRef ?? localTreeLifecycleRef;
  const routeRegistryRef = externalRouteRegistryRef ?? localRouteRegistryRef;
  const pathIndexByIdRef = useRef(new Map());
  const routeGenerationsRef = useRef(new Map());
  const plantsRef = useRef(tendrilBuild.plants);
  const plantDataRef = useRef(tendrilBuild.plantData);
  const lightRef = useRef(null);

  useEffect(() => {
    plantsRef.current = tendrilBuild.plants;
    plantDataRef.current = tendrilBuild.plantData;
    pathIndexByIdRef.current.clear();
    routeGenerationsRef.current.clear();
    routeRegistryRef.current.clear();
    paths.forEach((path, index) => {
      const pathId = path.logicalPathId ?? path.id;
      pathIndexByIdRef.current.set(pathId, index);
      routeRegistryRef.current.set(pathId, path);
      routeGenerationsRef.current.set(
        path.logicalTreeId ?? path.treeId,
        path.routeGeneration ?? 0,
      );
    });
  }, [tendrilBuild, paths, routeRegistryRef]);

  useEffect(() => {
    onGroundPaths?.(controls.enabled ? paths : []);
  }, [onGroundPaths, paths, controls.enabled]);

  useEffect(() => {
    onGroundOffsetY?.(controls.enabled ? controls.groundGap : 0);
  }, [onGroundOffsetY, controls.enabled, controls.groundGap]);

  useEffect(() => () => {
    onGroundPaths?.([]);
    onGroundOffsetY?.(0);
    completedTreesRef.current.clear();
    treeLifecycleRef.current.clear();
    routeRegistryRef.current.clear();
  }, [
    onGroundPaths,
    onGroundOffsetY,
    completedTreesRef,
    treeLifecycleRef,
    routeRegistryRef,
  ]);

  useEffect(() => {
    const previous = lifecyclesRef.current;
    completedTreesRef.current.clear();
    const lifecycles = new Map();
    for (const [treeId, variants] of treeVariants) {
      const routeGeneration = 0;
      const previousLifecycle = previous.get(treeId);
      const preserveProgress = previousLifecycle?.routeGeneration === routeGeneration;
      const state = createLifecycleState({
        seed: GROUND_TENDRIL_INTERNALS.layoutSeed
          + routeGeneration * GROUND_TENDRIL_INTERNALS.generationSeedStep
          + hashLifecycleIdentity(treeId),
        ranges: lifecycleRanges,
        initialStagger: GROUND_TENDRIL_INTERNALS.initialStagger,
        rerollEachGeneration: true,
      });
      if (preserveProgress) {
        restoreLifecycleProgress(state, previousLifecycle, lifecycleRanges);
      } else {
        state.age = -lifecyclePhaseFraction(state.seed)
          * GROUND_TENDRIL_INTERNALS.initialStartSpread;
      }
      lifecycles.set(treeId, {
        ...state,
        variants,
        routeGeneration,
      });
    }
    lifecyclesRef.current = lifecycles;
    for (const treeId of treeLifecycleRef.current.keys()) {
      if (!lifecycles.has(treeId)) treeLifecycleRef.current.delete(treeId);
    }
  }, [
    treeVariants,
    lifecycleRanges,
    completedTreesRef,
    treeLifecycleRef,
  ]);

  useEffect(() => () => {
    tendrilBuild.geometry?.dispose();
    tendrilBuild.plantData?.tex.dispose();
    material?.dispose();
  }, [tendrilBuild, material]);

  useFrame(({ scene, clock }, delta) => {
    if (!controls.enabled) return;
    const plants = plantsRef.current;
    const plantData = plantDataRef.current;
    if (!plants.length || !plantData) return;

    if (!lightRef.current) {
      scene.traverse((object) => {
        if (!lightRef.current && object.isDirectionalLight) lightRef.current = object;
      });
    }
    if (lightRef.current) {
      lightRef.current.updateWorldMatrix(true, false);
      lightRef.current.target.updateWorldMatrix(true, false);
      lightRef.current.getWorldPosition(_lightWorld);
      lightRef.current.target.getWorldPosition(_lightTarget);
      flowerUniforms.lightDir.value.copy(_lightWorld.sub(_lightTarget).normalize());
    }

    const fronts = new Map();
    const flowerTiming = flowerTimingRef?.current;
    const flowerTreeIds = flowerTiming?.treeIds;
    const timingReady = flowerTiming?.ready ?? !flowerTimingRef;
    const treesToResample = new Set();
    completedTreesRef.current.clear();
    for (const [treeId, lifecycle] of lifecyclesRef.current) {
      const waitsForFlowers = flowerTreeIds?.has(treeId) ?? false;
      const measuredFlowerDuration = flowerTiming?.durationByTreeId?.get(treeId);
      const flowerDuration = measuredFlowerDuration
        ?? Math.max(flowerTiming?.maxDuration ?? 0, 0);
      lifecycle.durations.keep = waitsForFlowers ? flowerDuration : 0;
      const lifetime = lifecycleLength(lifecycle.durations);
      if (!lifecyclePausedRef.current && timingReady) {
        lifecycle.age = Math.min(lifecycle.age + Math.min(delta, 0.1), lifetime);
        if (lifecycle.age >= lifetime) {
          advanceLifecycleState(lifecycle, 0, lifecycleRanges);
          routeGenerationsRef.current.set(treeId, lifecycle.generation);
          treesToResample.add(treeId);
        }
      }
      const growthState = computeGrowthLifecycle(lifecycle.age, lifecycle.durations);
      const growEnd = lifecycle.durations.delay + lifecycle.durations.grow;
      const flowerEnd = growEnd + lifecycle.durations.keep;
      let phase = growthState.phase;
      if (lifecycle.age >= growEnd && lifecycle.age < flowerEnd) phase = 'flowers';
      else if (lifecycle.age >= flowerEnd) phase = 'ground-retract';

      if (phase === 'flowers') completedTreesRef.current.add(treeId);
      treeLifecycleRef.current.set(treeId, {
        phase,
        generation: lifecycle.generation,
        flowerAge: phase === 'flowers' ? lifecycle.age - growEnd : 0,
      });
      const growth = growthState.growth;
      const route = lifecycle.variants.get(0);
      if (route) fronts.set(route.treeId, growth * Math.max(route.length, 1e-6));
    }

    if (treesToResample.size && tendrilBuild.geometry) {
      const generatedPaths = buildGroundTrees({
        ...treeBuildOptions,
        treeGenerations: Object.fromEntries(routeGenerationsRef.current),
      });
      const replacementPaths = generatedPaths.filter((path) => (
        treesToResample.has(path.logicalTreeId ?? path.treeId)
      ));
      const replacementBuild = buildPackedTendrilSystem(replacementPaths, {
        stemRadius: rebuild.tendrilRadius,
        stemSegments: GROUND_TENDRIL_INTERNALS.stemSegments,
        radialSegments: GROUND_TENDRIL_INTERNALS.radialSegments,
        radiusAttenuation: rebuild.tipRadiusScale,
        baseFlare: GROUND_TENDRIL_DEFAULTS.baseFlare,
      });
      const verticesPerPath = (GROUND_TENDRIL_INTERNALS.stemSegments + 1)
        * (GROUND_TENDRIL_INTERNALS.radialSegments + 1);

      replacementBuild.plants.forEach((replacement, localIndex) => {
        const pathId = replacement.logicalPathId ?? replacement.id;
        const targetIndex = pathIndexByIdRef.current.get(pathId);
        if (!Number.isInteger(targetIndex)) return;
        for (const attributeName of DYNAMIC_TREE_ATTRIBUTES) {
          const sourceAttribute = replacementBuild.geometry?.getAttribute(attributeName);
          const targetAttribute = tendrilBuild.geometry.getAttribute(attributeName);
          if (!sourceAttribute || !targetAttribute) continue;
          const valuesPerPath = verticesPerPath * targetAttribute.itemSize;
          const sourceStart = localIndex * valuesPerPath;
          const targetStart = targetIndex * valuesPerPath;
          targetAttribute.array.set(
            sourceAttribute.array.subarray(sourceStart, sourceStart + valuesPerPath),
            targetStart,
          );
          targetAttribute.needsUpdate = true;
        }

        const targetPlant = plants[targetIndex];
        const plantId = targetPlant.plantId;
        Object.assign(targetPlant, replacement, { plantId });
        routeRegistryRef.current.set(pathId, replacement);
      });

      for (const treeId of treesToResample) {
        const lifecycle = lifecyclesRef.current.get(treeId);
        if (!lifecycle) continue;
        const length = replacementPaths
          .filter((path) => (path.logicalTreeId ?? path.treeId) === treeId)
          .reduce((max, path) => Math.max(max, path.pathEndDistance), 0);
        lifecycle.variants.set(0, { treeId, length });
      }
      replacementBuild.geometry?.dispose();
      replacementBuild.plantData?.tex.dispose();
    }

    const { data, width, tex } = plantData;
    for (let i = 0; i < plants.length; i += 1) {
      const plant = plants[i];
      const growth = treeSegmentGrowth(
        fronts.get(plant.treeId) ?? 0,
        plant.pathStartDistance,
        plant.pathEndDistance,
      );
      // Ground growth shares the wind field, but remains much more anchored
      // than upright stems or body wraps.
      const [swayX, swayZ] = computeWindSway(
        plant.motionPosition[0],
        plant.motionPosition[2],
        clock.elapsedTime,
        wind,
        GROUND_TENDRIL_INTERNALS.windResponse,
      );
      const offset = i * 4;
      plant.stemGrow = growth;
      data[offset] = growth;
      data[offset + 1] = swayX;
      data[offset + 2] = swayZ;
      data[offset + 3] = 0;
    }
    for (let i = plants.length; i < width; i += 1) {
      const offset = i * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
    tex.needsUpdate = true;
  }, 1);

  if (!controls.enabled) return null;
  const showTendrils = Boolean(
    tendrilBuild.geometry
    && material
    && tendrilBuild.plants.length
    && !controls.hideRenderedTendrils,
  );

  return (
    <group name="GroundTendrils" position-y={controls.groundGap}>
      {showTendrils && (
        <AsyncCompile id={`ground-tendrils-${tendrilBuild.plants.length}`}>
          <mesh
            geometry={tendrilBuild.geometry}
            material={material}
            frustumCulled={false}
            castShadow
            receiveShadow
          />
        </AsyncCompile>
      )}
      <GroundTendrilDebug
        visible={controls.showDebug}
        paths={paths.filter((path) => (path.routeVariant ?? 0) === 0)}
      />
    </group>
  );
}
