import {
  abs,
  atomicAdd,
  distance,
  float,
  Fn,
  If,
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
import { FLOWER_CULL_DEFAULTS } from './flowerCullDefaults';

/**
 * Desktop Blink WebGPU can use compute atomics + drawIndirect. Apple WebKit
 * (iPhone Chrome) still double-fills LOD bands on that path, and the WebGL2
 * fallback has no atomics at all — both compact on the CPU instead.
 */
function useCpuCull(gl) {
  if (!gl?.backend?.isWebGPUBackend) return true;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

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

/** Keep-sphere matches the hi-LOD split so nearby heads stay hi-only. */
function keepRadiusForSlots(lodSlots) {
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
  const indices = createVisibleIndicesBuffer(instanceCount);
  indices.value.usage = THREE.DynamicDrawUsage;
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

export function createFlowerCullComputes({
  instanceStorage,
  lodSlots,
  shadowSlot = null,
  count,
}) {
  const uniforms = {
    uCameraPosition: uniform(new THREE.Vector3()),
    uViewProjectionMatrix: uniform(new THREE.Matrix4()),
    uCullEnabled: uniform(1),
    uCullPadding: uniform(FLOWER_CULL_DEFAULTS.cullPadding),
    uKeepRadius: uniform(keepRadiusForSlots(lodSlots)),
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

  // Same visibility test false-earth Rose uses: padded clip-space frustum,
  // plus a keep-alive sphere so heads near the camera never pop on orbit.
  const cullFn = Fn(() => {
    const data = instanceStorage.node.element(instanceIndex);
    const tip0 = data.get('tip0');
    If(tip0.w.greaterThan(0.001), () => {
      const pos = tip0.xyz;
      const distToCamera = distance(pos, uniforms.uCameraPosition);
      const clipPos = uniforms.uViewProjectionMatrix.mul(vec4(pos, 1.0));
      const cullRadius = uniforms.uCullPadding;
      const w = clipPos.w;
      const isInFront = w.greaterThan(cullRadius.negate());
      const limit = w.add(cullRadius);
      const inFrustum = isInFront
        .and(abs(clipPos.x).lessThanEqual(limit))
        .and(abs(clipPos.y).lessThanEqual(limit))
        .and(abs(clipPos.z).lessThanEqual(limit));
      const inCircle = distToCamera.lessThan(uniforms.uKeepRadius);

      If(uniforms.uCullEnabled.lessThan(0.5).or(inFrustum.or(inCircle)), () => {
        buildLODRouting(distToCamera, instanceIndex);
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
    lodSlots,
    shadowSlot,
    count,
  };
}

const _cameraWorld = new THREE.Vector3();
const _viewProjection = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _headPos = new THREE.Vector3();

/** World-space stand-in for the compute's clip-space padded frustum test. */
function insidePaddedFrustum(point) {
  const padding = FLOWER_CULL_DEFAULTS.cullPadding;
  for (let i = 0; i < _frustum.planes.length; i += 1) {
    if (_frustum.planes[i].distanceToPoint(point) < -padding) return false;
  }
  return true;
}

/**
 * Compaction for the WebGL2 fallback, where indirect draw and compute atomics
 * do not exist. Mirrors the compute: same frustum + keep-radius test, same
 * exclusive LOD windows, but writes `visibleIndices` and `mesh.count` directly.
 */
function dispatchFlowerCullCPU(camera, batch, options = {}) {
  const { lodSlots, shadowSlot, count } = batch.cull;
  const data = batch.instanceStorage.data;
  const enabled = options.enabled !== false;
  const keepRadius = keepRadiusForSlots(lodSlots);

  _frustum.setFromProjectionMatrix(_viewProjection);

  const compacted = lodSlots.map(() => 0);
  let shadowCount = 0;

  for (let i = 0; i < count; i += 1) {
    const base = i * FLOWER_INSTANCE_FLOATS + FLOWER_TIP0_OFFSET;
    if (data[base + 3] <= 0.001) continue;

    _headPos.set(data[base], data[base + 1], data[base + 2]);
    const dist = _headPos.distanceTo(_cameraWorld);
    if (enabled && dist >= keepRadius && !insidePaddedFrustum(_headPos)) continue;

    let band = 0;
    for (let s = 0; s < lodSlots.length; s += 1) {
      if (dist >= lodSlots[s].minDistance && dist < lodSlots[s].maxDistance) {
        band = s;
        break;
      }
    }

    lodSlots[band].indices.value.array[compacted[band]] = i;
    compacted[band] += 1;

    if (shadowSlot) {
      shadowSlot.indices.value.array[shadowCount] = i;
      shadowCount += 1;
    }
  }

  for (let s = 0; s < lodSlots.length; s += 1) {
    lodSlots[s].indices.value.needsUpdate = true;
    applyCpuDrawCount(lodSlots[s], compacted[s]);
  }
  if (shadowSlot) {
    shadowSlot.indices.value.needsUpdate = true;
    applyCpuDrawCount(shadowSlot, shadowCount);
  }
}

function applyCpuDrawCount(slot, compacted) {
  if (slot.drawBuffer?.array) {
    slot.drawBuffer.array[1] = compacted;
    slot.drawBuffer.needsUpdate = true;
  }
  // Indirect draw on Apple WebGPU is what double-submits both LOD meshes.
  // Mesh.count is the instanced draw count three.js uses without setIndirect.
  slot.geometry.setIndirect(null);
  if (slot.mesh) slot.mesh.count = compacted;
}

export function dispatchFlowerCull(gl, camera, batch, options = {}) {
  if (!batch?.cull) return;
  camera.updateMatrixWorld();
  camera.getWorldPosition(_cameraWorld);
  _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  if (useCpuCull(gl)) {
    dispatchFlowerCullCPU(camera, batch, options);
    return;
  }

  const { uniforms, resetComputes, cullCompute } = batch.cull;
  uniforms.uCameraPosition.value.copy(_cameraWorld);
  uniforms.uViewProjectionMatrix.value.copy(_viewProjection);
  uniforms.uCullEnabled.value = options.enabled === false ? 0 : 1;
  uniforms.uCullPadding.value = FLOWER_CULL_DEFAULTS.cullPadding;
  uniforms.uKeepRadius.value = keepRadiusForSlots(batch.cull.lodSlots);
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

  if (useCpuCull(gl)) {
    return slots.map((lod) => (lod.mesh?.visible === false ? 0 : (lod.mesh.count ?? 0)));
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
