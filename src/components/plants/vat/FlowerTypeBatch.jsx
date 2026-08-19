import { useEffect, useMemo, useRef, useState } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
import { enablePlantShadowLayer } from '../../scene/plantShadowLayer';
import { extractFlowerMeshGeometries } from './flowerGeometry';
import { assignPetalSegments } from './petalSegments';

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
}) {
  const vatData = useVATPreloader(flowerType.metaUrl);
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

  const geometry = useMemo(() => {
    if (!vatData.isLoaded || !vatData.scene || !vatData.meta) return null;
    const parts = extractFlowerMeshGeometries(vatData.scene, vatData.meta, {
      flipX: true,
      stemYMax,
      partColorMode: flowerType.partColorMode,
    });
    if (!parts.length) return null;
    const merged = parts.length === 1
      ? parts[0].geometry
      : mergeGeometries(parts.map((part) => part.geometry), false);
    const singlePart = parts.length === 1;
    parts.forEach((part) => {
      if (part.geometry !== merged) part.geometry.dispose();
    });
    // Derive per-petal ids + shrink pivots from the mesh islands (packed into
    // COLOR_0.g/.b) so petals can shed individually without a re-export.
    // Only for single-mesh VATs: the shader rebuilds the pivot's texel from its
    // vertex index, and UV1 is generated per part, so merged indices would not
    // map back to the right texel.
    if (singlePart) assignPetalSegments(merged);
    return merged;
  }, [
    vatData.isLoaded,
    vatData.scene,
    vatData.meta,
    stemYMax,
    flowerType.partColorMode,
  ]);

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

  const attachKey = attachTs?.map((value) => value.toFixed(4)).join(',') ?? 'tip';
  const normalKey = attachNormals?.map((value) => (
    value?.map((component) => component.toFixed(4)).join('/') ?? 'fallback'
  )).join(',') ?? 'tangent';
  const colorKey = plants.map((plant) => {
    const variation = plant.colorOverride ?? {};
    return `${(variation.hueShift ?? 0).toFixed(5)}/${(variation.lightShift ?? 0).toFixed(5)}`;
  }).join(',');
  const layoutKey = `${flowerType.id}:${plants.length}:${plantIndexMap.join(',')}:${attachKey}:${normalKey}`;
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
    // z = petal-shed progress (updated every frame with the tips),
    // w = stem length, the world-space unit the shed lift is expressed in.
    const colorVar = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      const variation = typePlants[i].colorOverride ?? {};
      colorVar[i * 4] = variation.hueShift ?? 0;
      colorVar[i * 4 + 1] = variation.lightShift ?? 0;
      colorVar[i * 4 + 3] = typePlants[i].params?.stemLength ?? 1;
    }
    geo.setAttribute('aTip0', new THREE.InstancedBufferAttribute(tip0, 4));
    geo.setAttribute('aTip1', new THREE.InstancedBufferAttribute(tip1, 4));
    const colorVarAttr = new THREE.InstancedBufferAttribute(colorVar, 4);
    geo.setAttribute('aColorVar', colorVarAttr);

    const instance = new THREE.InstancedMesh(geo, materialBundle.material, count);
    instance.frustumCulled = false;
    instance.castShadow = true;
    instance.receiveShadow = true;
    enablePlantShadowLayer(instance);
    instance.count = count;
    const identity = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) instance.setMatrixAt(i, identity);
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
      colorVar,
      colorVarAttr,
      plantIndexMap: indices,
      attachTs,
      attachNormals,
      flowerUniforms,
      scaleMuls: typePlants.map((plant) => plant.params.stemRadius * size),
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
    if (!batch) return;
    const typePlants = plantsRef.current;
    for (let i = 0; i < typePlants.length; i += 1) {
      const variation = typePlants[i].colorOverride ?? {};
      batch.colorVar[i * 4] = variation.hueShift ?? 0;
      batch.colorVar[i * 4 + 1] = variation.lightShift ?? 0;
      batch.colorVar[i * 4 + 3] = typePlants[i].params?.stemLength ?? 1;
    }
    batch.colorVarAttr.needsUpdate = true;
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
    const shed = materialBundle?.shedUniforms;
    if (!shed || !shedControls) return;
    shed.rise.value = shedControls.shedRise ?? shed.rise.value;
    shed.riseVariance.value = shedControls.shedRiseVariance ?? shed.riseVariance.value;
    shed.spread.value = shedControls.shedSpread ?? shed.spread.value;
    shed.stagger.value = shedControls.shedStagger ?? shed.stagger.value;
  }, [materialBundle, shedControls]);

  useEffect(() => () => {
    materialBundle?.material.dispose();
    geometry?.dispose();
  }, [materialBundle, geometry]);

  return mesh ? <primitive object={mesh} /> : null;
}

/** Update all registered flower positions, orientations, scales, and VAT frames. */
export function updateFlowerBatchTips(flowerBatches, plants) {
  for (const batch of Object.values(flowerBatches)) {
    const {
      tip0, tip1, tip0Attr, tip1Attr, plantIndexMap, scaleMuls,
      attachTs, attachNormals, colorVar, colorVarAttr,
    } = batch;
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
      const offset = local * 4;
      if (colorVar) colorVar[local * 4 + 2] = plant?.shed ?? 0;

      if (!plant || scale < 0.001 || reveal < 0.001) {
        tip0[offset] = 0;
        tip0[offset + 1] = -10;
        tip0[offset + 2] = 0;
        tip0[offset + 3] = 0;
        tip1[offset] = 0;
        tip1[offset + 1] = 0;
        tip1[offset + 2] = 0;
        tip1[offset + 3] = 0;
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
      tip0[offset] = (plant.position?.[0] ?? 0) + _tip.x
        + (plant.swayX ?? 0) * displacementMask;
      tip0[offset + 1] = (plant.position?.[1] ?? 0) + _tip.y;
      tip0[offset + 2] = (plant.position?.[2] ?? 0) + _tip.z
        + (plant.swayZ ?? 0) * displacementMask;
      tip0[offset + 3] = scale;
      tip1[offset] = _quat.x;
      tip1[offset + 1] = _quat.y;
      tip1[offset + 2] = _quat.z;
      tip1[offset + 3] = hasFixedAttachment ? reveal : (plant.flowerFrame ?? 0);
    }
    tip0Attr.needsUpdate = true;
    tip1Attr.needsUpdate = true;
    if (colorVarAttr) colorVarAttr.needsUpdate = true;
  }
}
