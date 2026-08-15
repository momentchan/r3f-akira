import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MutableRefObject } from 'react';
import type { Group, Object3D } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { buildCharacterMeshBVH, findHeadLocalPoint } from '../../plants/field/bodyBounds';
import {
  extractBodyAxes,
  extractLimbCapsulesWithDiagnostics,
} from '../../plants/climb/limbCapsules';

export type LimbCapsule = {
  id: string;
  a: import('three').Vector3;
  b: import('three').Vector3;
  radius: number;
  weight: number;
  length: number;
  uMin?: number;
  uMax?: number;
  coverageRadiusScale?: number;
  radiusExpansionLimit?: number;
  densityScale?: number;
  wrapAngleScale?: number;
  derivedFromHelmetMesh?: boolean;
};

export type CapsuleDiagnostics = {
  expected: number;
  found: number;
  boneCount: number;
  validIds: string[];
  issues: Array<{
    id: string;
    reason: string;
    missing?: string[];
  }>;
};

export type BodyBoundsPayload = {
  localBox: import('three').Box3;
  worldBox: import('three').Box3;
  /** MeshBVH in field-parent local space (posed suit). */
  bvh: MeshBVH;
  /** Geometry owning boundsTree — dispose when replaced. */
  geometry: import('three').BufferGeometry;
  /** Head/helmet point in field-parent local space (helmet mesh center, else bone). */
  headLocal: import('three').Vector3 | null;
  /** Directed wrap regions (limbs + torso) in field-parent space. */
  capsules: LimbCapsule[];
  /** Extraction status for the climb debug checkpoint. */
  capsuleDiagnostics: CapsuleDiagnostics;
  /** Character-facing right (thigh.r − thigh.l), field-parent space. */
  bodyRight: import('three').Vector3;
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

    // Rebuild once per pose — bump key if capsule/head lookup changes.
    const key = `${pose ?? 'none'}:directed-wrap-regions-v3`;
    if (key === builtKey.current && latestRef.current) return;

    const built = buildCharacterMeshBVH(root, parent);
    if (!built) return;

    disposePayload(latestRef.current);
    versionRef.current += 1;
    builtKey.current = key;

    const axes = extractBodyAxes(root, parent);
    const extracted = extractLimbCapsulesWithDiagnostics(root, parent);
    const payload: BodyBoundsPayload = {
      localBox: built.localBox,
      worldBox: built.worldBox,
      bvh: built.bvh,
      geometry: built.geometry,
      headLocal: findHeadLocalPoint(root, parent),
      capsules: extracted.capsules,
      capsuleDiagnostics: extracted.diagnostics,
      bodyRight: axes.right,
      version: versionRef.current,
    };
    latestRef.current = payload;
    onBodyBounds(payload);
  });
}
