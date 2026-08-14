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
import { FieldLeaves } from '../stem/FieldLeaves';
import { buildWrapCurves } from './buildWrapCurve';
import { ClimbDebug } from './ClimbDebug';
import { createClimbControlsSchema } from './climbControls';
import { CLIMB_DEFAULTS } from './climbDefaults';
import { sampleLivingMotionOffset } from './spatialNoise';

const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();
const PATH_DEBOUNCE_MS = 120;
const MAX_TOTAL_TENDRILS = 512;
const TUBE_SEGMENTS = 60;
const TUBE_RADIAL_SEGMENTS = 3;
const GENERATION_SEED_STEP = 131;

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

function lifecyclePhase(seed) {
  const value = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function lifecycleLength(durations) {
  return durations.delay + durations.grow + durations.keep + durations.die;
}

function pathKeyFromControls(c) {
  return [
    c.region,
    c.layoutSeed,
    c.curveSamples,
    c.tendrilCount,
    c.spacingVariation,
    c.wrapAngleRange,
    c.axialWeave,
    c.entryBend,
    c.surfaceOffset,
    c.noiseAmount,
    c.noiseFrequency,
    c.noiseSeed,
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
    tendrilCount: controls.tendrilCount,
    spacingVariation: controls.spacingVariation,
    wrapAngleRange: controls.wrapAngleRange,
    axialWeave: controls.axialWeave,
    entryBend: controls.entryBend,
    surfaceOffset: controls.surfaceOffset,
    noiseAmount: controls.noiseAmount,
    noiseFrequency: controls.noiseFrequency,
    noiseSeed: controls.noiseSeed,
  }));

  useEffect(() => {
    const next = {
      key: livePathKey,
      region: controls.region,
      layoutSeed: controls.layoutSeed,
      curveSamples: controls.curveSamples,
      tendrilCount: controls.tendrilCount,
      spacingVariation: controls.spacingVariation,
      wrapAngleRange: controls.wrapAngleRange,
      axialWeave: controls.axialWeave,
      entryBend: controls.entryBend,
      surfaceOffset: controls.surfaceOffset,
      noiseAmount: controls.noiseAmount,
      noiseFrequency: controls.noiseFrequency,
      noiseSeed: controls.noiseSeed,
    };
    const id = window.setTimeout(() => setDebouncedPath(next), PATH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [
    livePathKey,
    controls.region,
    controls.layoutSeed,
    controls.curveSamples,
    controls.tendrilCount,
    controls.spacingVariation,
    controls.wrapAngleRange,
    controls.axialWeave,
    controls.entryBend,
    controls.surfaceOffset,
    controls.noiseAmount,
    controls.noiseFrequency,
    controls.noiseSeed,
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
      tendrilCount: Math.min(debouncedPath.tendrilCount, MAX_TOTAL_TENDRILS),
      layoutSeed: debouncedPath.layoutSeed,
      curveSamples: debouncedPath.curveSamples,
      spacingVariation: debouncedPath.spacingVariation,
      surfaceOffset: debouncedPath.surfaceOffset,
      entrySide: 'random-lateral',
      entrySideBias: 1,
      wrapAngleRange: debouncedPath.wrapAngleRange,
      axialWeave: debouncedPath.axialWeave,
      entryBend: debouncedPath.entryBend,
      noiseAmount: debouncedPath.noiseAmount,
      noiseFrequency: debouncedPath.noiseFrequency,
      noiseSeed: debouncedPath.noiseSeed,
      enabledCapsuleIds: REGION_CAPSULE_IDS[debouncedPath.region] ?? null,
    });
  }, [controls.enabled, hosts, debouncedPath]);

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
      radiusAttenuation: controls.radiusAttenuation,
      baseFlare: controls.baseFlare,
    });

    if (!geometry) {
      return { geometry: null, plantData: null, plants: [] };
    }

    const motionSample = new THREE.Vector3();
    const plants = wraps.map((wrap, plantId) => {
      wrap.curve.getPointAt(0.5, motionSample);
      return {
        seed: wrap.seed,
        plantId,
        hostId: wrap.hostId,
        curve: wrap.curve,
        motionPosition: [motionSample.x, motionSample.y, motionSample.z],
        position: [0, 0, 0],
        params: {
          stemLength: wrap.curve.getLength(),
          stemRadius: controls.tendrilRadius,
          radiusAttenuation: controls.radiusAttenuation,
          baseFlare: controls.baseFlare,
        },
        durations: null,
        age: 0,
        generation: 0,
      };
    });

    return { geometry, plantData, plants };
  }, [
    wraps,
    controls.tendrilRadius,
    controls.radiusAttenuation,
    controls.baseFlare,
  ]);

  const stemMaterial = useMemo(() => {
    if (!stemBuild.plantData) return null;
    return createBatchedStemMaterial(flowerUniforms, {
      plantDataTexture: stemBuild.plantData.tex,
      texWidth: stemBuild.plantData.width,
      maskPow: 2,
      startScale: GROWTH_START_SCALE,
      growthSegments: TUBE_SEGMENTS,
    });
  }, [stemBuild.plantData, flowerUniforms]);

  const plantsRef = useRef(stemBuild.plants);
  const plantDataRef = useRef(stemBuild.plantData);
  const lightRef = useRef(null);
  const lifecycleRef = useRef(lifecycleRanges);
  lifecycleRef.current = lifecycleRanges;
  const phaseSpreadRef = useRef(controls.initialPhaseSpread);
  phaseSpreadRef.current = controls.initialPhaseSpread;
  const motionRef = useRef(null);
  motionRef.current = {
    amount: controls.motionAmount,
    frequency: controls.motionFrequency,
    speed: controls.motionSpeed,
    seed: controls.layoutSeed,
  };

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
        next[i].generation = prev[i].generation;
        next[i].durations = prev[i].durations;
      } else {
        const life = lifecycleLength(durations);
        next[i].age = lifecyclePhase(next[i].seed)
          * life
          * phaseSpreadRef.current;
        next[i].generation = 0;
      }
    }
    plantsRef.current = next;
    plantDataRef.current = stemBuild.plantData;
  }, [stemBuild]);

  // Refresh and redistribute phases when lifecycle timing changes (no geometry rebuild).
  useEffect(() => {
    const plants = plantsRef.current;
    for (let i = 0; i < plants.length; i += 1) {
      const plant = plants[i];
      plant.generation = 0;
      plant.durations = computeDurations(plant.seed, lifecycleRanges);
      plant.age = lifecyclePhase(plant.seed)
        * lifecycleLength(plant.durations)
        * controls.initialPhaseSpread;
    }
  }, [lifecycleRanges, controls.initialPhaseSpread]);

  useEffect(() => () => {
    stemBuild.geometry?.dispose();
    stemBuild.plantData?.tex.dispose();
    stemMaterial?.dispose();
  }, [stemBuild, stemMaterial]);

  useFrame(({ scene, clock }, delta) => {
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

      plant.age += dt;
      let life = lifecycleLength(plant.durations);
      if (plant.age >= life) {
        const overflow = plant.age - life;
        plant.generation += 1;
        plant.durations = computeDurations(
          plant.seed + plant.generation * GENERATION_SEED_STEP,
          lifecycleRef.current,
        );
        life = lifecycleLength(plant.durations);
        plant.age = Math.min(overflow, Math.max(life - 1e-6, 0));
      }

      const { stemGrow } = computeLifecycle(plant.age, plant.durations, 0.3, 0.23);
      const [motionX, motionZ] = sampleLivingMotionOffset(
        plant.motionPosition[0],
        plant.motionPosition[1],
        plant.motionPosition[2],
        clock.elapsedTime,
        motionRef.current,
      );
      const o = i * 4;
      data[o] = stemGrow;
      data[o + 1] = motionX;
      data[o + 2] = motionZ;
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
        <AsyncCompile id={`climb-tendrils-${stemBuild.plants.length}-${controls.leafCount}`}>
          <group>
            <mesh
              geometry={stemBuild.geometry}
              material={stemMaterial}
              frustumCulled={false}
              castShadow
              receiveShadow
            />
            {controls.leafCount > 0 && (
              <FieldLeaves
                plants={stemBuild.plants}
                plantData={stemBuild.plantData}
                flowerUniforms={flowerUniforms}
                leafCount={controls.leafCount}
                leafSpan={controls.leafSpan}
                leafScale={controls.leafScale}
                scaleVariance={controls.leafScaleVariation}
                droop={controls.leafDroop}
                leafBend={controls.leafCurl}
                curlStrength={[4, 1]}
                curlPower={[6, 1]}
                bendStrength={0}
                bendVariance={controls.leafCurlVariation}
                colorLevels={controls.leafColorLevels}
              />
            )}
          </group>
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
