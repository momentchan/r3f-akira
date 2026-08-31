import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { folder, useControls } from 'leva';
import { useTexture } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { preloadVATAssets, useVATPreloader } from '@core/vat';
import { FLOWER_VEIN_PATH, mergeFlowerDefaults } from '../plants/look/flowerDefaults';
import {
  createFlowerMaskUniforms,
  createFlowerUniforms,
} from '../plants/look/createFlowerMaterials';
import { configureFlowerTexture, syncFlowerControls } from '../plants/look/flowerControls';
import { FIELD_DEFAULTS } from '../plants/field/fieldDefaults';
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
  GROWTH_START_SCALE,
  sampleCurveTable,
} from '../plants/stem/buildStemTube';
import { STEM_DEFAULTS } from '../plants/stem/stemDefaults';
import { syncStemLookControls } from '../plants/stem/stemControls';
import {
  applyLifecycleRanges,
  computeBloomLifecycle,
  createLifecycleState,
} from '../plants/lifecycle/plantLifecycle';

const DAHLIA = FLOWER_TYPES.find((type) => type.id === 'dahlia');
const DEMO_STEM_SEED = 42;
const PETAL_SHED = FIELD_DEFAULTS.petalShed;
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

function phaseRange(seconds) {
  const t = Math.max(seconds, 0.05);
  return [t, t];
}

function vatOpenEnd(durations, bloomFrac) {
  const { delay, grow, keep } = durations;
  const bloomKeep = Math.min(Math.max(bloomFrac, 0), 0.5) * keep;
  return delay + grow + bloomKeep;
}

