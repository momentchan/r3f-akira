import { useEffect, useMemo, useRef } from 'react';
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
import {
  FlowerTypeBatch,
  updateFlowerBatchTips,
} from '../vat/FlowerTypeBatch';
import { FLOWER_TYPES } from '../vat/flowerTypes';

const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();

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

/**
 * Single plant field system: one merged stem mesh + instanced VAT heads per type.
 * Leaves are deferred (v1) for density.
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
  lifecycleRanges,
  lifecyclePausedRef = null,
  flowerControlsById,
  flowerColorVariationById,
  stemLookControls = null,
  leafControls = null,
  windAngle = 30,
  windStrength = 0.05,
  windScale = 1.5,
  windSpeed = 0.6,
}) {
  const runtimeRef = useRef({
    plants: [],
    plantData: null,
    stemMesh: null,
    flowerBatches: {},
    light: null,
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
      const geo = buildStemTubeGeometry(curve, {
        stemRadius: stem.params.stemRadius,
        stemSegments,
        radialSegs,
        radiusAttenuation: stem.params.radiusAttenuation,
        baseFlare: stem.params.baseFlare,
        plantId,
        offset: stem.position,
      });
      geos.push(geo);

      return {
        ...stem,
        plantId,
        curve,
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
  }, [stemBuild]);

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

    const dt = Math.min(delta, 0.1);
    const paused = Boolean(lifecyclePausedRef?.current);
    const { data, width, tex } = plantData;
    const time = clock.elapsedTime;

    for (let i = 0; i < plants.length; i++) {
      const plant = plants[i];
      const [swayX, swayZ] = computeWindSway(
        plant.position[0],
        plant.position[2],
        time,
        { windAngle, windStrength, windScale, windSpeed },
      );

      const growthState = paused
        ? computeGrowthLifecycle(plant.lifecycle.age, plant.lifecycle.durations)
        : advanceLifecycleState(plant.lifecycle, dt, lifecycleRanges);
      const { flowerFrame, flowerScale } = computeBloomLifecycle(
        plant.lifecycle.age,
        plant.lifecycle.durations,
        bloomFrac,
        bloomStart,
      );
      const stemGrow = growthState.growth;

      plant.stemGrow = stemGrow;
      plant.flowerFrame = flowerFrame;
      plant.flowerScale = flowerScale;
      plant.swayX = swayX;
      plant.swayZ = swayZ;

      const o = i * 4;
      data[o] = stemGrow;
      data[o + 1] = swayX;
      data[o + 2] = swayZ;
      data[o + 3] = 0;
    }
    // Clear unused texels when count < width.
    for (let i = plants.length; i < width; i++) {
      const o = i * 4;
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
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
          <FieldLeaves
            plants={stemBuild.plants}
            plantData={stemBuild.plantData}
            flowerUniforms={stemFlowerUniforms}
            {...leafControls}
          />
        )}
        {plantsByType.map(({ type, plants: typePlants, indices }) => (
          <FlowerTypeBatch
            key={type.id}
            flowerType={type}
            plants={typePlants}
            plantIndexMap={indices}
            stemYMax={stemYMax}
            flowerControls={flowerControlsById?.[type.id]}
            stemLookControls={stemLookControls}
            runtimeRef={runtimeRef}
          />
        ))}
      </group>
    </AsyncCompile>
  );
}
