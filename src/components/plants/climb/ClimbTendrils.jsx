import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import { AsyncCompile } from '@core';
import { createBatchedStemMaterial, createFlowerUniforms } from '../look/createFlowerMaterials';
import { FLOWER_DEFAULTS } from '../look/flowerDefaults';
import {
  buildPackedStemTubes,
  GROWTH_START_SCALE,
} from '../stem/buildStemTube';
import { computeDurations, computeLifecycle } from '../stem/flowerLifecycle';
import { buildWrapCurves } from './buildWrapCurve';
import { ClimbDebug } from './ClimbDebug';
import { createClimbControlsSchema } from './climbControls';
import { CLIMB_DEFAULTS } from './climbDefaults';

const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();
const PATH_DEBOUNCE_MS = 120;
const MAX_TOTAL_RINGS = 512;
const MAX_RINGS_PER_REGION = 12;
const TUBE_SEGMENTS = 30;
const TUBE_RADIAL_SEGMENTS = 3;
const TUBE_TIP_SCALE = 0.35;
const TUBE_BASE_FLARE = 0.12;

const REGION_CAPSULE_IDS = {
  'calf.r': ['calf.r'],
  calves: ['calf.l', 'calf.r'],
  legs: ['calf.l', 'calf.r', 'thigh.l', 'thigh.r'],
  arms: ['forearm.l', 'forearm.r', 'upperarm.l', 'upperarm.r'],
  limbs: [
    'calf.l',
    'calf.r',
    'thigh.l',
    'thigh.r',
    'forearm.l',
    'forearm.r',
    'upperarm.l',
    'upperarm.r',
  ],
  torso: ['torso'],
  all: null,
};

function createPlantDataTexture(count) {
  const width = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(count));
  const data = new Float32Array(width * 4);
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, data, width };
}

function applyStemLookDefaults(uniforms) {
  const d = FLOWER_DEFAULTS.stem;
  const { stem } = uniforms;
  stem.colorLevels.value = d.colorLevels;
  stem.thresholdLow.value = d.thresholdLow;
  stem.thresholdHigh.value = d.thresholdHigh;
  stem.shadowColor.value.set(d.shadowColor);
  stem.highlightColor.value.set(d.highlightColor);
  stem.edgeColor.value.set(d.edgeColor);
  stem.edgeThreshold.value = d.edgeThreshold;
  stem.edgeSoftness.value = d.edgeSoftness;
}

function pathKeyFromControls(c) {
  return [
    c.region,
    c.layoutSeed,
    c.curveSamples,
    c.ringSpacing,
    c.spacingVariation,
    c.wrapAngleDegrees,
    c.entryBend,
    c.surfaceOffset,
  ].join(':');
}

/**
 * Independent, body-wrapping tendrils with packed single-draw growth.
 */
