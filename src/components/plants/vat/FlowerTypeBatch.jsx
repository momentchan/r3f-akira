import { useEffect, useMemo, useRef, useState } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import {
  useVATPreloader,
} from '@core/vat';
import {
  createFlowerMaskUniforms,
  createFlowerUniforms,
} from '../look/createFlowerMaterials';
import {
  configureFlowerTexture,
  FLOWER_VEIN_PATH,
  flowerInstanceColorUnit,
  syncFlowerControls,
} from '../look/flowerControls';
import { syncStemLookControls } from '../stem/stemControls';
import { GROWTH_START_SCALE, sampleCurveTable } from '../stem/buildStemTube';
import { windMask } from '../stem/wind';
import {
  configureVatTexture,
  createInstancedVatFlowerMaterials,
  prepareInstancedVatGeometry,
} from './createVatMaterial';
import {
  createFlowerCullComputes,
  createFlowerInstanceStorage,
  createFlowerLodSlot,
  dispatchFlowerCull,
  FLOWER_COLOR_OFFSET,
  FLOWER_INSTANCE_FLOATS,
  FLOWER_TIP0_OFFSET,
  FLOWER_TIP1_OFFSET,
} from './flowerInstanceCull';
import { FLOWER_CULL_DEFAULTS, FLOWER_LOD_DEBUG_COLORS } from './flowerCullDefaults';
import { enablePlantShadowLayer, enableFlowerShadowCasterLayers } from '../../scene/plantShadowLayer';
import { buildVatFlowerGeometry } from './flowerGeometry';

const _up = new THREE.Vector3(0, 1, 0);
const _tip = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _outward = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const ATTACH_GROW_WINDOW = 0.28;

function smoothstep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function createLodMesh({
  vatData,
  sourceGeometry,
  instanceCount,
  minDistance,
  maxDistance,
  flowerUniforms,
  maskUniforms,
  maskTexture,
  veinTexture,
  flowerType,
  instanceStorage,
  lodDebugColor = null,
  shadowCasterOnly = false,
}) {
  configureVatTexture(vatData.posTex);
  configureVatTexture(vatData.nrmTex);
  const geo = prepareInstancedVatGeometry(sourceGeometry.clone());
  const slot = createFlowerLodSlot({
    geometry: geo,
    instanceCount,
    minDistance,
    maxDistance,
  });
  const bundle = createInstancedVatFlowerMaterials(
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
      instanceStorage: instanceStorage.node,
      visibleIndices: slot.indices,
      debugTintColor: lodDebugColor,
    },
  );
  const mesh = new THREE.Mesh(geo, bundle.material);
  mesh.frustumCulled = false;
  mesh.castShadow = !shadowCasterOnly;
  mesh.receiveShadow = false;
  if (shadowCasterOnly) {
    enableFlowerShadowCasterLayers(mesh);
    mesh.visible = false;
  } else {
    enablePlantShadowLayer(mesh);
  }
  mesh.count = instanceCount;
  slot.mesh = mesh;
  return { mesh, slot, bundle };
}

/**
 * Shared VAT flower batch. The owner updates the registered tip buffers with
 * `updateFlowerBatchTips`, so fields and surface-climbing plants use one path.
 */
