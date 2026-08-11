import { useEffect, useMemo, useRef } from 'react';
import { useAnimations } from '@react-three/drei';
import { useControls } from 'leva';
import { KeyboardMapper } from '@core';
import { Group, type Object3D } from 'three';
import { CharacterProps } from './config';
import { useCharacterAssets } from './hooks/useCharacterAssets';
import { useCharacterBodyBounds } from './hooks/useCharacterBodyBounds';
import { useCharacterPhysics } from './hooks/useCharacterPhysics';
import { useCharacterTableau } from './hooks/useCharacterTableau';
import { input, keyBindings } from './input/controls';
import { CHARACTER_LOOK_DEFAULTS } from './look/characterDefaults';
import {
  createCharacterControlsSchema,
  syncCharacterControls,
} from './look/characterControls';
import { bakeContactDirt } from './utils/bakeContactDirt';

export const Character = ({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  visible = true,
  mode = 'locomotion',
  pose = 'Lay',
  fieldParentRef,
  onBodyBounds,
  contactPoints,
}: CharacterProps) => {
  const groupRef = useRef<Group>(null);
  const { scene, animations, bodyMat, detailMat, outlineMat } =
    useCharacterAssets();

  const isTableau = mode === 'tableau';
  const sceneRef = useRef<Object3D | null>(null);
  sceneRef.current = scene;
  const { actions, names } = useAnimations(animations, sceneRef);

  useCharacterTableau(actions, names, pose, isTableau);
  useCharacterPhysics(groupRef, actions, 'camera', !isTableau);
  useCharacterBodyBounds({
    groupRef,
    fieldParentRef,
    enabled: isTableau,
    pose,
    onBodyBounds,
  });

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

  // Light dirt only where stems meet the suit (subtle lived-in wear).
  useEffect(() => {
    if (!isTableau || !groupRef.current || !fieldParentRef?.current) return;
    bakeContactDirt(
      groupRef.current,
      fieldParentRef.current,
      contactPoints ?? [],
      { inner: 0.1, outer: 0.45 },
    );
  }, [isTableau, contactPoints, fieldParentRef, scene, pose]);

  if (!scene) return null;

  return (
    <>
      {!isTableau && <KeyboardMapper input={input} keyMap={keyBindings} />}
      <group
        ref={groupRef}
        position={position}
        rotation={rotation}
        scale={scale}
        visible={visible}
        dispose={null}
      >
        <primitive object={scene} />
      </group>
    </>
  );
};