export function ClimbTendrils({
  bodyBounds = null,
}) {
  const schema = useMemo(() => createClimbControlsSchema(CLIMB_DEFAULTS), []);
  const controls = useControls('Climb', schema, { collapsed: true });

  const hosts = useMemo(() => {
    const list = [];
    if (bodyBounds?.bvh && bodyBounds?.localBox) {
      list.push({
        id: 'body',
        bvh: bodyBounds.bvh,
        localBox: bodyBounds.localBox,
        capsules: bodyBounds.capsules ?? [],
        capsuleDiagnostics: bodyBounds.capsuleDiagnostics ?? null,
        bodyRight: bodyBounds.bodyRight ?? null,
      });
    }
    return list;
  }, [
    bodyBounds?.version,
    bodyBounds?.bvh,
    bodyBounds?.capsules,
    bodyBounds?.capsuleDiagnostics,
    bodyBounds?.bodyRight,
  ]);

  // Debounce expensive wrap-path params so Leva drags don't rebuild every frame.
  const livePathKey = pathKeyFromControls(controls);
  const [debouncedPath, setDebouncedPath] = useState(() => ({
    key: livePathKey,
    region: controls.region,
    layoutSeed: controls.layoutSeed,
    curveSamples: controls.curveSamples,
    ringSpacing: controls.ringSpacing,
    spacingVariation: controls.spacingVariation,
    wrapAngleDegrees: controls.wrapAngleDegrees,
    entryBend: controls.entryBend,
    surfaceOffset: controls.surfaceOffset,
  }));

  useEffect(() => {
    const next = {
      key: livePathKey,
      region: controls.region,
      layoutSeed: controls.layoutSeed,
      curveSamples: controls.curveSamples,
      ringSpacing: controls.ringSpacing,
      spacingVariation: controls.spacingVariation,
      wrapAngleDegrees: controls.wrapAngleDegrees,
      entryBend: controls.entryBend,
      surfaceOffset: controls.surfaceOffset,
    };
    const id = window.setTimeout(() => setDebouncedPath(next), PATH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [
    livePathKey,
    controls.region,
    controls.layoutSeed,
    controls.curveSamples,
    controls.ringSpacing,
    controls.spacingVariation,
    controls.wrapAngleDegrees,
    controls.entryBend,
    controls.surfaceOffset,
  ]);

  const flowerUniforms = useMemo(() => {
    const u = createFlowerUniforms();
    applyStemLookDefaults(u);
    return u;
  }, []);

  const wraps = useMemo(() => {
    if (!controls.enabled || !hosts.length) return [];
    return buildWrapCurves({
      hosts,
      maxRings: MAX_TOTAL_RINGS,
      layoutSeed: debouncedPath.layoutSeed,
      curveSamples: debouncedPath.curveSamples,
      ringSpacing: debouncedPath.ringSpacing,
      spacingVariation: debouncedPath.spacingVariation,
      surfaceOffset: debouncedPath.surfaceOffset,
      maxRingsPerRegion: MAX_RINGS_PER_REGION,
      entrySide: 'random-lateral',
      entrySideBias: 1,
      wrapAngleDegrees: debouncedPath.wrapAngleDegrees,
      entryBend: debouncedPath.entryBend,
      enabledCapsuleIds: REGION_CAPSULE_IDS[debouncedPath.region] ?? null,
    });
  }, [controls.enabled, hosts, debouncedPath]);

  const lifecycleRanges = useMemo(() => ({
    delay: [0, controls.maxStartDelay],
    grow: controls.growthTimeRange,
    // Settle mode stops at the end of growth; these phases are never played.
    keep: [1, 1],
    die: [1, 1],
  }), [controls.maxStartDelay, controls.growthTimeRange]);

  const stemBuild = useMemo(() => {
    if (!wraps.length) {
      return { geometry: null, plantData: null, plants: [] };
    }

    const plantData = createPlantDataTexture(wraps.length);
    const packed = wraps.map((wrap, plantId) => ({
      curve: wrap.curve,
      plantId,
    }));

    const geometry = buildPackedStemTubes(packed, {
      stemRadius: controls.tendrilRadius,
      stemSegments: TUBE_SEGMENTS,
      radialSegs: TUBE_RADIAL_SEGMENTS,
      radiusAttenuation: TUBE_TIP_SCALE,
      baseFlare: TUBE_BASE_FLARE,
    });

    if (!geometry) {
      return { geometry: null, plantData: null, plants: [] };
    }

    const plants = wraps.map((wrap, plantId) => {
      return {
        seed: wrap.seed,
        plantId,
        hostId: wrap.hostId,
        curve: wrap.curve,
        position: [0, 0, 0],
        durations: null,
        age: 0,
        settled: false,
      };
    });

    return { geometry, plantData, plants };
  }, [
    wraps,
    controls.tendrilRadius,
  ]);

  const stemMaterial = useMemo(() => {
    if (!stemBuild.plantData) return null;
    return createBatchedStemMaterial(flowerUniforms, {
      plantDataTexture: stemBuild.plantData.tex,
      texWidth: stemBuild.plantData.width,
      maskPow: 2,
      startScale: GROWTH_START_SCALE,
    });
  }, [stemBuild.plantData, flowerUniforms]);

  const plantsRef = useRef(stemBuild.plants);
  const plantDataRef = useRef(stemBuild.plantData);
  const lightRef = useRef(null);
  const lifecycleRef = useRef(lifecycleRanges);
  lifecycleRef.current = lifecycleRanges;

  // Preserve ages across tube rebuilds when seeds align; assign durations.
  useEffect(() => {
    const prev = plantsRef.current;
    const next = stemBuild.plants;
    const ranges = lifecycleRef.current;
    for (let i = 0; i < next.length; i += 1) {
      const durations = computeDurations(next[i].seed, ranges);
      next[i].durations = durations;
      if (prev?.length === next.length && prev[i]?.seed === next[i].seed) {
        next[i].age = prev[i].age;
        next[i].settled = prev[i].settled;
      } else {
        next[i].age = 0;
        next[i].settled = false;
      }
    }
    plantsRef.current = next;
    plantDataRef.current = stemBuild.plantData;
  }, [stemBuild]);

  // Refresh durations when lifecycle ranges change (no geometry rebuild).
  useEffect(() => {
    const plants = plantsRef.current;
    for (let i = 0; i < plants.length; i += 1) {
      plants[i].durations = computeDurations(plants[i].seed, lifecycleRanges);
      plants[i].age = 0;
      plants[i].settled = false;
    }
  }, [lifecycleRanges]);

  useEffect(() => () => {
    stemBuild.geometry?.dispose();
    stemBuild.plantData?.tex.dispose();
    stemMaterial?.dispose();
  }, [stemBuild, stemMaterial]);

  useFrame(({ scene }, delta) => {
    const plants = plantsRef.current;
    const plantData = plantDataRef.current;
    if (!plants.length || !plantData) return;

    if (!lightRef.current) {
      scene.traverse((obj) => {
        if (!lightRef.current && obj.isDirectionalLight) lightRef.current = obj;
      });
    }
    const light = lightRef.current;
    if (light) {
      light.updateWorldMatrix(true, false);
      light.target.updateWorldMatrix(true, false);
      light.getWorldPosition(_lightWorld);
      light.target.getWorldPosition(_lightTarget);
      flowerUniforms.lightDir.value.copy(_lightWorld.sub(_lightTarget).normalize());
    }

    const { data, width, tex } = plantData;
    const dt = Math.min(delta, 0.1);

    for (let i = 0; i < plants.length; i += 1) {
      const plant = plants[i];
      if (!plant.durations) continue;

      const growEnd = plant.durations.delay + plant.durations.grow;

      if (!plant.settled) {
        plant.age += dt;
        if (plant.age >= growEnd) {
          plant.age = growEnd;
          plant.settled = true;
        }
      }

      const { stemGrow } = computeLifecycle(plant.age, plant.durations, 0.3, 0.23);

      const o = i * 4;
      data[o] = stemGrow;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
    }
    for (let i = plants.length; i < width; i += 1) {
      const o = i * 4;
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
    }
    tex.needsUpdate = true;
  }, 1);

  if (!controls.enabled) return null;

  const showStems = Boolean(stemBuild.geometry && stemMaterial && stemBuild.plants.length);
  const debugVisible = Boolean(controls.showDebug);

  return (
    <group name="ClimbTendrils">
      {showStems && (
        <AsyncCompile id={`climb-tendrils-${stemBuild.plants.length}`}>
          <mesh
            geometry={stemBuild.geometry}
            material={stemMaterial}
            frustumCulled={false}
            castShadow
            receiveShadow
          />
        </AsyncCompile>
      )}
      <ClimbDebug
        visible={debugVisible}
        wraps={wraps}
        hosts={hosts}
        showSeeds={controls.showSeeds}
        showHitch={false}
        showPaths={controls.showPaths}
        showDirs={false}
        showBounds={false}
        showCapsules={controls.showCapsules}
        showCapsuleLabels={controls.showCapsuleLabels}
        showDiagnostics={controls.showDiagnostics}
        showPathLabels={controls.showCapsuleLabels}
        capsuleFilterId={null}
        pathCount={controls.pathCount}
      />
    </group>
  );
}
