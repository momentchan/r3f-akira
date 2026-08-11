import { useEffect, useMemo, useRef, useState } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  extractMeshGeometriesFromScene,
  useVATPreloader,
} from '@core/vat';
import { AsyncCompile } from '@core';
import {
  createBatchedStemMaterial,
  createFlowerMaskUniforms,
  createFlowerUniforms,
} from '../look/createFlowerMaterials';
import {
  configureFlowerTexture,
  FLOWER_VEIN_PATH,
  syncFlowerControls,
} from '../look/flowerControls';
import { FieldLeaves } from '../stem/FieldLeaves';
import { syncStemLookControls } from '../stem/stemControls';
import {
  buildStemCurve,
  buildStemTubeGeometry,
  GROWTH_START_SCALE,
} from '../stem/buildStemTube';
import { computeDurations, computeLifecycle } from '../stem/flowerLifecycle';
import { computeWindSway, windMask } from '../stem/wind';
import {
  configureVatTexture,
  createInstancedVatFlowerMaterials,
  prepareInstancedVatGeometry,
} from '../vat/createVatMaterial';
import { FLOWER_TYPES } from '../vat/flowerTypes';

const _up = new THREE.Vector3(0, 1, 0);
const _tip = new THREE.Vector3();
const _quat = new THREE.Quaternion();
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

