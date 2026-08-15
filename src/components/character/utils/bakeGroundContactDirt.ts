import * as THREE from 'three';

export type BakeGroundContactDirtOptions = {
  /** Ground plane in field-parent local space. */
  groundY?: number;
  /** Full dirt below this height above the ground. */
  fullHeight?: number;
  /** Dirt reaches zero at this height above the ground. */
  fadeHeight?: number;
  /** Deterministic variation applied to the contact boundary. */
  edgeNoise?: number;
  /** Spatial frequency of the boundary variation. */
  noiseScale?: number;
};

const ATTR = 'aContactDirt';
const _v = new THREE.Vector3();

/**
 * Stable ground-contact wear mask for a posed character or prop.
 *
 * The mask is based only on each posed vertex's height above the shared ground
 * plane. A small continuous, deterministic variation keeps the boundary from
 * reading as a perfectly horizontal CG band. It does not depend on plants.
 * Writes `aContactDirt` (0…1) for the toon dirt mix.
 */
export function bakeGroundContactDirt(
  root: THREE.Object3D,
  parent: THREE.Object3D,
  options: BakeGroundContactDirtOptions = {},
) {
  const groundY = options.groundY ?? 0;
  const fullHeight = Math.max(options.fullHeight ?? 0.06, 0);
  const fadeHeight = Math.max(options.fadeHeight ?? 0.42, fullHeight + 1e-4);
  const edgeNoise = Math.max(options.edgeNoise ?? 0.055, 0);
  const noiseScale = Math.max(options.noiseScale ?? 2.4, 1e-4);
  const span = fadeHeight - fullHeight;

  root.updateWorldMatrix(true, true);
  parent.updateWorldMatrix(true, false);

  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = obj as THREE.SkinnedMesh;
      if (skinned.skeleton) skeletons.add(skinned.skeleton);
    }
  });
  for (const skeleton of skeletons) skeleton.update();
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
    const skinned = mesh as THREE.SkinnedMesh;
    for (let i = 0; i < position.count; i += 1) {
      if (skinned.isSkinnedMesh) skinned.getVertexPosition(i, _v);
      else _v.fromBufferAttribute(position, i);
      _v.applyMatrix4(mesh.matrixWorld);
      parent.worldToLocal(_v);

      // Two broad waves form a continuous, repeatable low-frequency field.
      // This varies the boundary without introducing per-vertex speckle.
      const nx = _v.x * noiseScale;
      const nz = _v.z * noiseScale;
      const noise =
        (Math.sin(nx * 1.13 + nz * 0.71 + 0.6) +
          Math.sin(nx * -0.47 + nz * 1.37 + 2.1)) *
        0.25;
      const height = _v.y - groundY - noise * edgeNoise;
      const t = THREE.MathUtils.clamp((fadeHeight - height) / span, 0, 1);
      arr[i] = t * t * (3 - 2 * t);
    }
    attr.needsUpdate = true;
  });
}
