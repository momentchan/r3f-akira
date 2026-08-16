import * as THREE from 'three/webgpu';
import { extractMeshGeometriesFromScene } from '@core/vat';

function markAllVerticesAsFlower(geometry) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    colors[i * 3] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Prepare VAT flower geometry with an explicit part-classification policy.
 * `allFlower` is for flower-head-only assets such as Jasmine: it avoids the
 * misleading missing-COLOR_0 warning and never relies on a Y threshold.
 */
export function extractFlowerMeshGeometries(
  scene,
  meta,
  { flipX = true, stemYMax = 0.05, partColorMode = 'auto' } = {},
) {
  const allFlower = partColorMode === 'allFlower';
  const parts = extractMeshGeometriesFromScene(scene, meta, {
    flipX,
    partColors: allFlower ? false : { stemYMax },
  });

  if (allFlower) {
    parts.forEach(({ geometry }) => markAllVerticesAsFlower(geometry));
  }
  return parts;
}
