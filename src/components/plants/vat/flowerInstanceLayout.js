import { instancedArray, storage, struct } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { createVisibleIndicesBuffer, drawIndirectStructure } from '@core/vat';
import { FLOWER_CULL_DEFAULTS } from './flowerCullDefaults';

/**
 * Per-flower GPU record. CPU writes tips each frame; GPU culling and the VAT
 * vertex shader read this. Extra LOD meshes only add their own
 * visible-index + indirect buffers.
 *
 *   tip0     = world pos.xyz, scale
 *   tip1     = quat.xyz, VAT frame
 *   colorVar = hueUnit, lightUnit, shed, stemLength
 *   hue/light ± live on petal.hueRange / petal.lightRange and multiply in shader
 */
export const flowerInstanceStructure = struct({
  tip0: 'vec4',
  tip1: 'vec4',
  colorVar: 'vec4',
});

export const FLOWER_INSTANCE_FLOATS = flowerInstanceStructure.layout.getLength();
export const FLOWER_TIP0_OFFSET = 0;
export const FLOWER_TIP1_OFFSET = 4;
export const FLOWER_COLOR_OFFSET = 8;

/** Keep-sphere matches the hi-LOD split so nearby heads stay hi-only. */
export function keepRadiusForSlots(lodSlots) {
  const split = lodSlots[0]?.maxDistance;
  if (typeof split === 'number' && Number.isFinite(split) && split > 0) return split;
  return FLOWER_CULL_DEFAULTS.lodDistance;
}

export function createFlowerInstanceStorage(count) {
  const size = Math.max(count, 1);
  const data = new Float32Array(size * FLOWER_INSTANCE_FLOATS);
  const node = instancedArray(data, flowerInstanceStructure);
  return {
    node,
    data,
    attribute: node.value,
    count: size,
  };
}

/**
 * One drawable LOD band. Culling-only uses a single slot at (0, Infinity).
 * A low-poly VAT mesh is another slot with a distance window, sharing the
 * same instance storage.
 */
export function createFlowerLodSlot({
  geometry,
  instanceCount,
  minDistance = 0,
  maxDistance = Infinity,
}) {
  const vertexCount = geometry.index
    ? geometry.index.count
    : geometry.attributes.position.count;
  const drawArray = new Uint32Array(5);
  drawArray[0] = vertexCount;
  const drawBuffer = new THREE.IndirectStorageBufferAttribute(drawArray, 5);
  const drawStorage = storage(drawBuffer, drawIndirectStructure, 1);
  geometry.setIndirect(drawBuffer);
  const indices = createVisibleIndicesBuffer(instanceCount);
  // Identity until the first compact/compute write. A zeroed buffer makes every
  // instance read slot 0 — one stacked flower per type.
  const indexArray = indices.value.array;
  for (let i = 0; i < instanceCount; i += 1) indexArray[i] = i;
  return {
    geometry,
    drawBuffer,
    drawStorage,
    indices,
    vertexCount,
    minDistance,
    maxDistance,
    mesh: null,
  };
}
