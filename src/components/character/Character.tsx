import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { bakeGroundContactDirt } from './utils/bakeGroundContactDirt';

export const Character = ({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  visible = true,
  mode = 'locomotion',
  pose = 'Lay',
  fieldParentRef,
  onBodyBounds,
}: CharacterProps) => {
  const groupRef = useRef<Group>(null);
  const { scene, animations, bodyMat, detailMat, outlineMat } =
    useCharacterAssets();

  const isTableau = mode === 'tableau';
  const [settledBoundsVersion, setSettledBoundsVersion] = useState(0);
  const sceneRef = useRef<Object3D | null>(null);
  sceneRef.current = scene;
  const { actions, names } = useAnimations(animations, sceneRef);

  useCharacterTableau(actions, names, pose, isTableau);
  useCharacterPhysics(groupRef, actions, 'camera', !isTableau);
  const handleBodyBounds = useCallback(
    (bounds: Parameters<NonNullable<CharacterProps['onBodyBounds']>>[0]) => {
      setSettledBoundsVersion(bounds?.version ?? 0);
      onBodyBounds?.(bounds);
    },
    [onBodyBounds],
  );
  useCharacterBodyBounds({
    groupRef,
    fieldParentRef,
    enabled: isTableau,
    pose,
    onBodyBounds: handleBodyBounds,
  });

  useEffect(() => {
    setSettledBoundsVersion(0);
  }, [isTableau, pose, scene]);

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

  // Bake only after the animation has settled, using the shared ground plane.
  useEffect(() => {
    if (
      !isTableau ||
      settledBoundsVersion === 0 ||
      !groupRef.current ||
      !fieldParentRef?.current
    ) return;
    bakeGroundContactDirt(
      groupRef.current,
      fieldParentRef.current,
      { groundY: 0, fullHeight: 0.06, fadeHeight: 0.42 },
    );
  }, [isTableau, settledBoundsVersion, fieldParentRef, scene]);

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
