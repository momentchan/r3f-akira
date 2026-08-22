import * as THREE from 'three/webgpu';
import { FLOWER_CULL_DEFAULTS } from './flowerCullDefaults';
import {
  FLOWER_INSTANCE_FLOATS,
  FLOWER_TIP0_OFFSET,
  keepRadiusForSlots,
} from './flowerInstanceLayout';

const _frustum = new THREE.Frustum();
const _headPos = new THREE.Vector3();

/** World-space stand-in for the GPU clip-space padded frustum test. */
function insidePaddedFrustum(point) {
  const padding = FLOWER_CULL_DEFAULTS.cullPadding;
  for (let i = 0; i < _frustum.planes.length; i += 1) {
    if (_frustum.planes[i].distanceToPoint(point) < -padding) return false;
  }
  return true;
}

function applyCpuDrawCount(slot, compacted) {
  if (slot.drawBuffer?.array) {
    slot.drawBuffer.array[1] = compacted;
    slot.drawBuffer.needsUpdate = true;
  }
  // Indirect draw on Apple WebGPU double-submits both LOD meshes.
  // Mesh.count is the instanced draw count three.js uses without setIndirect.
  slot.geometry.setIndirect(null);
  if (slot.mesh) slot.mesh.count = compacted;
}

/**
 * Apple WebKit + WebGL2 path. Same frustum / keep-radius / exclusive LOD
 * windows as the compute, but writes visibleIndices and Mesh.count on the CPU.
 */
export function dispatchFlowerCullCpu(cameraWorld, viewProjection, batch, options = {}) {
  const { lodSlots, shadowSlot, count } = batch.cull;
  const data = batch.instanceStorage.data;
  const enabled = options.enabled !== false;
  const keepRadius = keepRadiusForSlots(lodSlots);

  _frustum.setFromProjectionMatrix(viewProjection);

  const compacted = lodSlots.map(() => 0);
  let shadowCount = 0;

  for (let i = 0; i < count; i += 1) {
    const base = i * FLOWER_INSTANCE_FLOATS + FLOWER_TIP0_OFFSET;
    if (data[base + 3] <= 0.001) continue;

    _headPos.set(data[base], data[base + 1], data[base + 2]);
    const dist = _headPos.distanceTo(cameraWorld);
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