/** VAT frame 1, then shed to 1. No hold in between. */
function shedCaptureEnd(durations, bloomFrac, petalShedFrac) {
  const shedFrac = Math.min(Math.max(petalShedFrac, 0), 0.95);
  return vatOpenEnd(durations, bloomFrac) + durations.die * shedFrac;
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

function writeFlowerTipAttributes(geometry, tip0, tip1, colorVar) {
  setConstantVec4Attribute(geometry, 'aTip0', ...tip0);
  setConstantVec4Attribute(geometry, 'aTip1', ...tip1);
  setConstantVec4Attribute(geometry, 'aColorVar', ...colorVar);
}

function computeLifecycleFlowerTip({
  curveTable,
  rootPosition,
  stemRadius,
  flowerSize,
  stemLength,
  stemGrow,
  flowerScale,
  flowerFrame,
  shed,
}) {
  const reveal = stemGrow;
  const growthSize = GROWTH_START_SCALE + (1 - GROWTH_START_SCALE) * reveal;
  const scale = flowerScale * growthSize * stemRadius * flowerSize;
  if (scale < 0.001 || reveal < 0.001) {
    return {
      tip0: [0, 0, 0, 0],
      tip1: [0, 0, 0, 0],
      colorVar: [0, 0, 0, stemLength],
    };
  }
  sampleCurveTable(curveTable, Math.max(stemGrow, 0.001), _tip, _tangent);
  _quat.setFromUnitVectors(_up, _tangent);
  if (_quat.w < 0) {
    _quat.set(-_quat.x, -_quat.y, -_quat.z, -_quat.w);
  }
  return {
    tip0: [
      rootPosition[0] + _tip.x,
      rootPosition[1] + _tip.y,
      rootPosition[2] + _tip.z,
      scale,
    ],
    tip1: [_quat.x, _quat.y, _quat.z, flowerFrame],
    colorVar: [0, 0, shed, stemLength],
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
  return { curve, curveTable, params };
}

/** Bloom 0 → petal scatter. Head only — Stem section is a later capture. */
export function Demo4FlowerShed() {
  const geoDefaults = STEM_DEFAULTS.geometry;
  const controls = useControls('Demo / Flower Shed', {
    Placement: folder({
      x: { value: 0, min: -2, max: 2, step: 0.01 },
      y: { value: 0, min: -0.5, max: 1, step: 0.01, label: 'root Y' },
      z: { value: 0, min: -2, max: 2, step: 0.01 },
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
      leanAngle: { value: 12.0, min: 5, max: 35, step: 0.5, label: 'lean °' },
      bendDegree: { value: 0.20, min: 0.02, max: 1, step: 0.005, label: 'bend' },
      radiusAttenuation: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'taper' },
      baseFlare: { value: 0.25, min: 0, max: 0.6, step: 0.01, label: 'flare' },
      stemSegments: { value: geoDefaults.stemSegments, min: 8, max: 64, step: 1 },
    }),
    Lifecycle: folder({
      delay: { value: 0.4, min: 0.05, max: 4, step: 0.05 },
      grow: { value: 3, min: 0.2, max: 12, step: 0.1 },
      keep: { value: 2, min: 0, max: 12, step: 0.1 },
      die: { value: 3, min: 0.2, max: 12, step: 0.1 },
      petalShedFrac: {
        value: FIELD_DEFAULTS.lifecycle.petalShedFrac,
        min: 0.05,
        max: 0.95,
        step: 0.05,
        label: 'shed / die',
      },
      paused: { value: false },
      timeScale: { value: 1, min: 0, max: 4, step: 0.05, label: 'speed' },
      manual: { value: false, label: 'scrub life' },
      life: { value: 0, min: 0, max: 1, step: 0.01, label: 'life (to scatter)' },
    }),
  });

  const rootPosition = useMemo(
    () => [controls.x, controls.y, controls.z],
    [controls.x, controls.y, controls.z],
  );

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
    ],
  );

  const lifecycleRanges = useMemo(() => ({
    delay: phaseRange(controls.delay),
    grow: phaseRange(controls.grow),
    keep: phaseRange(controls.keep),
    die: phaseRange(controls.die),
  }), [controls.delay, controls.grow, controls.keep, controls.die]);

  const lifecycleRef = useRef(null);
  if (!lifecycleRef.current) {
    lifecycleRef.current = createLifecycleState({
      seed: DEMO_STEM_SEED,
      ranges: lifecycleRanges,
      initialStagger: 0,
      rerollEachGeneration: false,
    });
  }

  useLayoutEffect(() => {
    applyLifecycleRanges(lifecycleRef.current, lifecycleRanges);
  }, [lifecycleRanges]);

  const flowerSize = mergeFlowerDefaults(DAHLIA.materialDefaults).flowerSize;
  const bloomStart = geoDefaults.bloomStart;
  const bloomFrac = geoDefaults.bloomFrac;

  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);
  const flowerControls = useMemo(
    () => flatFlowerControls(DAHLIA.materialDefaults),
    [],
  );
  const stemLookControls = useMemo(() => flatStemLookControls(), []);

  const vatData = useVATPreloader(DAHLIA.metaUrl);
  const [maskTexture, veinTexture] = useTexture([DAHLIA.maskPath, FLOWER_VEIN_PATH]);
  const vatReady = Boolean(
    vatData.isLoaded && vatData.posTex && vatData.nrmTex && vatData.meta && vatData.scene,
  );
  const sourceGeometry = useMemo(
    () => (vatReady ? buildVatFlowerGeometry(vatData, { stemYMax: 0.05 }) : null),
    [vatReady, vatData.scene, vatData.meta],
  );

  const { scene } = useThree();
  const flowerGeoRef = useRef(null);
  const [flowerMesh, setFlowerMesh] = useState(null);

  useEffect(() => {
    configureFlowerTexture(maskTexture);
    configureFlowerTexture(veinTexture);
  }, [maskTexture, veinTexture]);

  useLayoutEffect(() => {
    syncFlowerControls(flowerControls, flowerUniforms, maskUniforms);
    syncStemLookControls(stemLookControls, flowerUniforms);
  }, [flowerControls, stemLookControls, flowerUniforms, maskUniforms]);

  useLayoutEffect(() => {
    if (!sourceGeometry || !vatReady) return undefined;

    configureVatTexture(vatData.posTex);
    configureVatTexture(vatData.nrmTex);

    const geometry = prepareInstancedVatGeometry(sourceGeometry.clone());
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
        shedDefaults: {
          rise: PETAL_SHED.shedRise,
          riseVariance: PETAL_SHED.shedRiseVariance,
          spread: PETAL_SHED.shedSpread,
          stagger: PETAL_SHED.shedStagger,
        },
      },
    );

    const mesh = new THREE.Mesh(geometry, bundle.material);
    mesh.name = 'Demo4SingleDahlia';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    enablePlantShadowLayer(mesh);
    flowerGeoRef.current = geometry;
    setFlowerMesh(mesh);

    return () => {
      geometry.dispose();
      bundle.material.dispose();
      flowerGeoRef.current = null;
      setFlowerMesh(null);
    };
  }, [sourceGeometry, vatReady, vatData, flowerUniforms, maskUniforms, maskTexture, veinTexture]);

  useFrame((_, delta) => {
    const durations = lifecycleRef.current.durations;
    const shedFrac = controls.petalShedFrac;
    const openEnd = vatOpenEnd(durations, bloomFrac);
    const captureEnd = Math.max(
      shedCaptureEnd(durations, bloomFrac, shedFrac),
      1e-6,
    );
    if (controls.manual) {
      lifecycleRef.current.age = controls.life * captureEnd;
    } else {
      const dt = controls.paused ? 0 : Math.min(delta, 0.1) * controls.timeScale;
      lifecycleRef.current.age += dt;
      while (lifecycleRef.current.age >= captureEnd) {
        lifecycleRef.current.age -= captureEnd;
      }
    }

    const age = lifecycleRef.current.age;
    const keepEnd = durations.delay + durations.grow + durations.keep;
    const bloomAge = age <= openEnd ? age : keepEnd + (age - openEnd);
    const { flowerFrame, flowerScale, shed } = computeBloomLifecycle(
      bloomAge,
      durations,
      bloomFrac,
      bloomStart,
      shedFrac,
    );

    const geometry = flowerGeoRef.current;
    if (geometry) {
      const tips = computeLifecycleFlowerTip({
        curveTable: stemBuild.curveTable,
        rootPosition,
        stemRadius: controls.stemRadius,
        flowerSize,
        stemLength: controls.stemLength,
        stemGrow: 1,
        flowerScale,
        flowerFrame,
        shed,
      });
      writeFlowerTipAttributes(geometry, tips.tip0, tips.tip1, tips.colorVar);
    }

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

  return (
    <group name="Demo4FlowerShedPlant">
      {flowerMesh ? <primitive object={flowerMesh} /> : null}
    </group>
  );
}
