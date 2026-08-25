import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshBasicMaterial } from 'three';
import { BVHHelper } from 'three-mesh-bvh';

/** MeshBVH leaf boxes for a clearance host (body, backpack, …). */
export function BvhHelperDebug({
  geometry = null,
  visible = false,
  depth = 10,
}) {
  const groupRef = useRef(null);
  const helperRef = useRef(null);
  const meshRef = useRef(null);

  const material = useMemo(
    () => new MeshBasicMaterial({ visible: false }),
    [],
  );

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group || !geometry?.boundsTree) {
      return undefined;
    }

    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    const helper = new BVHHelper(mesh, depth);
    helper.displayParents = false;

    meshRef.current = mesh;
    helperRef.current = helper;
    group.add(mesh);
    group.add(helper);

    return () => {
      group.remove(helper);
      group.remove(mesh);
      helper.geometry?.dispose?.();
      // Don't dispose shared geometry / material here — owned by bounds payload / hook.
      helperRef.current = null;
      meshRef.current = null;
    };
  }, [geometry, depth, material]);

  useFrame(() => {
    const group = groupRef.current;
    if (group) group.visible = Boolean(visible && geometry?.boundsTree);
    helperRef.current?.update?.();
  });

  return <group ref={groupRef} />;
}
