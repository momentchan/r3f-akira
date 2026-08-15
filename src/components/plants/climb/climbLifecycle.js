import * as THREE from 'three';

/** Local tube reveal for a single [start, end] interval of a tree-distance front. */
export function treeSegmentGrowth(growthFront, startDistance, endDistance) {
  const span = Math.max(endDistance - startDistance, 1e-6);
  const progress = THREE.MathUtils.clamp(
    (growthFront - startDistance) / span,
    0,
    1,
  );
  return progress * progress * (3 - 2 * progress);
}
