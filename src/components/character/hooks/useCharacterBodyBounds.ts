import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MutableRefObject } from 'react';
import type { Group, Object3D } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { buildCharacterMeshBVH } from '../../plants/field/bodyBounds';

export type BodyBoundsPayload = {
  localBox: import('three').Box3;
  worldBox: import('three').Box3;
  /** MeshBVH in field-parent local space (posed suit). */
  bvh: MeshBVH;
  /** Geometry owning boundsTree — dispose when replaced. */
  geometry: import('three').BufferGeometry;
  version: number;
};

type Args = {
  groupRef: MutableRefObject<Group | null>;
  fieldParentRef?: MutableRefObject<Object3D | null>;
  enabled: boolean;
  pose?: string;
  onBodyBounds?: (bounds: BodyBoundsPayload | null) => void;
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
  enabled,
  pose,
  onBodyBounds,
}: Args) {
  const versionRef = useRef(0);
  const settleFrames = useRef(0);
  const builtKey = useRef('');
  const latestRef = useRef<BodyBoundsPayload | null>(null);

  useEffect(() => {
    settleFrames.current = 0;
    builtKey.current = '';
  }, [enabled, pose]);

  useEffect(() => () => {
    disposePayload(latestRef.current);
    latestRef.current = null;
    onBodyBounds?.(null);
  }, [onBodyBounds]);

  useFrame(() => {
    if (!enabled || !onBodyBounds || !groupRef.current) return;

    if (settleFrames.current < 10) {
      settleFrames.current += 1;
      return;
    }

    const root = groupRef.current;
    const parent = fieldParentRef?.current ?? root.parent;
    if (!parent) return;

    // Rebuild once per pose (key by pose + scale-ish presence).
    const key = `${pose ?? 'none'}`;
    if (key === builtKey.current && latestRef.current) return;

    const built = buildCharacterMeshBVH(root, parent);
    if (!built) return;

    disposePayload(latestRef.current);
    versionRef.current += 1;
    builtKey.current = key;

    const payload: BodyBoundsPayload = {
      localBox: built.localBox,
      worldBox: built.worldBox,
      bvh: built.bvh,
      geometry: built.geometry,
      version: versionRef.current,
    };
    latestRef.current = payload;
    onBodyBounds(payload);
  });
}
