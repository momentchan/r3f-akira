import { useEffect, useMemo, useRef } from 'react';
import { useControls } from 'leva';
import { KeyboardMapper } from '@core';
import { Group } from 'three';
import { CharacterProps } from './config';
import { useCharacterAssets } from './hooks/useCharacterAssets';
import { useCharacterPhysics } from './hooks/useCharacterPhysics';
import { input, keyBindings } from './input/controls';
import { CHARACTER_LOOK_DEFAULTS } from './look/characterDefaults';
import {
  createCharacterControlsSchema,
  syncCharacterControls,
} from './look/characterControls';

export const Character = ({
  position = [0, 0, 0],
  scale = 1,
  visible = true,
}: CharacterProps) => {
  const groupRef = useRef<Group>(null);
  const { scene, animations, bodyMat, detailMat, outlineMat } =
    useCharacterAssets();

  useCharacterPhysics(groupRef, scene, animations, 'camera');

  const schema = useMemo(
    () => createCharacterControlsSchema(CHARACTER_LOOK_DEFAULTS),
    [],
  );
  const controls = useControls('Character', schema, { collapsed: true });

  useEffect(() => {
    const lookUniforms = [bodyMat, detailMat]
      .filter(Boolean)
      .map((mat) => mat!.userData.toonUniforms);
    syncCharacterControls(
      controls,
      lookUniforms,
      outlineMat?.userData.outlineUniforms,
    );
  }, [bodyMat, detailMat, outlineMat, controls]);

  if (!scene) return null;

  return (
    <>
      <KeyboardMapper input={input} keyMap={keyBindings} />
      <group
        ref={groupRef}
        position={position}
        scale={scale}
        visible={visible}
        dispose={null}
      >
        <primitive object={scene} />
      </group>
    </>
  );
};