export function FlowerTypeBatch({
  flowerType,
  plants,
  plantIndexMap,
  stemYMax,
  flowerControls,
  stemLookControls = null,
  shedControls = null,
  runtimeRef,
  attachTs = null,
  attachNormals = null,
  lodDistance = FLOWER_CULL_DEFAULTS.lodDistance,
  forceAllLow = false,
  noFlowerShadows = false,
  lowShadowCasters = false,
}) {
  const hasLod = Boolean(flowerType.lodMetaUrl);
  const hiVatData = useVATPreloader(flowerType.metaUrl);
  const lodVatData = useVATPreloader(flowerType.lodMetaUrl ?? flowerType.metaUrl);
  const maskTexture = useTexture(flowerType.maskPath);
  const veinTexture = useTexture(FLOWER_VEIN_PATH);

  const flowerControlsRef = useRef(flowerControls);
  flowerControlsRef.current = flowerControls;
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

  useEffect(() => {
    if (flowerControls) {
      syncFlowerControls(flowerControls, flowerUniforms, maskUniforms);
    }
    if (stemLookControls) {
      syncStemLookControls(stemLookControls, flowerUniforms);
    }
  }, [flowerControls, stemLookControls, flowerUniforms, maskUniforms]);

  const geoOpts = useMemo(() => ({
    stemYMax,
    partColorMode: flowerType.partColorMode,
  }), [stemYMax, flowerType.partColorMode]);

  const hiGeometry = useMemo(
    () => buildVatFlowerGeometry(hiVatData, geoOpts),
    [hiVatData.isLoaded, hiVatData.scene, hiVatData.meta, geoOpts],
  );

  const loGeometry = useMemo(() => {
    if (!hasLod) return null;
    return buildVatFlowerGeometry(lodVatData, geoOpts);
  }, [hasLod, lodVatData.isLoaded, lodVatData.scene, lodVatData.meta, geoOpts]);

  const hiVatReady = Boolean(
    hiVatData.isLoaded && hiVatData.posTex && hiVatData.nrmTex && hiVatData.meta,
  );
  const loVatReady = !hasLod || Boolean(
    lodVatData.isLoaded && lodVatData.posTex && lodVatData.nrmTex && lodVatData.meta,
  );

  const colorKey = plants.map((plant) => {
    const { hue, light } = flowerInstanceColorUnit(plant);
    return `${hue.toFixed(5)}/${light.toFixed(5)}`;
  }).join(',');
  // Instance count only — attach maps are mutated in place on climb slot rebind
  // and must not remount the VAT meshes.
  const layoutKey = `${flowerType.id}:${plants.length}`;
  const [meshes, setMeshes] = useState([]);

  useEffect(() => {
    const typePlants = plantsRef.current;
    const indices = plantIndexMapRef.current;
    if (!hiGeometry || !hiVatReady || typePlants.length === 0 || (hasLod && !loVatReady)) {
      setMeshes([]);
      return undefined;
    }

    const count = typePlants.length;
    const instanceStorage = createFlowerInstanceStorage(count);
    for (let i = 0; i < count; i += 1) {
      const { hue, light } = flowerInstanceColorUnit(typePlants[i]);
      const o = i * FLOWER_INSTANCE_FLOATS + FLOWER_COLOR_OFFSET;
      instanceStorage.data[o] = hue;
      instanceStorage.data[o + 1] = light;
      instanceStorage.data[o + 3] = typePlants[i].params?.stemLength ?? 1;
    }
    instanceStorage.attribute.needsUpdate = true;

    const lodSplit = Math.max(lodDistance ?? FLOWER_CULL_DEFAULTS.lodDistance, 0.01);
    const hiLod = createLodMesh({
      vatData: hiVatData,
      sourceGeometry: hiGeometry,
      instanceCount: count,
      minDistance: 0,
      maxDistance: hasLod ? lodSplit : Infinity,
      flowerUniforms,
      maskUniforms,
      maskTexture,
      veinTexture,
      flowerType,
      instanceStorage,
      lodDebugColor: FLOWER_LOD_DEBUG_COLORS.hi,
    });

    const lodSlots = [hiLod.slot];
    const lods = [{ mesh: hiLod.mesh, slot: hiLod.slot }];
    const renderMeshes = [hiLod.mesh];
    const shedUniforms = [hiLod.bundle.shedUniforms];
    const debugTints = [hiLod.bundle.debugTint];
    const disposables = [
      { geometry: hiLod.slot.geometry, material: hiLod.bundle.material },
    ];
    let shadowProxy = null;

    if (hasLod && loGeometry) {
      const loLod = createLodMesh({
        vatData: lodVatData,
        sourceGeometry: loGeometry,
        instanceCount: count,
        minDistance: lodSplit,
        maxDistance: Infinity,
        flowerUniforms,
        maskUniforms,
        maskTexture,
        veinTexture,
        flowerType,
        instanceStorage,
        lodDebugColor: FLOWER_LOD_DEBUG_COLORS.lo,
      });
      lodSlots.push(loLod.slot);
      lods.push({ mesh: loLod.mesh, slot: loLod.slot });
      renderMeshes.push(loLod.mesh);
      shedUniforms.push(loLod.bundle.shedUniforms);
      debugTints.push(loLod.bundle.debugTint);
      disposables.push({
        geometry: loLod.slot.geometry,
        material: loLod.bundle.material,
      });

      const shadowLod = createLodMesh({
        vatData: lodVatData,
        sourceGeometry: loGeometry,
        instanceCount: count,
        minDistance: 0,
        maxDistance: Infinity,
        flowerUniforms,
        maskUniforms,
        maskTexture,
        veinTexture,
        flowerType,
        instanceStorage,
        lodDebugColor: FLOWER_LOD_DEBUG_COLORS.lo,
        shadowCasterOnly: true,
      });
      shadowProxy = { mesh: shadowLod.mesh, slot: shadowLod.slot };
      renderMeshes.push(shadowLod.mesh);
      shedUniforms.push(shadowLod.bundle.shedUniforms);
      debugTints.push(shadowLod.bundle.debugTint);
      disposables.push({
        geometry: shadowLod.slot.geometry,
        material: shadowLod.bundle.material,
      });
    }

    const size = flowerControlsRef.current?.flowerSize
      ?? flowerType.materialDefaults?.flowerSize
      ?? 4.2;
    runtimeRef.current.flowerBatches[flowerType.id] = {
      lods,
      shadowProxy,
      instanceStorage,
      cull: createFlowerCullComputes({
        instanceStorage,
        lodSlots,
        shadowSlot: shadowProxy?.slot ?? null,
        count,
      }),
      plantIndexMap: indices,
      attachTs,
      attachNormals,
      flowerUniforms,
      shedUniforms,
      debugTints,
      scaleMuls: typePlants.map((plant) => plant.params.stemRadius * size),
    };
    setMeshes(renderMeshes);

    return () => {
      delete runtimeRef.current.flowerBatches[flowerType.id];
      for (let i = 0; i < disposables.length; i += 1) {
        disposables[i].geometry.dispose();
        disposables[i].material.dispose();
      }
      setMeshes([]);
    };
  }, [
    layoutKey, hiGeometry, loGeometry, hiVatReady, loVatReady, hasLod,
    hiVatData, lodVatData, lodDistance,
    flowerType, flowerUniforms, maskUniforms, maskTexture, veinTexture, runtimeRef,
  ]);

  // Keep runtime tip lookups on the latest maps without rebuilding VAT.
  useEffect(() => {
    const batch = runtimeRef.current.flowerBatches[flowerType.id];
    if (!batch) return;
    batch.plantIndexMap = plantIndexMapRef.current;
    batch.attachTs = attachTs;
    batch.attachNormals = attachNormals;
  }, [plantIndexMap, attachTs, attachNormals, flowerType.id, runtimeRef, meshes]);

  // Color LOD vs low-poly shadow proxy — no VAT remount.
  useEffect(() => {
    const batch = runtimeRef.current.flowerBatches[flowerType.id];
    if (!batch?.lods?.length) return;
    const { lods, instanceStorage, shadowProxy } = batch;
    const lowOnly = forceAllLow && lods.length > 1;
    const useLowCasters = Boolean(lowShadowCasters && shadowProxy && !noFlowerShadows);

    for (let i = 0; i < lods.length; i += 1) {
      lods[i].mesh.visible = !lowOnly || i === lods.length - 1;
      lods[i].mesh.castShadow = !noFlowerShadows && !useLowCasters;
    }
    if (shadowProxy) {
      shadowProxy.mesh.castShadow = useLowCasters;
      shadowProxy.mesh.visible = useLowCasters;
    }

    const activeSlots = lowOnly
      ? [lods[lods.length - 1].slot]
      : lods.map((entry) => entry.slot);
    batch.cull = createFlowerCullComputes({
      instanceStorage,
      lodSlots: activeSlots,
      shadowSlot: useLowCasters ? shadowProxy.slot : null,
      count: instanceStorage.count,
    });
  }, [
    forceAllLow, lowShadowCasters, noFlowerShadows,
    meshes, flowerType.id, runtimeRef,
  ]);

  useEffect(() => {
    const batch = runtimeRef.current.flowerBatches[flowerType.id];
    if (!batch) return;
    const typePlants = plantsRef.current;
    const { data, attribute } = batch.instanceStorage;
    for (let i = 0; i < typePlants.length; i += 1) {
      const { hue, light } = flowerInstanceColorUnit(typePlants[i]);
      const o = i * FLOWER_INSTANCE_FLOATS + FLOWER_COLOR_OFFSET;
      data[o] = hue;
      data[o + 1] = light;
      data[o + 3] = typePlants[i].params?.stemLength ?? 1;
    }
    attribute.needsUpdate = true;
  }, [colorKey, layoutKey, flowerType.id, runtimeRef]);

  useEffect(() => {
    const batch = runtimeRef.current.flowerBatches[flowerType.id];
    const typePlants = plantsRef.current;
    if (!batch || !typePlants.length) return;
    const size = flowerControlsRef.current?.flowerSize
      ?? flowerType.materialDefaults?.flowerSize
      ?? 4.2;
    batch.scaleMuls = typePlants.map((plant) => plant.params.stemRadius * size);
  }, [flowerControls?.flowerSize, layoutKey, flowerType, runtimeRef]);

  useEffect(() => {
    const shedList = runtimeRef.current.flowerBatches[flowerType.id]?.shedUniforms;
    if (!shedList?.length || !shedControls) return;
    for (let i = 0; i < shedList.length; i += 1) {
      const shed = shedList[i];
      if (!shed) continue;
      shed.rise.value = shedControls.shedRise ?? shed.rise.value;
      shed.riseVariance.value = shedControls.shedRiseVariance ?? shed.riseVariance.value;
      shed.spread.value = shedControls.shedSpread ?? shed.spread.value;
      shed.stagger.value = shedControls.shedStagger ?? shed.stagger.value;
    }
  }, [meshes, shedControls, flowerType.id, runtimeRef]);

  useEffect(() => () => {
    hiGeometry?.dispose();
    if (hasLod) loGeometry?.dispose();
  }, [hiGeometry, loGeometry, hasLod]);

  return meshes.map((mesh) => (
    <primitive key={mesh.uuid} object={mesh} />
  ));
}

