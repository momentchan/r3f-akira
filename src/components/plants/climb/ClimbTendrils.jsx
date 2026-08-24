import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import { AsyncCompile, stableRandomRange } from '@core';
import { preloadVATAssets } from '@core/vat';
import { createBatchedStemMaterial, createFlowerUniforms } from '../look/createFlowerMaterials';
import { FLOWER_DEFAULTS } from '../look/flowerDefaults';
import { createFlowerControlsSchema } from '../look/flowerControls';
import {
  buildCurveSampleTable,
  buildPackedStemTubes,
  GROWTH_START_SCALE,
} from '../stem/buildStemTube';
import {
  advanceLifecycleState,
  createLifecycleState,
  hashLifecycleIdentity,
} from '../lifecycle/plantLifecycle';
import { getSimSpeed } from '../lifecycle/simSpeed';
import { FieldLeaves } from '../stem/FieldLeaves';
import { STEM_Y_MAX } from '../stem/stemDefaults';
import {
  FlowerTypeBatch,
  cullFlowerBatches,
  updateFlowerBatchTips,
} from '../vat/FlowerTypeBatch';
import { PLUMERA_TYPE } from '../vat/flowerTypes';
import { computeWindSway, PLANT_WIND_DEFAULTS } from '../wind/plantWind';
import {
  buildWrapCurves,
  WRAP_PATH_ALGORITHM_VERSION,
} from './buildWrapCurve';
import { ClimbDebug } from './ClimbDebug';
import { treeSegmentGrowth } from './climbLifecycle';
import { CLIMB_CONTROLS_SCHEMA } from './climbControls';
import {
  CLIMB_HOST_PROFILES,
  CLIMB_INTERNALS,
} from './climbDefaults';
import { derivePrincipalSurfaceGuides } from './surfaceCoverage';
import { enablePlantShadowLayer } from '../../scene/plantShadowLayer';

const _lightWorld = new THREE.Vector3();
const _lightTarget = new THREE.Vector3();
const _surfaceHit = {};
const _surfacePoint = new THREE.Vector3();
const _surfaceOffset = new THREE.Vector3();
const _triangleA = new THREE.Vector3();
const _triangleB = new THREE.Vector3();
const _triangleC = new THREE.Vector3();
const _normalA = new THREE.Vector3();
const _normalB = new THREE.Vector3();
const _normalC = new THREE.Vector3();
const _barycentric = new THREE.Vector3();
const _normalTangent = new THREE.Vector3();
const _normalBitangent = new THREE.Vector3();
const _normalReference = new THREE.Vector3(0, 1, 0);
const _normalAlternate = new THREE.Vector3(1, 0, 0);
const PATH_DEBOUNCE_MS = 120;
const MAX_TOTAL_TENDRILS = 720;
const TUBE_SEGMENTS = 60;
const TUBE_RADIAL_SEGMENTS = 5;

const CLIMB_FLOWER_TYPE = PLUMERA_TYPE;

preloadVATAssets(CLIMB_FLOWER_TYPE.metaUrl);

const CLIMB_FLOWER_SCHEMA = createFlowerControlsSchema(CLIMB_FLOWER_TYPE.materialDefaults);

