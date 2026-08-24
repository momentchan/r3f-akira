import { useLayoutEffect, type RefObject } from 'react';
import { useControls } from 'leva';
import type { Object3D } from 'three';
import {
  CHARACTER_CONTROLS_SCHEMA,
  syncCharacterControls,
} from '../look/characterControls';
import { setDirtGroundY } from '../materials/createToonNodeMaterial';
import type {
  CharacterOutlineMaterial,
  CharacterToonMaterial,
} from '../materials/createToonNodeMaterial';

export function useCharacterLook(
  outlineMat: CharacterOutlineMaterial | null | undefined,
  fieldParentRef: RefObject<Object3D | null> | undefined,
  ...materials: Array<CharacterToonMaterial | null | undefined>
) {
  const controls = useControls(
    'Character',
    CHARACTER_CONTROLS_SCHEMA,
    { collapsed: true },
  );

  useLayoutEffect(() => {
    const uniforms = materials
      .filter(Boolean)
      .map((mat) => mat!.userData.toonUniforms);
    if (uniforms.length === 0) return;
    syncCharacterControls(
      controls,
      uniforms,
      outlineMat?.userData.outlineUniforms,
    );
    setDirtGroundY(uniforms, fieldParentRef?.current);
  }, [controls, outlineMat, fieldParentRef, ...materials]);
}
