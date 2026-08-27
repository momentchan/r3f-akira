import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { folder, useControls } from 'leva';
import { useTexture } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { preloadVATAssets, useVATPreloader } from '@core/vat';
import { FLOWER_VEIN_PATH, mergeFlowerDefaults } from '../plants/look/flowerDefaults';
import {
  createBatchedStemMaterial,
  createFlowerMaskUniforms,
  createFlowerUniforms,
} from '../plants/look/createFlowerMaterials';
import { configureFlowerTexture, syncFlowerControls } from '../plants/look/flowerControls';
import { createPlantDataTexture, writePlantState } from '../plants/field/fieldPlantData';
import { enablePlantShadowLayer } from '../scene/plantShadowLayer';
import { buildVatFlowerGeometry } from '../plants/vat/flowerGeometry';
import {
  configureVatTexture,
  createInstancedVatFlowerMaterials,
  prepareInstancedVatGeometry,
} from '../plants/vat/createVatMaterial';
import { FLOWER_TYPES } from '../plants/vat/flowerTypes';
import {
  buildCurveSampleTable,
  buildStemCurve,
  buildStemTubeGeometry,
  GROWTH_START_SCALE,
  sampleCurveTable,
} from '../plants/stem/buildStemTube';
import { STEM_DEFAULTS } from '../plants/stem/stemDefaults';
import { syncStemLookControls } from '../plants/stem/stemControls';

const DAHLIA = FLOWER_TYPES.find((type) => type.id === 'dahlia');
const DEMO_STEM_SEED = 42;
preloadVATAssets(DAHLIA.metaUrl);

const _up = new THREE.Vector3(0, 1, 0);
const _tip = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();

function flatFlowerControls(materialDefaults) {
  const d = mergeFlowerDefaults(materialDefaults);
  return {
    colorLevels: d.petal.colorLevels,
    gradientLevels: d.petal.gradientLevels,
    gradientBandStrength: d.petal.gradientBandStrength,
    thresholdLow: d.petal.thresholdLow,
    thresholdHigh: d.petal.thresholdHigh,
    thresholdNoiseScale: d.petal.thresholdNoiseScale,
    thresholdNoiseStrength: d.petal.thresholdNoiseStrength,
    shadowTint: d.petal.shadowTint,
    highlightTint: d.petal.highlightTint,
    baseColor: d.petal.baseColor,
    midColor: d.petal.midColor,
    tipColor: d.petal.tipColor,
    saturation: d.petal.saturation ?? 1,
    hueRange: d.petal.hueRange,
    lightRange: d.petal.lightRange,
    scale: d.vein.scale,
    rotation: d.vein.rotation,
    veinThreshold: d.vein.threshold,
    veinStrokeWidth: d.vein.strokeWidth ?? 2,
    veinDistortion: d.vein.distortion,
    veinDistortionScale: d.vein.distortionScale,
    veinCoverage: d.vein.coverage,
    veinCoverageScale: d.vein.coverageScale,
    veinPetalVariation: d.vein.petalVariation,
    threshold: d.mask.threshold,
    edgeWidth: d.mask.edgeWidth,
    edgeColor: d.mask.edgeColor,
  };
}

function flatStemLookControls() {
  const d = STEM_DEFAULTS.look;
  return {
    stemColorLevels: d.colorLevels,
    stemThresholdLow: d.thresholdLow,
    stemThresholdHigh: d.thresholdHigh,
    stemShadowColor: d.shadowColor,
    stemHighlightColor: d.highlightColor,
    stemEdgeColor: d.edgeColor,
    stemEdgeThreshold: d.edgeThreshold,
    stemEdgeSoftness: d.edgeSoftness,
  };
}

function setConstantVec4Attribute(geometry, name, x, y, z, w) {
  const count = geometry.getAttribute('position').count;
  let attr = geometry.getAttribute(name);
  if (!attr) {
    attr = new THREE.BufferAttribute(new Float32Array(count * 4), 4);
    geometry.setAttribute(name, attr);
  }
  const arr = attr.array;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    arr[o] = x;
    arr[o + 1] = y;
    arr[o + 2] = z;
    arr[o + 3] = w;
  }
  attr.needsUpdate = true;
}

function addSingleInstanceTipAttributes(geometry, tip0, tip1, colorVar) {
  setConstantVec4Attribute(geometry, 'aTip0', ...tip0);
  setConstantVec4Attribute(geometry, 'aTip1', ...tip1);
  setConstantVec4Attribute(geometry, 'aColorVar', ...colorVar);
}