function surfaceNormalAtPoint(host, point, target) {
  const geometry = host?.geometry;
  const position = geometry?.getAttribute?.('position');
  const closest = host?.bvh?.closestPointToPoint(point, _surfaceHit, 0, Infinity);
  if (
    !position
    || !closest?.point
    || !Number.isInteger(closest.faceIndex)
    || closest.faceIndex < 0
  ) return null;

  const index = geometry.getIndex();
  const triangleOffset = closest.faceIndex * 3;
  const ia = index ? index.getX(triangleOffset) : triangleOffset;
  const ib = index ? index.getX(triangleOffset + 1) : triangleOffset + 1;
  const ic = index ? index.getX(triangleOffset + 2) : triangleOffset + 2;
  if (ic >= position.count) return null;

  _triangleA.fromBufferAttribute(position, ia);
  _triangleB.fromBufferAttribute(position, ib);
  _triangleC.fromBufferAttribute(position, ic);

  const normal = geometry.getAttribute('normal');
  if (normal && THREE.Triangle.getBarycoord(
    closest.point,
    _triangleA,
    _triangleB,
    _triangleC,
    _barycentric,
  )) {
    _normalA.fromBufferAttribute(normal, ia);
    _normalB.fromBufferAttribute(normal, ib);
    _normalC.fromBufferAttribute(normal, ic);
    target.copy(_normalA).multiplyScalar(_barycentric.x)
      .addScaledVector(_normalB, _barycentric.y)
      .addScaledVector(_normalC, _barycentric.z);
  } else {
    _surfaceOffset.subVectors(_triangleA, _triangleB);
    target.subVectors(_triangleC, _triangleB)
      .cross(_surfaceOffset);
  }
  if (target.lengthSq() < 1e-10) return null;
  target.normalize();

  // Mesh winding can differ between hosts. The tendril point is already offset
  // outside the surface, so use it to consistently choose the outward side.
  _surfaceOffset.subVectors(point, closest.point);
  if (_surfaceOffset.lengthSq() > 1e-10 && target.dot(_surfaceOffset) < 0) {
    target.negate();
  }
  return target;
}

function varySurfaceNormal(normal, azimuth, tiltRadians, target) {
  _normalTangent.crossVectors(normal, _normalReference);
  if (_normalTangent.lengthSq() < 1e-8) {
    _normalTangent.crossVectors(normal, _normalAlternate);
  }
  _normalTangent.normalize();
  _normalBitangent.crossVectors(normal, _normalTangent).normalize();
  return target.copy(normal).multiplyScalar(Math.cos(tiltRadians))
    .addScaledVector(_normalTangent, Math.cos(azimuth) * Math.sin(tiltRadians))
    .addScaledVector(_normalBitangent, Math.sin(azimuth) * Math.sin(tiltRadians))
    .normalize();
}

function bindClimbFlowerToPlant(plant, hosts, bindOpts) {
  if (!plant.curveTable) {
    plant.curveTable = buildCurveSampleTable(plant.curve, TUBE_SEGMENTS);
  }
  const span = Math.max(0, bindOpts.attachMax - bindOpts.attachMin);
  const attachT = bindOpts.attachMin + Math.random() * span;
  plant.curve.getPointAt(attachT, _surfacePoint);
  const surfaceNormal = surfaceNormalAtPoint(
    hosts.get(plant.hostId),
    _surfacePoint,
    new THREE.Vector3(),
  );
  const variedNormal = surfaceNormal
    ? varySurfaceNormal(
      surfaceNormal,
      Math.random() * Math.PI * 2,
      Math.random() * bindOpts.maxTilt,
      new THREE.Vector3(),
    )
    : null;
  return {
    attachT,
    attachNormal: variedNormal?.toArray() ?? null,
  };
}

function pickRingPlantIndex(plants, ringIndices, treeId, used, activeTrees) {
  if (treeId != null) {
    const local = [];
    for (let n = 0; n < ringIndices.length; n += 1) {
      const index = ringIndices[n];
      if (plants[index].treeId === treeId && !used.has(index)) local.push(index);
    }
    if (local.length) return local[Math.floor(Math.random() * local.length)];
  }
  const fallback = [];
  for (let n = 0; n < ringIndices.length; n += 1) {
    const index = ringIndices[n];
    if (activeTrees.has(plants[index].treeId) && !used.has(index)) fallback.push(index);
  }
  if (fallback.length) return fallback[Math.floor(Math.random() * fallback.length)];
  if (ringIndices.length) {
    return ringIndices[Math.floor(Math.random() * ringIndices.length)];
  }
  return -1;
}

function writeClimbFlowerSlot(slots, slotIndex, plantIndex, bind) {
  slots.indices[slotIndex] = plantIndex;
  slots.attachTs[slotIndex] = bind.attachT;
  slots.attachNormals[slotIndex] = bind.attachNormal;
}

