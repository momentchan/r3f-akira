import { useEffect, useMemo, useRef } from 'react';
import { useControls } from 'leva';
import { Group } from 'three';
import { CharacterProps } from './config';
import { useCharacterAssets } from './hooks/useCharacterAssets';
import { CHARACTER_LOOK_DEFAULTS } from './look/characterDefaults';
import {
  createCharacterControlsSchema,
  syncCharacterControls,
} from './look/characterControls';

export const Character = ({ position = [0, 0, 0], scale = 1, visible = true }: CharacterProps) => {
  const groupRef = useRef<Group>(null);
  const { scene, bodyMat, detailMat, outlineMat } = useCharacterAssets();

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
    <group ref={groupRef} position={position} scale={scale} visible={visible} dispose={null}>
      <primitive object={scene} />
    </group>
  );
};
