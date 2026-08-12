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
import { computeWindSway } from '../stem/wind';
import { buildWrapCurves } from './buildWrapCurve';
import { ClimbDebug } from './ClimbDebug';
import { createClimbControlsSchema } from './climbControls';
import { CLIMB_DEFAULTS } from './climbDefaults';

const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();
const PATH_DEBOUNCE_MS = 120;
// Checkpoint gate: Step 3 expands independent rings across directed regions.
const CLIMB_CHECKPOINT = 3;
const CHECKPOINT_DEBUG_ONLY = CLIMB_CHECKPOINT <= 3;

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

function phaseFrac(seed) {
  const s = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function pathKeyFromControls(c) {
  return [
    c.count,
    c.region,
    c.bodyRatio,
    c.arrangementSeed,
    c.sampleCount,
    c.stepLength,
    c.stationJitter,
    c.turns,
    c.ringArcDegrees,
    c.rootBendStrength,
    c.climbBias,
    c.clearGap,
    c.peelAt,
    c.maxCoilsPerCapsule,
    c.debugSingleHelix,
    c.debugCapsuleId,
  ].join(':');
}

function tubeKeyFromControls(c) {
  return [
    c.stemRadius,
    c.radiusAttenuation,
    c.baseFlare,
    c.stemSegments,
    c.radialSegs,
  ].join(':');
}

/**
 * Dense climbing tendrils wrapping body / backpack MeshBVH surfaces.
 * Packed single-draw stems + field-style grow/sway. Leaves deferred.
 */
export function ClimbTendrils({
  bodyBounds = null,
  backpackBounds = null,
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
    if (backpackBounds?.bvh && backpackBounds?.localBox) {
      list.push({
        id: 'backpack',
        bvh: backpackBounds.bvh,
        localBox: backpackBounds.localBox,
        capsules: [],
      });
    }
    return list;
  }, [
    bodyBounds?.version,
    bodyBounds?.bvh,
    bodyBounds?.capsules,
    bodyBounds?.capsuleDiagnostics,
    bodyBounds?.bodyRight,
    backpackBounds?.version,
    backpackBounds?.bvh,
  ]);

  // Debounce expensive wrap-path params so Leva drags don't rebuild every frame.
  const livePathKey = pathKeyFromControls(controls);
  const [debouncedPath, setDebouncedPath] = useState(() => ({
    key: livePathKey,
    count: controls.count,
    region: controls.region,
    bodyRatio: controls.bodyRatio,
    arrangementSeed: controls.arrangementSeed,
    sampleCount: controls.sampleCount,
    stepLength: controls.stepLength,
    stationJitter: controls.stationJitter,
    turns: controls.turns,
    ringArcDegrees: controls.ringArcDegrees,
    rootBendStrength: controls.rootBendStrength,
    climbBias: controls.climbBias,
    clearGap: controls.clearGap,
    peelAt: controls.peelAt,
    maxCoilsPerCapsule: controls.maxCoilsPerCapsule,
    debugSingleHelix: controls.debugSingleHelix,
    debugCapsuleId: controls.debugCapsuleId,
  }));

  useEffect(() => {
    const next = {
      key: livePathKey,
      count: controls.count,
      region: controls.region,
      bodyRatio: controls.bodyRatio,
      arrangementSeed: controls.arrangementSeed,
      sampleCount: controls.sampleCount,
      stepLength: controls.stepLength,
      stationJitter: controls.stationJitter,
      turns: controls.turns,
      ringArcDegrees: controls.ringArcDegrees,
      rootBendStrength: controls.rootBendStrength,
      climbBias: controls.climbBias,
      clearGap: controls.clearGap,
      peelAt: controls.peelAt,
      maxCoilsPerCapsule: controls.maxCoilsPerCapsule,
      debugSingleHelix: controls.debugSingleHelix,
      debugCapsuleId: controls.debugCapsuleId,
    };
    const id = window.setTimeout(() => setDebouncedPath(next), PATH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [
    livePathKey,
    controls.count,
    controls.region,
    controls.bodyRatio,
    controls.arrangementSeed,
    controls.sampleCount,
    controls.stepLength,
    controls.stationJitter,
    controls.turns,
    controls.ringArcDegrees,
    controls.rootBendStrength,
    controls.climbBias,
    controls.clearGap,
    controls.peelAt,
    controls.maxCoilsPerCapsule,
    controls.debugSingleHelix,
    controls.debugCapsuleId,
  ]);

  const flowerUniforms = useMemo(() => {
    const u = createFlowerUniforms();
    applyStemLookDefaults(u);
    return u;
  }, []);

  const hostVersionKey = `${bodyBounds?.version ?? 0}:${backpackBounds?.version ?? 0}`;

  const wraps = useMemo(() => {
    if (CLIMB_CHECKPOINT === 1) return [];
    if (!controls.enabled || !hosts.length || debouncedPath.count < 1) return [];
    return buildWrapCurves({
      hosts,
      count: debouncedPath.count,
      bodyRatio: CLIMB_CHECKPOINT <= 3 ? 1 : debouncedPath.bodyRatio,
      seed: debouncedPath.arrangementSeed,
      sampleCount: debouncedPath.sampleCount,
      stepLength: debouncedPath.stepLength,
      stationJitter: debouncedPath.stationJitter,
      turns: CLIMB_CHECKPOINT === 2 ? 3.5 : debouncedPath.turns,
      climbBias: debouncedPath.climbBias,
      clearGap: debouncedPath.clearGap,
      peelAt: debouncedPath.peelAt,
      maxCoilsPerCapsule: debouncedPath.maxCoilsPerCapsule,
      debugSingleHelix: CLIMB_CHECKPOINT === 2 || (
        CLIMB_CHECKPOINT > 3 && debouncedPath.debugSingleHelix
      ),
      debugCapsuleId: CLIMB_CHECKPOINT === 2 ? 'calf.r' : debouncedPath.debugCapsuleId,
      wrapStyle: CLIMB_CHECKPOINT <= 3 ? 'independent-rings' : 'helix',
      ringCount: 5,
      ringAxialWidth: 0.012,
      ringEntrySide: 'random-lateral',
      ringEntrySideBias: 1,
      ringArcDegrees: debouncedPath.ringArcDegrees,
      rootBendStrength: debouncedPath.rootBendStrength,
      enabledCapsuleIds: REGION_CAPSULE_IDS[debouncedPath.region] ?? null,
    });
  }, [controls.enabled, hosts, hostVersionKey, debouncedPath]);

  const lifecycleRanges = useMemo(() => ({
    delay: controls.delay,
    grow: controls.grow,
    keep: controls.keep,
    die: controls.die,
  }), [controls.delay, controls.grow, controls.keep, controls.die]);

  const tubeKey = tubeKeyFromControls(controls);

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
      stemRadius: controls.stemRadius,
      stemSegments: controls.stemSegments,
      radialSegs: controls.radialSegs,
      radiusAttenuation: controls.radiusAttenuation,
      baseFlare: controls.baseFlare,
    });

    if (!geometry) {
      return { geometry: null, plantData: null, plants: [] };
    }

    const mid = new THREE.Vector3();
    const plants = wraps.map((wrap, plantId) => {
      wrap.curve.getPointAt(0.5, mid);
      return {
        seed: wrap.seed,
        plantId,
        hostId: wrap.hostId,
        curve: wrap.curve,
        position: [0, 0, 0],
        midX: mid.x,
        midZ: mid.z,
        durations: null,
        age: 0,
        settled: false,
      };
    });

    return { geometry, plantData, plants };
  }, [
    wraps,
    tubeKey,
    controls.stemRadius,
    controls.stemSegments,
    controls.radialSegs,
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
    });
  }, [stemBuild.plantData, flowerUniforms]);

  const plantsRef = useRef(stemBuild.plants);
  const plantDataRef = useRef(stemBuild.plantData);
  const lightRef = useRef(null);
  const animModeRef = useRef(controls.animMode);
  const windRef = useRef({
    windStrength: controls.windStrength,
    windAngle: controls.windAngle,
    windScale: controls.windScale,
    windSpeed: controls.windSpeed,
  });
  const lifecycleRef = useRef(lifecycleRanges);
  const phaseSpreadRef = useRef(controls.phaseSpread);
  lifecycleRef.current = lifecycleRanges;
  phaseSpreadRef.current = controls.phaseSpread;

  // Preserve ages across tube rebuilds when seeds align; assign durations.
  useEffect(() => {
    const prev = plantsRef.current;
    const next = stemBuild.plants;
    const ranges = lifecycleRef.current;
    const spread = phaseSpreadRef.current;
    for (let i = 0; i < next.length; i += 1) {
      const durations = computeDurations(next[i].seed, ranges);
      const lifetime = durations.delay + durations.grow + durations.keep + durations.die;
      next[i].durations = durations;
      if (prev?.length === next.length && prev[i]?.seed === next[i].seed) {
        next[i].age = prev[i].age;
        next[i].settled = prev[i].settled;
      } else {
        next[i].age = -phaseFrac(next[i].seed) * lifetime * spread;
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
      if (controls.animMode === 'settle') {
        plants[i].settled = false;
      }
    }
  }, [lifecycleRanges, controls.animMode]);

  animModeRef.current = controls.animMode;
  windRef.current = {
    windStrength: controls.windStrength,
    windAngle: controls.windAngle,
    windScale: controls.windScale,
    windSpeed: controls.windSpeed,
  };

  // Reset settle locks when switching modes.
  useEffect(() => {
    const plants = plantsRef.current;
    for (let i = 0; i < plants.length; i += 1) {
      plants[i].settled = false;
      if (controls.animMode === 'settle' && plants[i].durations) {
        const life = plants[i].durations.delay + plants[i].durations.grow
          + plants[i].durations.keep + plants[i].durations.die;
        plants[i].age = -phaseFrac(plants[i].seed) * life * controls.phaseSpread;
      }
    }
  }, [controls.animMode, controls.phaseSpread]);

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
    const time = clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    const mode = animModeRef.current;
    const wind = windRef.current;

    for (let i = 0; i < plants.length; i += 1) {
      const plant = plants[i];
      if (!plant.durations) continue;

      const life = plant.durations.delay + plant.durations.grow
        + plant.durations.keep + plant.durations.die;
      const growEnd = plant.durations.delay + plant.durations.grow;

      if (mode === 'settle') {
        if (!plant.settled) {
          plant.age += dt;
          if (plant.age >= growEnd) {
            plant.age = growEnd;
            plant.settled = true;
          }
        }
      } else {
        plant.age += dt;
        if (plant.age >= life) plant.age -= life;
      }

      const { stemGrow } = computeLifecycle(plant.age, plant.durations, 0.3, 0.23);
      const [swayX, swayZ] = computeWindSway(
        plant.midX,
        plant.midZ,
        time,
        wind,
      );

      const o = i * 4;
      data[o] = stemGrow;
      data[o + 1] = swayX;
      data[o + 2] = swayZ;
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

  if (!controls.enabled && !CHECKPOINT_DEBUG_ONLY) return null;

  const showStems = !CHECKPOINT_DEBUG_ONLY
    && Boolean(stemBuild.geometry && stemMaterial && stemBuild.plants.length);
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
        showHitch={controls.showHitch}
        showPaths={controls.showPaths}
        showDirs={controls.showDirs}
        showBounds={controls.showBounds}
        showCapsules={controls.showCapsules}
        showCapsuleLabels={controls.showCapsuleLabels}
        showDiagnostics={controls.showDiagnostics}
        showPathLabels={controls.showCapsuleLabels}
        capsuleFilterId={CLIMB_CHECKPOINT === 2 ? 'calf.r' : null}
        pathCount={controls.pathCount}
      />
    </group>
  );
}
