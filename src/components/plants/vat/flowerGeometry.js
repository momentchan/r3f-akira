import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { extractMeshGeometriesFromScene } from '@core/vat';
import { assignPetalSegments } from './petalSegments';

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

/** Merge VAT mesh parts into one instanced flower geometry. */
export function buildVatFlowerGeometry(vatData, { stemYMax, partColorMode }) {
  if (!vatData.isLoaded || !vatData.scene || !vatData.meta) return null;
  const parts = extractFlowerMeshGeometries(vatData.scene, vatData.meta, {
    flipX: true,
    stemYMax,
    partColorMode,
  });
  if (!parts.length) return null;
  const merged = parts.length === 1
    ? parts[0].geometry
    : mergeGeometries(parts.map((part) => part.geometry), false);
  const singlePart = parts.length === 1;
  parts.forEach((part) => {
    if (part.geometry !== merged) part.geometry.dispose();
  });
  if (singlePart) assignPetalSegments(merged);
  return merged;
}
