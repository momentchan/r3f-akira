import * as THREE from 'three';

export type StemBaseXZ = { x: number; z: number };

export type BakeContactDirtOptions = {
  /** Full wear at distance <= inner (field units). */
  inner?: number;
  /** Wear fades to 0 by outer. */
  outer?: number;
};

const ATTR = 'aContactDirt';
const _v = new THREE.Vector3();

/**
 * Soft contact wear mask: dirt only near plant stem bases on the posed suit.
 * Writes `aContactDirt` (0…1) on body meshes for the toon dirt mix.
 */
export function bakeContactDirt(
  root: THREE.Object3D,
  parent: THREE.Object3D,
  stemBases: StemBaseXZ[],
  options: BakeContactDirtOptions = {},
) {
  const inner = options.inner ?? 0.07;
  const outer = Math.max(options.outer ?? 0.32, inner + 1e-4);
  const span = outer - inner;

  root.updateWorldMatrix(true, true);
  parent.updateWorldMatrix(true, false);

  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = obj as THREE.SkinnedMesh;
      if (skinned.skeleton) skeletons.add(skinned.skeleton);
    }
  });
  for (const sk of skeletons) sk.update();
  root.updateWorldMatrix(true, true);

  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh || !obj.visible) return;
    if (obj.name.includes('Person') || obj.name.includes('Outline')) return;

    const mesh = obj as THREE.Mesh;
    const position = mesh.geometry?.getAttribute?.('position') as
      | THREE.BufferAttribute
      | undefined;
    if (!position || position.count < 1) return;

    let attr = mesh.geometry.getAttribute(ATTR) as THREE.BufferAttribute | undefined;
    if (!attr || attr.count !== position.count) {
      attr = new THREE.BufferAttribute(new Float32Array(position.count), 1);
      mesh.geometry.setAttribute(ATTR, attr);
    }

    const arr = attr.array as Float32Array;
    if (stemBases.length === 0) {
      arr.fill(0);
      attr.needsUpdate = true;
      return;
    }

    const skinned = mesh as THREE.SkinnedMesh;
    for (let i = 0; i < position.count; i += 1) {
      if (skinned.isSkinnedMesh) skinned.getVertexPosition(i, _v);
      else _v.fromBufferAttribute(position, i);
      _v.applyMatrix4(mesh.matrixWorld);
      parent.worldToLocal(_v);

      let best = Infinity;
      for (let s = 0; s < stemBases.length; s += 1) {
        const dx = _v.x - stemBases[s].x;
        const dz = _v.z - stemBases[s].z;
        // Soft vertical falloff — contact is near the suit silhouette, not helmet crown.
        const dy = Math.max(0, _v.y - 0.05);
        const d = Math.hypot(dx, dz) + dy * 0.35;
        if (d < best) best = d;
      }

      const t = THREE.MathUtils.clamp((outer - best) / span, 0, 1);
      // Smoothstep for soft bands (graphic, not muddy blobs).
      arr[i] = t * t * (3 - 2 * t);
    }
    attr.needsUpdate = true;
  });
}
