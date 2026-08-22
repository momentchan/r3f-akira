import {
  abs,
  atomicAdd,
  distance,
  Fn,
  If,
  instanceIndex,
  uint,
  uniform,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { createLODRouting, createResetCountCompute } from '@core/vat';
import { FLOWER_CULL_DEFAULTS } from './flowerCullDefaults';
import { keepRadiusForSlots } from './flowerInstanceLayout';

/**
 * Desktop Blink WebGPU path. Rose-style padded clip frustum + keep-sphere,
 * then If/Else LOD routing into per-band visible-indices + drawIndirect.
 */
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

export function dispatchFlowerCullGpu(gl, cameraWorld, viewProjection, batch, options = {}) {
  const { uniforms, resetComputes, cullCompute } = batch.cull;
  uniforms.uCameraPosition.value.copy(cameraWorld);
  uniforms.uViewProjectionMatrix.value.copy(viewProjection);
  uniforms.uCullEnabled.value = options.enabled === false ? 0 : 1;
  uniforms.uCullPadding.value = FLOWER_CULL_DEFAULTS.cullPadding;
  uniforms.uKeepRadius.value = keepRadiusForSlots(batch.cull.lodSlots);
  for (let i = 0; i < resetComputes.length; i += 1) {
    gl.compute(resetComputes[i]);
  }
  gl.compute(cullCompute);
}