/** Update all registered flower positions, orientations, scales, and VAT frames. */
export function updateFlowerBatchTips(flowerBatches, plants) {
  for (const id in flowerBatches) {
    const batch = flowerBatches[id];
    const { instanceStorage, plantIndexMap, scaleMuls, attachTs, attachNormals } = batch;
    const { data, attribute } = instanceStorage;
    for (let local = 0; local < plantIndexMap.length; local += 1) {
      const plant = plants[plantIndexMap[local]];
      const stemGrow = plant?.stemGrow ?? 0;
      const attachT = attachTs?.[local];
      const hasFixedAttachment = Number.isFinite(attachT);
      const reveal = hasFixedAttachment
        ? smoothstep01((stemGrow - attachT) / ATTACH_GROW_WINDOW)
        : stemGrow;
      const growthSize = GROWTH_START_SCALE + (1 - GROWTH_START_SCALE) * reveal;
      const flowerScale = hasFixedAttachment ? reveal : (plant?.flowerScale ?? 0);
      const scale = flowerScale * growthSize * scaleMuls[local];
      const base = local * FLOWER_INSTANCE_FLOATS;
      const tip0 = base + FLOWER_TIP0_OFFSET;
      const tip1 = base + FLOWER_TIP1_OFFSET;
      data[base + FLOWER_COLOR_OFFSET + 2] = plant?.shed ?? 0;

      if (!plant || scale < 0.001 || reveal < 0.001) {
        data[tip0] = 0;
        data[tip0 + 1] = 0;
        data[tip0 + 2] = 0;
        data[tip0 + 3] = 0;
        data[tip1] = 0;
        data[tip1 + 1] = 0;
        data[tip1 + 2] = 0;
        data[tip1 + 3] = 0;
        continue;
      }

      const t = hasFixedAttachment ? attachT : Math.max(stemGrow, 0.001);
      // Baked table when the owner supplied one — getPointAt/getTangentAt here
      // cost a binary search plus three curve evaluations per head per frame.
      if (plant.curveTable) {
        sampleCurveTable(plant.curveTable, t, _tip, _tangent);
      } else {
        plant.curve.getPointAt(t, _tip);
        plant.curve.getTangentAt(t, _tangent).normalize();
      }
      const attachNormal = attachNormals?.[local];
      if (hasFixedAttachment && attachNormal?.length === 3) {
        _outward.fromArray(attachNormal).normalize();
        _tip.addScaledVector(_outward, plant.params?.stemRadius ?? 0);
        _quat.setFromUnitVectors(_up, _outward);
      } else {
        _quat.setFromUnitVectors(_up, _tangent);
      }
      // Runtime yaw (respawn shuffle) turns the whole plant, so the head has to
      // orbit + face with it. Local-space tip first, then rotate, then offset.
      const yaw = plant.yaw ?? 0;
      if (yaw !== 0) {
        _tip.applyAxisAngle(_up, yaw);
        _yawQuat.setFromAxisAngle(_up, yaw);
        _quat.premultiply(_yawQuat);
      }
      if (_quat.w < 0) _quat.set(-_quat.x, -_quat.y, -_quat.z, -_quat.w);
      const displacementMask = windMask(hasFixedAttachment ? attachT : stemGrow);
      data[tip0] = (plant.position?.[0] ?? 0) + _tip.x
        + (plant.swayX ?? 0) * displacementMask;
      data[tip0 + 1] = (plant.position?.[1] ?? 0) + _tip.y;
      data[tip0 + 2] = (plant.position?.[2] ?? 0) + _tip.z
        + (plant.swayZ ?? 0) * displacementMask;
      data[tip0 + 3] = scale;
      data[tip1] = _quat.x;
      data[tip1 + 1] = _quat.y;
      data[tip1 + 2] = _quat.z;
      data[tip1 + 3] = hasFixedAttachment ? reveal : (plant.flowerFrame ?? 0);
    }
    attribute.needsUpdate = true;
  }
}

/** Compact visible flower instances into each LOD's indirect draw list. */
export function cullFlowerBatches(gl, camera, flowerBatches, options) {
  for (const id in flowerBatches) {
    dispatchFlowerCull(gl, camera, flowerBatches[id], options);
  }
  // stats-gl enables trackTimestamp. Each compute() takes a COMPUTE query;
  // drain the pool once per frame or it hits the 2048 cap.
  if (typeof gl.resolveTimestampsAsync === 'function') {
    void gl.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE);
  }
}