function phaseFrac(seed) {
  const s = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function FlowerTypeBatch({
  flowerType,
  plants,
  plantIndexMap,
  stemYMax,
  flowerControls,
  stemLookControls,
  runtimeRef,
}) {
  const vatData = useVATPreloader(flowerType.metaUrl);
  const maskTexture = useTexture(flowerType.maskPath);
  const veinTexture = useTexture(FLOWER_VEIN_PATH);

  const flowerControlsRef = useRef(flowerControls);
  flowerControlsRef.current = flowerControls;
  const stemLookControlsRef = useRef(stemLookControls);
  stemLookControlsRef.current = stemLookControls;
  const plantsRef = useRef(plants);
  plantsRef.current = plants;
  const plantIndexMapRef = useRef(plantIndexMap);
  plantIndexMapRef.current = plantIndexMap;

  useEffect(() => {
    configureFlowerTexture(maskTexture);
    configureFlowerTexture(veinTexture);
  }, [maskTexture, veinTexture]);

  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);

  // Sync Look → uniforms only (never rebuild mesh/lifecycle).
  useEffect(() => {
    if (flowerControls) {
      syncFlowerControls(flowerControls, flowerUniforms, maskUniforms);
    }
    if (stemLookControls) {
      syncStemLookControls(stemLookControls, flowerUniforms);
    }
  }, [flowerControls, stemLookControls, flowerUniforms, maskUniforms]);

  const geometry = useMemo(() => {
    if (!vatData.isLoaded || !vatData.scene || !vatData.meta) return null;
    const parts = extractMeshGeometriesFromScene(vatData.scene, vatData.meta, {
      flipX: true,
      partColors: { stemYMax },
    });
    if (!parts.length) return null;
    const merged = parts.length === 1
      ? parts[0].geometry
      : mergeGeometries(parts.map((p) => p.geometry), false);
    parts.forEach((p) => {
      if (p.geometry !== merged) p.geometry.dispose();
    });
    return merged;
  }, [vatData.isLoaded, vatData.scene, vatData.meta, stemYMax]);

  const materialBundle = useMemo(() => {
    if (!vatData.isLoaded || !vatData.posTex || !vatData.nrmTex || !vatData.meta) {
      return null;
    }
    configureVatTexture(vatData.posTex);
    configureVatTexture(vatData.nrmTex);
    return createInstancedVatFlowerMaterials(
      vatData.posTex,
      vatData.nrmTex,
      vatData.meta,
      flowerUniforms,
      maskUniforms,
      maskTexture,
      veinTexture,
      {
        usePetalCutout: flowerType.usePetalCutout !== false,
        useMaskEdge: flowerType.useMaskEdge !== false,
      },
    );
  }, [
    vatData.isLoaded, vatData.posTex, vatData.nrmTex, vatData.meta,
    flowerUniforms, maskUniforms, maskTexture, veinTexture,
    flowerType.id, flowerType.usePetalCutout, flowerType.useMaskEdge,
  ]);

  const layoutKey = `${flowerType.id}:${plants.length}:${plantIndexMap.join(',')}`;
  const [mesh, setMesh] = useState(null);

  useEffect(() => {
    const typePlants = plantsRef.current;
    const indices = plantIndexMapRef.current;
    if (!geometry || !materialBundle || typePlants.length === 0) {
      setMesh(null);
      return undefined;
    }

    const geo = prepareInstancedVatGeometry(geometry);
    const count = typePlants.length;
    const tip0 = new Float32Array(count * 4);
    const tip1 = new Float32Array(count * 4);
    const colorVar = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const o = typePlants[i].colorOverride ?? {};
      colorVar[i * 2] = o.hueShift ?? 0;
      colorVar[i * 2 + 1] = o.lightShift ?? 0;
    }
    geo.setAttribute('aTip0', new THREE.InstancedBufferAttribute(tip0, 4));
    geo.setAttribute('aTip1', new THREE.InstancedBufferAttribute(tip1, 4));
    geo.setAttribute('aColorVar', new THREE.InstancedBufferAttribute(colorVar, 2));

    const instance = new THREE.InstancedMesh(geo, materialBundle.material, count);
    instance.frustumCulled = false;
    instance.castShadow = true;
    instance.receiveShadow = true;
    instance.count = count;
    const identity = new THREE.Matrix4();
    for (let i = 0; i < count; i++) instance.setMatrixAt(i, identity);
    instance.instanceMatrix.needsUpdate = true;

    const size = flowerControlsRef.current?.flowerSize
      ?? flowerType.materialDefaults?.flowerSize
      ?? 4.2;

    runtimeRef.current.flowerBatches[flowerType.id] = {
      mesh: instance,
      tip0,
      tip1,
      tip0Attr: geo.getAttribute('aTip0'),
      tip1Attr: geo.getAttribute('aTip1'),
      plantIndexMap: indices,
      flowerUniforms,
      scaleMuls: typePlants.map((p) => p.params.stemRadius * size),
    };
    setMesh(instance);

    return () => {
      delete runtimeRef.current.flowerBatches[flowerType.id];
      instance.dispose();
      geo.dispose();
      setMesh(null);
    };
  }, [layoutKey, geometry, materialBundle, flowerType, flowerUniforms, runtimeRef]);

  useEffect(() => {
    const batch = runtimeRef.current.flowerBatches[flowerType.id];
    const typePlants = plantsRef.current;
    if (!batch || !typePlants.length) return;
    const size = flowerControlsRef.current?.flowerSize
      ?? flowerType.materialDefaults?.flowerSize
      ?? 4.2;
    batch.scaleMuls = typePlants.map((p) => p.params.stemRadius * size);
  }, [flowerControls?.flowerSize, layoutKey, flowerType, runtimeRef]);

  useEffect(() => () => {
    materialBundle?.material.dispose();
    geometry?.dispose();
  }, [materialBundle, geometry]);

  return mesh ? <primitive object={mesh} /> : null;
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
    const flowerUniformsList = [
      stemFlowerUniforms,
      ...Object.values(runtimeRef.current.flowerBatches).map((b) => b.flowerUniforms),
    ];
    syncStemLookControls(stemLookControls, flowerUniformsList);
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

      const durations = computeDurations(stem.seed, lifecycleRanges);
      const lifetime = durations.delay + durations.grow + durations.keep + durations.die;
      return {
        ...stem,
        plantId,
        curve,
        durations,
        age: -phaseFrac(stem.seed) * lifetime * phaseSpread,
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
    });
  }, [stemBuild.plantData, stemFlowerUniforms]);

  useEffect(() => {
    const prev = runtimeRef.current.plants;
    const next = stemBuild.plants;
    // Keep lifecycle ages across layout rebuilds with the same seeds.
    if (prev?.length && next.length === prev.length) {
      for (let i = 0; i < next.length; i += 1) {
        if (prev[i]?.seed === next[i].seed) next[i].age = prev[i].age;
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
      bucket.plants.push(p);
      bucket.indices.push(i);
    });
    return [...map.values()].filter((b) => b.plants.length > 0);
  }, [stemBuild.plants]);

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

      if (!paused) {
        const life = plant.durations.delay + plant.durations.grow
          + plant.durations.keep + plant.durations.die;
        plant.age += dt;
        if (plant.age >= life) plant.age -= life;
      }

      const { stemGrow, flowerFrame, flowerScale } = computeLifecycle(
        plant.age,
        plant.durations,
        bloomFrac,
        bloomStart,
      );

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

    for (const batch of Object.values(flowerBatches)) {
      const {
        tip0, tip1, tip0Attr, tip1Attr, plantIndexMap, scaleMuls,
      } = batch;
      for (let local = 0; local < plantIndexMap.length; local++) {
        const plant = plants[plantIndexMap[local]];
        const growthSize = GROWTH_START_SCALE + (1 - GROWTH_START_SCALE) * plant.stemGrow;
        const s = plant.flowerScale * growthSize * scaleMuls[local];
        const o0 = local * 4;
        const o1 = local * 4;

        if (s < 0.001 || plant.stemGrow < 0.001) {
          tip0[o0] = 0;
          tip0[o0 + 1] = -10;
          tip0[o0 + 2] = 0;
          tip0[o0 + 3] = 0;
          tip1[o1] = 0;
          tip1[o1 + 1] = 0;
          tip1[o1 + 2] = 0;
          tip1[o1 + 3] = 0; // frame
        } else {
          const t = Math.max(plant.stemGrow, 0.001);
          plant.curve.getPointAt(t, _tip);
          _quat.setFromUnitVectors(_up, plant.curve.getTangentAt(t));
          // Keep quat.w ≥ 0 so the shader can reconstruct it from xyz.
          if (_quat.w < 0) _quat.set(-_quat.x, -_quat.y, -_quat.z, -_quat.w);
          const m = windMask(plant.stemGrow);
          tip0[o0] = plant.position[0] + _tip.x + plant.swayX * m;
          tip0[o0 + 1] = plant.position[1] + _tip.y;
          tip0[o0 + 2] = plant.position[2] + _tip.z + plant.swayZ * m;
          tip0[o0 + 3] = s;
          tip1[o1] = _quat.x;
          tip1[o1 + 1] = _quat.y;
          tip1[o1 + 2] = _quat.z;
          tip1[o1 + 3] = plant.flowerFrame;
        }
      }
      tip0Attr.needsUpdate = true;
      tip1Attr.needsUpdate = true;
    }
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
