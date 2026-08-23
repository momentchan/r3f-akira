import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MutableRefObject } from 'react';
import type { Box3, BufferGeometry, Group, Object3D, Vector3 } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { buildCharacterMeshBVH, findHeadLocalPoint } from '../../plants/field/bodyBounds';
import {
  extractBodyRight,
  extractLimbCapsules,
} from '../../plants/climb/limbCapsules';

export type BodyBoundsPayload = {
  localBox: Box3;
  /** Field-parent space, posed suit. */
  bvh: MeshBVH;
  /** Owns boundsTree — dispose when replaced. */
  geometry: BufferGeometry;
  /** Helmet mesh center, else head bone. */
  headLocal: Vector3 | null;
  capsules: ReturnType<typeof extractLimbCapsules>;
  /** thigh.r − thigh.l, field-parent space. */
  bodyRight: Vector3;
};

type Args = {
  groupRef: MutableRefObject<Group | null>;
  fieldParentRef?: MutableRefObject<Object3D | null>;
  onBounds?: (bounds: BodyBoundsPayload | null) => void;
};

function disposePayload(payload: BodyBoundsPayload | null | undefined) {
  if (!payload) return;
  payload.geometry.boundsTree = undefined;
  payload.geometry.dispose();
}

/**
 * Bake posed suit → MeshBVH after Lay settles; publish for plant clearance.
 */
export function useCharacterBodyBounds({
  groupRef,
  fieldParentRef,
  onBounds,
}: Args) {
  const settleFrames = useRef(0);
  const latestRef = useRef<BodyBoundsPayload | null>(null);

  useEffect(() => () => {
    disposePayload(latestRef.current);
    latestRef.current = null;
    onBounds?.(null);
  }, [onBounds]);

  useFrame(() => {
    if (!onBounds || !groupRef.current) return;

    if (settleFrames.current < 10) {
      settleFrames.current += 1;
      return;
    }

    if (latestRef.current) return;

    const root = groupRef.current;
    const parent = fieldParentRef?.current ?? root.parent;
    if (!parent) return;

    const built = buildCharacterMeshBVH(root, parent);
    if (!built) return;

    const payload: BodyBoundsPayload = {
      localBox: built.localBox,
      bvh: built.bvh,
      geometry: built.geometry,
      headLocal: findHeadLocalPoint(root, parent),
      capsules: extractLimbCapsules(root, parent),
      bodyRight: extractBodyRight(root, parent),
    };
    latestRef.current = payload;
    onBounds(payload);
  });
}