function assignClimbFlowerSlots(slots, plants, activeTrees, hostById, bindOpts) {
  const used = new Set();
  for (let slotIndex = 0; slotIndex < slots.indices.length; slotIndex += 1) {
    const plantIndex = pickRingPlantIndex(
      plants,
      slots.ringIndices,
      null,
      used,
      activeTrees,
    );
    if (plantIndex < 0) {
      writeClimbFlowerSlot(slots, slotIndex, -1, { attachT: 0.5, attachNormal: null });
      continue;
    }
    used.add(plantIndex);
    writeClimbFlowerSlot(
      slots,
      slotIndex,
      plantIndex,
      bindClimbFlowerToPlant(plants[plantIndex], hostById, bindOpts),
    );
  }
}

function rebindClimbFlowerSlotsForTreeSwap(
  slots,
  plants,
  sleepingTreeId,
  wakingTreeId,
  activeTrees,
  hostById,
  bindOpts,
) {
  const used = new Set(slots.indices);
  for (let slotIndex = 0; slotIndex < slots.indices.length; slotIndex += 1) {
    const host = plants[slots.indices[slotIndex]];
    if (host?.treeId !== sleepingTreeId) continue;
    used.delete(slots.indices[slotIndex]);
    const plantIndex = pickRingPlantIndex(
      plants,
      slots.ringIndices,
      wakingTreeId,
      used,
      activeTrees,
    );
    if (plantIndex < 0) continue;
    used.add(plantIndex);
    writeClimbFlowerSlot(
      slots,
      slotIndex,
      plantIndex,
      bindClimbFlowerToPlant(plants[plantIndex], hostById, bindOpts),
    );
  }
}

function rebindClimbFlowerSlotAttachments(slots, plants, hostById, bindOpts) {
  for (let slotIndex = 0; slotIndex < slots.indices.length; slotIndex += 1) {
    const plantIndex = slots.indices[slotIndex];
    const plant = plants[plantIndex];
    if (!plant) continue;
    const bind = bindClimbFlowerToPlant(plant, hostById, bindOpts);
    slots.attachTs[slotIndex] = bind.attachT;
    slots.attachNormals[slotIndex] = bind.attachNormal;
  }
}

function reshuffleClimbFlowerSlotsOnTree(slots, plants, treeId, hostById, bindOpts) {
  for (let slotIndex = 0; slotIndex < slots.indices.length; slotIndex += 1) {
    const plantIndex = slots.indices[slotIndex];
    const plant = plants[plantIndex];
    if (plant?.treeId !== treeId) continue;
    writeClimbFlowerSlot(
      slots,
      slotIndex,
      plantIndex,
      bindClimbFlowerToPlant(plant, hostById, bindOpts),
    );
  }
}

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
    WRAP_PATH_ALGORITHM_VERSION,
    c.tendrilCount,
    c.headDensity,
    c.wrapAngleRange,
    c.axialWeave,
    c.surfaceOffset,
    c.noiseAmount,
    c.noiseFrequency,
  ].join(':');
}

