import * as THREE from 'three/webgpu';

/**
 * Tag vertices by petal. The VAT mesh is separate islands (dahlia: 120 × 145
 * verts), so union-find on the index buffer recovers them without a re-export.
 *
 * Packed into COLOR_0 (the VAT path is near the 8-buffer cap):
 *   .r = flower/stem tag (unchanged)
 *   .g = petal id 0..1
 *   .b = pivot vertex index (nearest the petal centroid)
 *
 * An index, not a position: the shader samples that vertex in the current VAT
 * frame so the shrink pivot follows the bloom.
 *
 * @returns {number} petal count, or 0 when the mesh is not petal-separable.
 */
export function assignPetalSegments(geometry) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!index || !position) return 0;

  const vertexCount = position.count;
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) parent[i] = i;

  const find = (start) => {
    let x = start;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const idx = index.array;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    union(idx[i], idx[i + 1]);
    union(idx[i + 1], idx[i + 2]);
  }

  const rootToPetal = new Map();
  const petalOf = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) {
    const root = find(i);
    let petal = rootToPetal.get(root);
    if (petal === undefined) {
      petal = rootToPetal.size;
      rootToPetal.set(root, petal);
    }
    petalOf[i] = petal;
  }

  const petalCount = rootToPetal.size;
  // One welded island (or one island per vertex) means this mesh has no separable
  // petals — leave the colors untouched instead of writing meaningless ids.
  if (petalCount < 2 || petalCount >= vertexCount) return 0;

  const sums = new Float64Array(petalCount * 3);
  const counts = new Uint32Array(petalCount);
  for (let i = 0; i < vertexCount; i += 1) {
    const p = petalOf[i];
    sums[p * 3] += position.getX(i);
    sums[p * 3 + 1] += position.getY(i);
    sums[p * 3 + 2] += position.getZ(i);
    counts[p] += 1;
  }

  // Pick a real vertex near each centroid so the pivot always sits on the petal.
  const bestDist = new Float64Array(petalCount).fill(Infinity);
  const bestVert = new Int32Array(petalCount).fill(-1);
  for (let i = 0; i < vertexCount; i += 1) {
    const p = petalOf[i];
    const n = counts[p] || 1;
    const dx = position.getX(i) - sums[p * 3] / n;
    const dy = position.getY(i) - sums[p * 3 + 1] / n;
    const dz = position.getZ(i) - sums[p * 3 + 2] / n;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDist[p]) {
      bestDist[p] = d;
      bestVert[p] = i;
    }
  }

  const existing = geometry.getAttribute('color');
  const colors = new Float32Array(vertexCount * 3);
  const denom = Math.max(petalCount - 1, 1);
  for (let i = 0; i < vertexCount; i += 1) {
    const p = petalOf[i];
    colors[i * 3] = existing ? existing.getX(i) : 1;
    colors[i * 3 + 1] = p / denom;
    colors[i * 3 + 2] = bestVert[p];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return petalCount;
}
