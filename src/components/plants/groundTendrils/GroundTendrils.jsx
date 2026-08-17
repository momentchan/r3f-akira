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

function rebuildSnapshot(controls) {
  return {
    bodyTreeCount: controls.bodyTreeCount,
    backpackTreeCount: controls.backpackTreeCount,
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

  const paths = useMemo(() => {
    if (!hosts.length) return [];
    return buildGroundTrees({
      hosts,
      profiles: GROUND_TENDRIL_HOST_PROFILES,
      layoutSeed: GROUND_TENDRIL_INTERNALS.layoutSeed,
      bodyTreeCount: rebuild.bodyTreeCount,
      backpackTreeCount: rebuild.backpackTreeCount,
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
    });
  }, [rebuild, hosts]);

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
    keep: controls.holdTimeRange,
    die: controls.retractTimeRange,
  }), [
    controls.restTimeRange,
    controls.growthTimeRange,
    controls.holdTimeRange,
    controls.retractTimeRange,
  ]);
  const lifecyclesRef = useRef(new Map());
  const plantsRef = useRef(tendrilBuild.plants);
  const plantDataRef = useRef(tendrilBuild.plantData);
  const lightRef = useRef(null);

  useEffect(() => {
    plantsRef.current = tendrilBuild.plants;
    plantDataRef.current = tendrilBuild.plantData;
  }, [tendrilBuild]);

  useEffect(() => {
    const previous = lifecyclesRef.current;
    const lifecycles = new Map();
    for (const [treeId, length] of tendrilBuild.treeLengths) {
      const state = createLifecycleState({
          seed: GROUND_TENDRIL_INTERNALS.layoutSeed + hashLifecycleIdentity(treeId),
          ranges: lifecycleRanges,
          initialStagger: GROUND_TENDRIL_INTERNALS.initialStagger,
          rerollEachGeneration: true,
      });
      restoreLifecycleProgress(state, previous.get(treeId), lifecycleRanges);
      lifecycles.set(treeId, { ...state, length });
    }
    lifecyclesRef.current = lifecycles;
  }, [tendrilBuild.treeLengths, lifecycleRanges]);

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
    for (const [treeId, lifecycle] of lifecyclesRef.current) {
      const growth = lifecyclePausedRef.current
        ? computeGrowthLifecycle(lifecycle.age, lifecycle.durations).growth
        : advanceLifecycleState(lifecycle, Math.min(delta, 0.1), lifecycleRanges).growth;
      fronts.set(treeId, growth * Math.max(lifecycle.length, 1e-6));
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
        0.04,
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
      <GroundTendrilDebug visible={controls.showDebug} paths={paths} />
    </group>
  );
}