function computeFlowerTip(curveTable, rootPosition, stemRadius, flowerSize, bloom, stemLength) {
  sampleCurveTable(curveTable, 1, _tip, _tangent);
  _quat.setFromUnitVectors(_up, _tangent);
  if (_quat.w < 0) {
    _quat.set(-_quat.x, -_quat.y, -_quat.z, -_quat.w);
  }
  const scale = stemRadius * flowerSize;
  return {
    tip0: [
      rootPosition[0] + _tip.x,
      rootPosition[1] + _tip.y,
      rootPosition[2] + _tip.z,
      scale,
    ],
    tip1: [_quat.x, _quat.y, _quat.z, bloom],
    colorVar: [0, 0, 0, stemLength],
  };
}

function buildDemoStem(stemControls) {
  const params = {
    stemLength: stemControls.stemLength,
    stemRadius: stemControls.stemRadius,
    leanAngle: stemControls.leanAngle,
    bendDegree: stemControls.bendDegree,
    radiusAttenuation: stemControls.radiusAttenuation,
    baseFlare: stemControls.baseFlare,
  };
  const curve = buildStemCurve({
    seed: DEMO_STEM_SEED,
    ...params,
  });
  const curveTable = buildCurveSampleTable(curve, stemControls.stemSegments);
  const geometry = buildStemTubeGeometry(curve, {
    ...params,
    stemSegments: stemControls.stemSegments,
    radialSegs: stemControls.radialSegs,
    plantId: 0,
  });
  const plantData = createPlantDataTexture(1);
  return { curve, curveTable, geometry, plantData, params };
}

