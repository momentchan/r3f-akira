import * as THREE from 'three/webgpu';
import { dispatchFlowerCullGpu } from './flowerCullGpu';
import { FLOWER_INSTANCE_FLOATS, FLOWER_TIP0_OFFSET } from './flowerInstanceLayout';

export {
  createFlowerInstanceStorage,
  createFlowerLodSlot,
  FLOWER_COLOR_OFFSET,
  FLOWER_INSTANCE_FLOATS,
  FLOWER_TIP0_OFFSET,
  FLOWER_TIP1_OFFSET,
  flowerInstanceStructure,
} from './flowerInstanceLayout';
export { createFlowerCullComputes } from './flowerCullGpu';

const _cameraWorld = new THREE.Vector3();
const _viewProjection = new THREE.Matrix4();

export function dispatchFlowerCull(gl, camera, batch, options = {}) {
  if (!batch?.cull) return;
  camera.updateMatrixWorld();
  camera.getWorldPosition(_cameraWorld);
  _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  dispatchFlowerCullGpu(gl, _cameraWorld, _viewProjection, batch, options);
}

export function countTotalFlowerSlots(flowerBatches) {
  let total = 0;
  for (const id in flowerBatches) {
    total += flowerBatches[id].instanceStorage?.count ?? 0;
  }
  return total;
}

/** Heads with scale > 0 — blooming or shedding, not dormant/dead. */
export function countActiveFlowerHeads(flowerBatches) {
  let alive = 0;
  for (const id in flowerBatches) {
    const storage = flowerBatches[id].instanceStorage;
    if (!storage) continue;
    const { data, count } = storage;
    for (let i = 0; i < count; i += 1) {
      if (data[i * FLOWER_INSTANCE_FLOATS + FLOWER_TIP0_OFFSET + 3] > 0.001) {
        alive += 1;
      }
    }
  }
  return alive;
}

/**
 * Per-LOD instance counts actually submitted this frame. Split by band on
 * purpose: a single summed number hides the failure where one flower is drawn
 * by both the hi and the low mesh.
 */
export async function readDrawnFlowerCounts(gl, flowerBatches) {
  const slots = [];
  for (const id in flowerBatches) {
    const lods = flowerBatches[id].lods;
    if (!lods) continue;
    for (let i = 0; i < lods.length; i += 1) slots.push(lods[i]);
  }

  if (typeof gl.getArrayBufferAsync !== 'function') return [];

  const buffers = await Promise.all(
    slots.map((lod) => gl.getArrayBufferAsync(lod.slot.drawBuffer)),
  );
  return buffers.map((raw) => {
    const array = raw instanceof Uint32Array ? raw : new Uint32Array(raw);
    return array[1] ?? 0;
  });
}