function allocateHostBudgets(hosts, total) {
  if (!hosts.length || total < 1) return [];
  const weights = hosts.map((host) => Math.max(host.profile?.countShare ?? 1, 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => (
    totalWeight > 0 ? total * weight / totalWeight : total / hosts.length
  ));
  const counts = exact.map(Math.floor);
  let remaining = total - counts.reduce((sum, count) => sum + count, 0);
  const order = exact.map((value, index) => ({
    index,
    remainder: value - counts[index],
  })).sort((left, right) => right.remainder - left.remainder);
  for (let i = 0; remaining > 0; i += 1, remaining -= 1) {
    counts[order[i % order.length].index] += 1;
  }
  return hosts.map((host, index) => ({ host, count: counts[index] }))
    .filter((entry) => entry.count > 0);
}

/**
 * Independent, body-wrapping tendrils with packed single-draw growth.
 */
export function ClimbTendrils({
  bodyBounds = null,
  backpackBounds = null,
  wind = PLANT_WIND_DEFAULTS,
}) {
  const controls = useControls(
    'Climbing Tendrils',
    CLIMB_CONTROLS_SCHEMA,
    { collapsed: true },
  );
  const flowerControls = useControls(
    `Flower.${CLIMB_FLOWER_TYPE.label}`,
    CLIMB_FLOWER_SCHEMA,
    { collapsed: true },
  );

  const hosts = useMemo(() => {
    const list = [];
    if (bodyBounds?.bvh && bodyBounds?.localBox) {
      list.push({
        id: 'body',
        bvh: bodyBounds.bvh,
        geometry: bodyBounds.geometry,
        localBox: bodyBounds.localBox,
        capsules: bodyBounds.capsules ?? [],
        bodyRight: bodyBounds.bodyRight ?? null,
        profile: CLIMB_HOST_PROFILES.body,
      });
    }
    if (backpackBounds?.bvh && backpackBounds?.localBox && backpackBounds?.geometry) {
      const guides = derivePrincipalSurfaceGuides(
        backpackBounds.geometry,
        'backpack.surface',
      );
      if (guides.length) {
        list.push({
          id: 'backpack',
          bvh: backpackBounds.bvh,
          geometry: backpackBounds.geometry,
          localBox: backpackBounds.localBox,
          capsules: guides,
          bodyRight: new THREE.Vector3(1, 0, 0),
          profile: CLIMB_HOST_PROFILES.backpack,
        });
      }
    }
    return list;
  }, [
    bodyBounds?.bvh,
    bodyBounds?.geometry,
    bodyBounds?.capsules,
    bodyBounds?.bodyRight,
    backpackBounds?.bvh,
    backpackBounds?.geometry,
    backpackBounds?.localBox,
  ]);

  // Debounce expensive wrap-path params so Leva drags don't rebuild every frame.
  const livePathKey = pathKeyFromControls(controls);
  const [debouncedPath, setDebouncedPath] = useState(() => ({
    key: livePathKey,
    tendrilCount: controls.tendrilCount,
    routePoolFactor: controls.routePoolFactor,
    reshuffleRoutes: controls.reshuffleRoutes,
    headDensity: controls.headDensity,
    wrapAngleRange: controls.wrapAngleRange,
    axialWeave: controls.axialWeave,
    surfaceOffset: controls.surfaceOffset,
    noiseAmount: controls.noiseAmount,
    noiseFrequency: controls.noiseFrequency,
  }));

  useEffect(() => {
    const next = {
      key: livePathKey,
      tendrilCount: controls.tendrilCount,
      routePoolFactor: controls.routePoolFactor,
      headDensity: controls.headDensity,
      wrapAngleRange: controls.wrapAngleRange,
      axialWeave: controls.axialWeave,
      surfaceOffset: controls.surfaceOffset,
      noiseAmount: controls.noiseAmount,
      noiseFrequency: controls.noiseFrequency,
    };
    const id = window.setTimeout(() => setDebouncedPath(next), PATH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [
    livePathKey,
    controls.tendrilCount,
    controls.routePoolFactor,
    controls.reshuffleRoutes,
    controls.headDensity,
    controls.wrapAngleRange,
    controls.axialWeave,
    controls.surfaceOffset,
    controls.noiseAmount,
    controls.noiseFrequency,
  ]);

  const flowerUniforms = useMemo(() => {
    const uniforms = createFlowerUniforms();
    applyStemLookDefaults(uniforms);
    return uniforms;
  }, []);

  const wraps = useMemo(() => {
    if (!controls.enabled || !hosts.length) return [];
    // Build a surplus of routes; only ~tendrilCount worth are awake at a time and
    // the rest stay dormant (growth 0), ready to take over on a tree's rebirth.
    const poolFactor = debouncedPath.reshuffleRoutes
      ? Math.max(1, Math.round(debouncedPath.routePoolFactor ?? 1))
      : 1;
    const total = Math.min(
      debouncedPath.tendrilCount * poolFactor,
      MAX_TOTAL_TENDRILS,
    );
    const budgets = allocateHostBudgets(hosts, total);
    return budgets.flatMap(({ host, count }) => {
      const configuredHost = host.id === 'body'
        ? {
            ...host,
            capsules: host.capsules.map((capsule) => (
              capsule.id === 'helmet'
                ? { ...capsule, densityScale: debouncedPath.headDensity }
                : capsule
            )),
          }
        : host;
      return buildWrapCurves({
        hosts: [configuredHost],
        tendrilCount: count,
        layoutSeed: CLIMB_INTERNALS.layoutSeed
          + (host.profile?.layoutSeedOffset ?? 0),
        curveSamples: CLIMB_INTERNALS.curveSamples,
        spacingVariation: CLIMB_INTERNALS.spacingVariation,
        surfaceOffset: debouncedPath.surfaceOffset,
        entrySide: 'random-lateral',
        entrySideBias: 1,
        wrapAngleRange: debouncedPath.wrapAngleRange,
        axialWeave: debouncedPath.axialWeave,
        entryBend: CLIMB_INTERNALS.entryBend,
        noiseAmount: debouncedPath.noiseAmount,
        noiseFrequency: debouncedPath.noiseFrequency,
        noiseSeed: CLIMB_INTERNALS.layoutSeed,
      });
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
      return {
        geometry: null,
        plantData: null,
        plants: [],
        treeLengths: new Map(),
        treeSizes: new Map(),
      };
    }

    const plantData = createPlantDataTexture(wraps.length);
    const packed = wraps.map((wrap, plantId) => {
      const hasBranchStart = Number.isFinite(wrap.radiusStartScale);
      return {
        curve: wrap.curve,
        plantId,
        radiusStartScale: wrap.radiusStartScale,
        radiusEndScale: Number.isFinite(wrap.radiusEndScale)
          ? wrap.radiusEndScale
          : hasBranchStart ? controls.radiusAttenuation : undefined,
        baseFlareScale: wrap.baseFlareScale,
      };
    });

    const geometry = buildPackedStemTubes(packed, {
      stemRadius: controls.tendrilRadius,
      stemSegments: TUBE_SEGMENTS,
      radialSegs: TUBE_RADIAL_SEGMENTS,
      radiusAttenuation: controls.radiusAttenuation,
      baseFlare: controls.baseFlare,
    });

    if (!geometry) {
      return {
        geometry: null,
        plantData: null,
        plants: [],
        treeLengths: new Map(),
        treeSizes: new Map(),
      };
    }

    const motionSample = new THREE.Vector3();
    const plants = wraps.map((wrap, plantId) => {
      wrap.curve.getPointAt(0.5, motionSample);
      const hasBranchStart = Number.isFinite(wrap.radiusStartScale);
      return {
        seed: wrap.seed,
        plantId,
        hostId: wrap.hostId,
        treeId: wrap.treeId ?? `${wrap.hostId}:independent:${wrap.seed}`,
        role: wrap.role ?? 'ring',
        pathStartDistance: wrap.pathStartDistance ?? 0,
        pathEndDistance: wrap.pathEndDistance ?? wrap.curve.getLength(),
        curve: wrap.curve,
        motionPosition: [motionSample.x, motionSample.y, motionSample.z],
        position: [0, 0, 0],
        params: {
          stemLength: wrap.curve.getLength(),
          stemRadius: controls.tendrilRadius,
          radiusAttenuation: controls.radiusAttenuation,
          baseFlare: controls.baseFlare,
          radiusStartScale: wrap.radiusStartScale,
          radiusEndScale: Number.isFinite(wrap.radiusEndScale)
            ? wrap.radiusEndScale
            : hasBranchStart ? controls.radiusAttenuation : undefined,
          baseFlareScale: wrap.baseFlareScale,
        },
      };
    });

    const treeLengths = new Map();
    // Segments per tree — used to wake roughly `tendrilCount` worth of routes.
    const treeSizes = new Map();
    for (const plant of plants) {
      treeLengths.set(
        plant.treeId,
        Math.max(treeLengths.get(plant.treeId) ?? 0, plant.pathEndDistance),
      );
      treeSizes.set(plant.treeId, (treeSizes.get(plant.treeId) ?? 0) + 1);
    }
    return { geometry, plantData, plants, treeLengths, treeSizes };
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

  const flowerAttachments = useMemo(() => {
    // Fixed bloom count: density × awake rings. Hosts rebind on tree swap so
    // heads jump with the new wrap instead of vanishing on a sleeping route.
    const density = THREE.MathUtils.clamp(controls.flowerDensity, 0, 1);
    const plants = stemBuild.plants;
    const ringIndices = [];
    for (let index = 0; index < plants.length; index += 1) {
      if (plants[index].role === 'ring') ringIndices.push(index);
    }
    const awakeFraction = debouncedPath.reshuffleRoutes && plants.length
      ? Math.min(1, debouncedPath.tendrilCount / plants.length)
      : 1;
    const slotCount = Math.min(
      ringIndices.length,
      Math.round(density * ringIndices.length * awakeFraction),
    );
    const slotPlants = [];
    const indices = [];
    const attachTs = [];
    const attachNormals = [];
    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      slotPlants.push({
        plantId: `climb-flower-slot-${slotIndex}`,
        seed: slotIndex,
        params: {
          stemRadius: controls.tendrilRadius,
          stemLength: 1,
        },
        colorVariationUnit: {
          hue: stableRandomRange(
            slotIndex,
            42,
            CLIMB_INTERNALS.layoutSeed,
            -1,
            1,
          ),
          light: stableRandomRange(
            slotIndex,
            43,
            CLIMB_INTERNALS.layoutSeed,
            -1,
            1,
          ),
        },
      });
      indices.push(-1);
      attachTs.push(0.5);
      attachNormals.push(null);
    }
    return { plants: slotPlants, indices, attachTs, attachNormals, ringIndices };
  }, [
    stemBuild.plants,
    controls.flowerDensity,
    controls.tendrilRadius,
    debouncedPath.reshuffleRoutes,
    debouncedPath.tendrilCount,
  ]);

  const plantsRef = useRef(stemBuild.plants);
  const plantDataRef = useRef(stemBuild.plantData);
  const flowerRuntimeRef = useRef({ flowerBatches: {} });
  const flowerSlotsRef = useRef(flowerAttachments);
  flowerSlotsRef.current = flowerAttachments;
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [host.id, host])),
    [hosts],
  );
  const flowerBindOpts = useMemo(() => ({
    attachMin: Math.min(controls.flowerSpan[0], controls.flowerSpan[1]),
    attachMax: Math.max(controls.flowerSpan[0], controls.flowerSpan[1]),
    maxTilt: THREE.MathUtils.degToRad(controls.flowerNormalVariation),
  }), [controls.flowerSpan, controls.flowerNormalVariation]);
  const lightRef = useRef(null);
  const lifecycleRef = useRef(lifecycleRanges);
  lifecycleRef.current = lifecycleRanges;
  const treeLifecyclesRef = useRef(new Map());
  const treeGrowthFrontsRef = useRef(new Map());
  // Route pool: only these trees grow; the rest stay dormant at growth 0 until a
  // finished tree hands its slot over (see the swap in useFrame).
  const activeTreesRef = useRef(new Set());
  const dormantTreesRef = useRef([]);

  // Geometry stays packed, while every grounded tree owns one lifecycle.
  useEffect(() => {
    plantsRef.current = stemBuild.plants;
    plantDataRef.current = stemBuild.plantData;
  }, [stemBuild]);

  // Timing/path edits restart every tree from zero. Segments in the same tree
  // still share one distance front, so children can never precede parents.
  useEffect(() => {
    const lifecycles = new Map();
    for (const [treeId, length] of stemBuild.treeLengths) {
      const seed = CLIMB_INTERNALS.layoutSeed + hashLifecycleIdentity(treeId);
      lifecycles.set(treeId, {
        ...createLifecycleState({
          seed,
          ranges: lifecycleRanges,
          initialStagger: 0,
          rerollEachGeneration: true,
        }),
        length,
      });
    }
    treeLifecyclesRef.current = lifecycles;
    treeGrowthFrontsRef.current.clear();

    // Wake a seeded subset covering ~tendrilCount segments; park the remainder.
    const ids = [...lifecycles.keys()].sort((a, b) => (
      hashLifecycleIdentity(`${CLIMB_INTERNALS.layoutSeed}:${a}`)
      - hashLifecycleIdentity(`${CLIMB_INTERNALS.layoutSeed}:${b}`)
    ));
    const active = new Set();
    const dormant = [];
    if (!debouncedPath.reshuffleRoutes) {
      ids.forEach((id) => active.add(id));
    } else {
      const target = debouncedPath.tendrilCount;
      let awake = 0;
      for (const id of ids) {
        if (awake >= target) dormant.push(id);
        else {
          active.add(id);
          awake += stemBuild.treeSizes.get(id) ?? 1;
        }
      }
    }
    activeTreesRef.current = active;
    dormantTreesRef.current = dormant;
  }, [
    lifecycleRanges,
    stemBuild.treeLengths,
    stemBuild.treeSizes,
    debouncedPath.reshuffleRoutes,
    debouncedPath.tendrilCount,
  ]);

  // Bind bloom slots onto awake rings. Route swaps rebind in useFrame; span/tilt
  // only move the head along the current host.
  useEffect(() => {
    if (!flowerAttachments.indices.length) return;
    assignClimbFlowerSlots(
      flowerAttachments,
      stemBuild.plants,
      activeTreesRef.current,
      hostById,
      flowerBindOpts,
    );
  }, [
    flowerAttachments,
    stemBuild.plants,
    hostById,
    stemBuild.treeLengths,
    stemBuild.treeSizes,
    debouncedPath.reshuffleRoutes,
    debouncedPath.tendrilCount,
  ]);

  useEffect(() => {
    const slots = flowerSlotsRef.current;
    if (!slots.indices.length) return;
    rebindClimbFlowerSlotAttachments(
      slots,
      plantsRef.current,
      hostById,
      flowerBindOpts,
    );
  }, [flowerBindOpts, hostById]);

  useEffect(() => () => {
    stemBuild.geometry?.dispose();
    stemBuild.plantData?.tex.dispose();
    stemMaterial?.dispose();
  }, [stemBuild, stemMaterial]);

  useFrame(({ scene, clock, gl, camera }, delta) => {
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
      const lightDirection = _lightWorld.sub(_lightTarget).normalize();
      flowerUniforms.lightDir.value.copy(lightDirection);
      // for..in rather than Object.values: this runs every frame and the latter
      // allocates an array each time.
      const batches = flowerRuntimeRef.current.flowerBatches;
      for (const id in batches) {
        batches[id].flowerUniforms.lightDir.value.copy(lightDirection);
      }
    }

    const { data, tex } = plantData;
    // Shared global rate, so the climbers stay in step with the flower field.
    const dt = Math.min(delta, 0.1) * getSimSpeed();
    const treeGrowthFronts = treeGrowthFrontsRef.current;
    const activeTrees = activeTreesRef.current;
    const dormantTrees = dormantTreesRef.current;
    treeGrowthFronts.clear();
    for (const [treeId, lifecycle] of treeLifecyclesRef.current) {
      // Dormant routes hold at zero: their tubes are packed but the growth front
      // never leaves the base, so the fragment stage discards them entirely.
      if (!activeTrees.has(treeId)) {
        treeGrowthFronts.set(treeId, 0);
        continue;
      }

      const generationBefore = lifecycle.generation;
      const { growth } = advanceLifecycleState(lifecycle, dt, lifecycleRef.current);

      // Finished a full cycle → sleep, and wake a different route in its place.
      // Either way the bloom rolls a new T along the wrap, so it does not sit
      // at the same spot on every generation of the same tendril.
      if (lifecycle.generation !== generationBefore) {
        if (dormantTrees.length) {
          const pick = Math.floor(Math.random() * dormantTrees.length);
          const wakingId = dormantTrees[pick];
          dormantTrees[pick] = treeId;
          activeTrees.delete(treeId);
          activeTrees.add(wakingId);
          const waking = treeLifecyclesRef.current.get(wakingId);
          if (waking) waking.age = 0; // regrow from rest, not mid-cycle
          lifecycle.age = 0;
          treeGrowthFronts.set(treeId, 0);
          rebindClimbFlowerSlotsForTreeSwap(
            flowerSlotsRef.current,
            plants,
            treeId,
            wakingId,
            activeTrees,
            hostById,
            flowerBindOpts,
          );
          continue;
        }
        reshuffleClimbFlowerSlotsOnTree(
          flowerSlotsRef.current,
          plants,
          treeId,
          hostById,
          flowerBindOpts,
        );
      }

      treeGrowthFronts.set(
        treeId,
        growth * Math.max(lifecycle.length, 1e-6),
      );
    }

    for (let i = 0; i < plants.length; i += 1) {
      const plant = plants[i];
      const stemGrow = treeSegmentGrowth(
        treeGrowthFronts.get(plant.treeId) ?? 0,
        plant.pathStartDistance,
        plant.pathEndDistance,
      );
      const [motionX, motionZ] = plant.role === 'feeder'
        ? [0, 0]
        : computeWindSway(
          plant.motionPosition[0],
          plant.motionPosition[2],
          clock.elapsedTime,
          wind,
          0.32,
        );
      const o = i * 4;
      plant.stemGrow = stemGrow;
      plant.swayX = motionX;
      plant.swayZ = motionZ;
      data[o] = stemGrow;
      data[o + 1] = motionX;
      data[o + 2] = motionZ;
      data[o + 3] = 0;
    }
    // Texels past plants.length are never written, and the backing Float32Array
    // starts zeroed, so there is nothing to clear here.
    tex.needsUpdate = true;
    updateFlowerBatchTips(flowerRuntimeRef.current.flowerBatches, plants);
    cullFlowerBatches(gl, camera, flowerRuntimeRef.current.flowerBatches);
  }, 1);

  if (!controls.enabled) return null;

  const showStems = Boolean(stemBuild.geometry && stemMaterial && stemBuild.plants.length);
  const debugVisible = Boolean(controls.showDebug);

  return (
    <group name="ClimbTendrils">
      {showStems && !controls.hideRenderedTendrils && (
        <AsyncCompile
          id={`climb-tendrils-${stemBuild.plants.length}-${controls.leafCount}-${flowerAttachments.indices.length}`}
        >
          <group>
            <mesh
              ref={enablePlantShadowLayer}
              geometry={stemBuild.geometry}
              material={stemMaterial}
              frustumCulled={false}
              castShadow
              receiveShadow
            />
            {controls.leafCount > 0 && (
              <Suspense fallback={null}>
                <FieldLeaves
                  plants={stemBuild.plants}
                  plantData={stemBuild.plantData}
                  flowerUniforms={flowerUniforms}
                  leafCount={controls.leafCount}
                  leafSpan={controls.leafSpan}
                  leafScale={controls.leafScale}
                  scaleVariance={CLIMB_INTERNALS.leafScaleVariation}
                  droop={controls.leafDroop}
                  leafBend={controls.leafCurl}
                  curlStrength={[4, 1]}
                  curlPower={[6, 1]}
                  bendStrength={0}
                  bendVariance={CLIMB_INTERNALS.leafCurlVariation}
                  colorLevels={CLIMB_INTERNALS.leafColorLevels}
                />
              </Suspense>
            )}
            {flowerAttachments.indices.length > 0 && (
              <Suspense fallback={null}>
                <FlowerTypeBatch
                  flowerType={CLIMB_FLOWER_TYPE}
                  plants={flowerAttachments.plants}
                  plantIndexMap={flowerAttachments.indices}
                  attachTs={flowerAttachments.attachTs}
                  attachNormals={flowerAttachments.attachNormals}
                  stemYMax={STEM_Y_MAX}
                  flowerControls={flowerControls}
                  runtimeRef={flowerRuntimeRef}
                />
              </Suspense>
            )}
          </group>
        </AsyncCompile>
      )}
      <ClimbDebug
        visible={debugVisible}
        wraps={wraps}
        hosts={hosts}
        surfaceOffset={debouncedPath.surfaceOffset}
        noiseAmount={debouncedPath.noiseAmount}
        showSeeds={controls.showSeeds}
        showHitch={false}
        showPaths={controls.showPaths}
        showDirs={false}
        showBounds={false}
        showCapsules={controls.showCapsules}
        diagnosticMode={CLIMB_INTERNALS.diagnosticMode}
        showClearanceMarkers={CLIMB_INTERNALS.showClearanceMarkers}
        capsuleFilterId={null}
        pathCount={controls.pathCount}
      />
    </group>
  );
}