/** Codrops Still — one dahlia on a stem casting onto ShadowCatcher. */
export function Demo2StylishShadow() {
  const geoDefaults = STEM_DEFAULTS.geometry;
  const controls = useControls('Demo / Stylish Shadow', {
    Placement: folder({
      x: { value: 0, min: -2, max: 2, step: 0.01 },
      y: { value: 0, min: -0.5, max: 1, step: 0.01, label: 'root Y' },
      z: { value: 0, min: -2, max: 2, step: 0.01 },
      bloom: { value: 1, min: 0, max: 1, step: 0.01, label: 'bloom frame' },
    }),
    Stem: folder({
      stemLength: {
        value: 0.85,
        min: geoDefaults.stemLength[0],
        max: geoDefaults.stemLength[1],
        step: 0.01,
        label: 'length',
      },
      stemRadius: {
        value: 0.012,
        min: geoDefaults.stemRadius[0],
        max: geoDefaults.stemRadius[1],
        step: 0.001,
        label: 'radius',
      },
      leanAngle: { value: 18, min: 5, max: 35, step: 0.5, label: 'lean °' },
      bendDegree: { value: 0.08, min: 0.02, max: 0.2, step: 0.005, label: 'bend' },
      radiusAttenuation: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'taper' },
      baseFlare: { value: 0.25, min: 0, max: 0.6, step: 0.01, label: 'flare' },
      stemSegments: { value: geoDefaults.stemSegments, min: 8, max: 64, step: 1 },
      radialSegs: { value: geoDefaults.radialSegs, min: 4, max: 12, step: 1 },
    }),
  });

  const rootPosition = useMemo(
    () => [controls.x, controls.y, controls.z],
    [controls.x, controls.y, controls.z],
  );
  const flowerSize = mergeFlowerDefaults(DAHLIA.materialDefaults).flowerSize;

  const stemBuild = useMemo(
    () => buildDemoStem(controls),
    [
      controls.stemLength,
      controls.stemRadius,
      controls.leanAngle,
      controls.bendDegree,
      controls.radiusAttenuation,
      controls.baseFlare,
      controls.stemSegments,
      controls.radialSegs,
    ],
  );

  const vatData = useVATPreloader(DAHLIA.metaUrl);
  const [maskTexture, veinTexture] = useTexture([DAHLIA.maskPath, FLOWER_VEIN_PATH]);
  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);
  const flowerControls = useMemo(
    () => flatFlowerControls(DAHLIA.materialDefaults),
    [],
  );
  const stemLookControls = useMemo(() => flatStemLookControls(), []);

  const vatReady = Boolean(
    vatData.isLoaded && vatData.posTex && vatData.nrmTex && vatData.meta && vatData.scene,
  );

  const sourceGeometry = useMemo(
    () => (vatReady ? buildVatFlowerGeometry(vatData, { stemYMax: 0.05 }) : null),
    [vatReady, vatData.scene, vatData.meta],
  );

  const stemMaterial = useMemo(
    () => createBatchedStemMaterial(flowerUniforms, {
      plantDataTexture: stemBuild.plantData.tex,
      texWidth: stemBuild.plantData.width,
      texRows: stemBuild.plantData.rows,
      maskPow: 2,
      startScale: GROWTH_START_SCALE,
      growthSegments: controls.stemSegments,
    }),
    [stemBuild.plantData, flowerUniforms, controls.stemSegments],
  );

  const disposablesRef = useRef(null);
  const [flowerMesh, setFlowerMesh] = useState(null);
  const { scene } = useThree();

  useEffect(() => {
    configureFlowerTexture(maskTexture);
    configureFlowerTexture(veinTexture);
  }, [maskTexture, veinTexture]);

  useLayoutEffect(() => {
    syncFlowerControls(flowerControls, flowerUniforms, maskUniforms);
    syncStemLookControls(stemLookControls, flowerUniforms);
  }, [flowerControls, stemLookControls, flowerUniforms, maskUniforms]);

  useLayoutEffect(() => {
    const plant = {
      position: rootPosition,
      stemGrow: 1,
      swayX: 0,
      swayZ: 0,
      yaw: 0,
    };
    writePlantState(stemBuild.plantData, [plant]);
  }, [stemBuild.plantData, rootPosition]);

  useLayoutEffect(() => {
    if (!sourceGeometry || !vatReady) return undefined;

    configureVatTexture(vatData.posTex);
    configureVatTexture(vatData.nrmTex);

    const geometry = prepareInstancedVatGeometry(sourceGeometry.clone());
    const tips = computeFlowerTip(
      stemBuild.curveTable,
      rootPosition,
      controls.stemRadius,
      flowerSize,
      controls.bloom,
      controls.stemLength,
    );
    addSingleInstanceTipAttributes(geometry, tips.tip0, tips.tip1, tips.colorVar);

    const bundle = createInstancedVatFlowerMaterials(
      vatData.posTex,
      vatData.nrmTex,
      vatData.meta,
      flowerUniforms,
      maskUniforms,
      maskTexture,
      veinTexture,
      {
        usePetalCutout: DAHLIA.usePetalCutout !== false,
        useMaskEdge: DAHLIA.useMaskEdge !== false,
      },
    );

    const mesh = new THREE.Mesh(geometry, bundle.material);
    mesh.name = 'Demo2SingleDahlia';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    enablePlantShadowLayer(mesh);
    disposablesRef.current = { geometry, material: bundle.material };
    setFlowerMesh(mesh);

    return () => {
      geometry.dispose();
      bundle.material.dispose();
      disposablesRef.current = null;
      setFlowerMesh(null);
    };
  }, [sourceGeometry, vatReady, vatData, flowerUniforms, maskUniforms, maskTexture, veinTexture]);

  useLayoutEffect(() => {
    const geometry = disposablesRef.current?.geometry;
    if (!geometry) return;
    const tips = computeFlowerTip(
      stemBuild.curveTable,
      rootPosition,
      controls.stemRadius,
      flowerSize,
      controls.bloom,
      controls.stemLength,
    );
    addSingleInstanceTipAttributes(geometry, tips.tip0, tips.tip1, tips.colorVar);
  }, [
    stemBuild.curveTable,
    rootPosition,
    controls.stemRadius,
    controls.stemLength,
    controls.bloom,
    flowerSize,
  ]);

  useFrame(() => {
    let light = null;
    scene.traverse((obj) => {
      if (!light && obj.isDirectionalLight) light = obj;
    });
    if (!light) return;
    light.updateWorldMatrix(true, false);
    light.target.updateWorldMatrix(true, false);
    light.getWorldPosition(_lightWorld);
    light.target.getWorldPosition(_lightTarget);
    flowerUniforms.lightDir.value.copy(
      _lightWorld.sub(_lightTarget).normalize(),
    );
  });

  useEffect(() => () => {
    stemBuild.geometry.dispose();
    stemBuild.plantData.tex.dispose();
    stemMaterial.dispose();
  }, [stemBuild, stemMaterial]);

  return (
    <group name="Demo2StylishShadowPlant">
      <mesh
        name="Demo2Stem"
        geometry={stemBuild.geometry}
        material={stemMaterial}
        frustumCulled={false}
        castShadow
        ref={enablePlantShadowLayer}
      />
      {flowerMesh ? <primitive object={flowerMesh} /> : null}
    </group>
  );
}
