import {
  atomicAdd,
  Fn,
  If,
  distance,
  dot,
  float,
  instanceIndex,
  instancedArray,
  storage,
  struct,
  uint,
  uniform,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import {
  createLODRouting,
  createResetCountCompute,
  createVisibleIndicesBuffer,
  drawIndirectStructure,
} from '@core/vat';

/**
 * Per-flower GPU record. CPU writes tips each frame; the cull compute and the
 * VAT vertex shader both read this. Adding a second LOD mesh does not change
 * the layout — extra LODs only add their own visible-index + indirect buffers.
 *
 *   tip0     = world pos.xyz, scale
 *   tip1     = quat.xyz, VAT frame
 *   colorVar = hueShift, lightShift, shed, stemLength
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
 * A low-poly VAT mesh later is another slot with a distance window, sharing
 * the same instance storage and the same cull compute.
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
  return {
    geometry,
    drawBuffer,
    drawStorage,
    indices: createVisibleIndicesBuffer(instanceCount),
    vertexCount,
    minDistance,
    maxDistance,
  };
}

export function createFlowerCullComputes({
  instanceStorage,
  lodSlots,
  shadowSlot = null,
  count,
}) {
  const uniforms = {
    uCameraPosition: uniform(new THREE.Vector3()),
    uCameraForward: uniform(new THREE.Vector3()),
    uCullEnabled: uniform(1),
  };
  const resetComputes = lodSlots.map((slot, index) => (
    createResetCountCompute(slot.drawStorage, slot.vertexCount)
      .setName(`FlowerCullReset_LOD${index}`)
  ));
  if (shadowSlot) {
    resetComputes.push(
      createResetCountCompute(shadowSlot.drawStorage, shadowSlot.vertexCount)
        .setName('FlowerCullReset_Shadow'),
    );
  }
  const buildLODRouting = createLODRouting(lodSlots);

  const cullFn = Fn(() => {
    const data = instanceStorage.node.element(instanceIndex);
    const tip0 = data.get('tip0');
    If(tip0.w.greaterThan(0.001), () => {
      const pos = tip0.xyz;
      const toHead = pos.sub(uniforms.uCameraPosition);
      const inFront = dot(toHead, uniforms.uCameraForward).greaterThan(float(0));

      If(uniforms.uCullEnabled.lessThan(0.5).or(inFront), () => {
        buildLODRouting(distance(pos, uniforms.uCameraPosition), instanceIndex);
        if (shadowSlot) {
          const shadowIndex = atomicAdd(shadowSlot.drawStorage.get('instanceCount'), uint(1));
          shadowSlot.indices.element(shadowIndex).assign(uint(instanceIndex));
        }
      });
    });
  });

  return {
    uniforms,
    resetComputes,
    cullCompute: cullFn().compute(count).setName('FlowerCull'),
  };
}

const _cameraForward = new THREE.Vector3();

export function dispatchFlowerCull(gl, camera, batch, options = {}) {
  if (!batch?.cull) return;
  camera.updateMatrixWorld();
  camera.getWorldDirection(_cameraForward);
  const { uniforms, resetComputes, cullCompute } = batch.cull;
  uniforms.uCameraPosition.value.copy(camera.position);
  uniforms.uCameraForward.value.copy(_cameraForward);
  uniforms.uCullEnabled.value = options.enabled === false ? 0 : 1;
  for (let i = 0; i < resetComputes.length; i += 1) {
    gl.compute(resetComputes[i]);
  }
  gl.compute(cullCompute);
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

export async function readDrawnFlowerCount(gl, flowerBatches) {
  if (typeof gl.getArrayBufferAsync !== 'function') return -1;
  let drawn = 0;
  for (const id in flowerBatches) {
    const lods = flowerBatches[id].lods;
    if (!lods) continue;
    for (let i = 0; i < lods.length; i += 1) {
      const raw = await gl.getArrayBufferAsync(lods[i].slot.drawBuffer);
      const array = raw instanceof Uint32Array ? raw : new Uint32Array(raw);
      drawn += array[1] ?? 0;
    }
  }
  return drawn;
}
