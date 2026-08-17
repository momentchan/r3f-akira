import * as THREE from 'three/webgpu';
import { FLOWER_DEFAULTS } from '../look/flowerDefaults';
import { buildPackedStemTubes } from '../stem/buildStemTube';

/** Packed representation shared by body wraps and grounded branches. */
export function createTendrilDataTexture(count) {
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

export function applyTendrilLookDefaults(uniforms) {
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

export function buildPackedTendrilSystem(paths, {
  stemRadius,
  stemSegments,
  radialSegments,
  radiusAttenuation,
  baseFlare,
}) {
  const empty = () => ({
    geometry: null,
    plantData: null,
    plants: [],
    treeLengths: new Map(),
    treeSizes: new Map(),
  });
  if (!paths.length) return empty();

  const plantData = createTendrilDataTexture(paths.length);
  const packed = paths.map((path, plantId) => {
    const hasBranchStart = Number.isFinite(path.radiusStartScale);
    return {
      curve: path.curve,
      plantId,
      radiusStartScale: path.radiusStartScale,
      radiusEndScale: Number.isFinite(path.radiusEndScale)
        ? path.radiusEndScale
        : hasBranchStart ? radiusAttenuation : undefined,
      baseFlareScale: path.baseFlareScale,
    };
  });
  const geometry = buildPackedStemTubes(packed, {
    stemRadius,
    stemSegments,
    radialSegs: radialSegments,
    radiusAttenuation,
    baseFlare,
  });
  if (!geometry) {
    plantData.tex.dispose();
    return empty();
  }

  const sample = new THREE.Vector3();
  const plants = paths.map((path, plantId) => {
    path.curve.getPointAt(0.5, sample);
    const hasBranchStart = Number.isFinite(path.radiusStartScale);
    return {
      ...path,
      plantId,
      treeId: path.treeId ?? `${path.hostId ?? 'host'}:independent:${path.seed}`,
      role: path.role ?? 'branch',
      pathStartDistance: path.pathStartDistance ?? 0,
      pathEndDistance: path.pathEndDistance ?? path.curve.getLength(),
      motionPosition: [sample.x, sample.y, sample.z],
      position: [0, 0, 0],
      params: {
        stemLength: path.curve.getLength(),
        stemRadius,
        radiusAttenuation,
        baseFlare,
        radiusStartScale: path.radiusStartScale,
        radiusEndScale: Number.isFinite(path.radiusEndScale)
          ? path.radiusEndScale
          : hasBranchStart ? radiusAttenuation : undefined,
        baseFlareScale: path.baseFlareScale,
      },
    };
  });

  const treeLengths = new Map();
  const treeSizes = new Map();
  for (const plant of plants) {
    treeLengths.set(
      plant.treeId,
      Math.max(treeLengths.get(plant.treeId) ?? 0, plant.pathEndDistance),
    );
    treeSizes.set(plant.treeId, (treeSizes.get(plant.treeId) ?? 0) + 1);
  }
  return { geometry, plantData, plants, treeLengths, treeSizes };
}

/** Reveal one path interval using a tree-wide cumulative distance front. */
export function treeSegmentGrowth(growthFront, startDistance, endDistance) {
  const span = Math.max(endDistance - startDistance, 1e-6);
  const progress = THREE.MathUtils.clamp(
    (growthFront - startDistance) / span,
    0,
    1,
  );
  return progress * progress * (3 - 2 * progress);
}
