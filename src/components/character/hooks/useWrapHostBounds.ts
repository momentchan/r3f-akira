import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MutableRefObject } from 'react';
import type { Group, Object3D, BufferGeometry, Box3 } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { buildCharacterMeshBVH } from '../../plants/field/bodyBounds';

export type WrapHostBoundsPayload = {
  localBox: Box3;
  worldBox: Box3;
  bvh: MeshBVH;
  geometry: BufferGeometry;
  version: number;
};

type Args = {
  groupRef: MutableRefObject<Group | null>;
  fieldParentRef?: MutableRefObject<Object3D | null>;
  enabled?: boolean;
  /** Bump to force rebake (e.g. after transform settles). */
  revisionKey?: string;
  onBounds?: (bounds: WrapHostBoundsPayload | null) => void;
};

function disposePayload(payload: WrapHostBoundsPayload | null | undefined) {
  if (!payload) return;
  payload.geometry.boundsTree = undefined;
  payload.geometry.dispose();
}

/**
 * Bake a static prop (backpack) into MeshBVH in field-parent space.
 */
export function useWrapHostBounds({
  groupRef,
  fieldParentRef,
  enabled = true,
  revisionKey = 'default',
  onBounds,
}: Args) {
  const versionRef = useRef(0);
  const settleFrames = useRef(0);
  const builtKey = useRef('');
  const latestRef = useRef<WrapHostBoundsPayload | null>(null);

  useEffect(() => {
    settleFrames.current = 0;
    builtKey.current = '';
  }, [enabled, revisionKey]);

  useEffect(() => () => {
    disposePayload(latestRef.current);
    latestRef.current = null;
    onBounds?.(null);
  }, [onBounds]);

  useFrame(() => {
    if (!enabled || !onBounds || !groupRef.current) return;

    if (settleFrames.current < 4) {
      settleFrames.current += 1;
      return;
    }

    const root = groupRef.current;
    const parent = fieldParentRef?.current ?? root.parent;
    if (!parent) return;

    if (revisionKey === builtKey.current && latestRef.current) return;

    const built = buildCharacterMeshBVH(root, parent);
    if (!built) return;

    disposePayload(latestRef.current);
    versionRef.current += 1;
    builtKey.current = revisionKey;

    const payload: WrapHostBoundsPayload = {
      localBox: built.localBox,
      worldBox: built.worldBox,
      bvh: built.bvh,
      geometry: built.geometry,
      version: versionRef.current,
    };
    latestRef.current = payload;
    onBounds(payload);
  });
}
