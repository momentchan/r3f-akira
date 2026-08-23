import { useEffect, useRef } from 'react';
import { useAnimations } from '@react-three/drei';
import { LoopRepeat, Group, type Object3D } from 'three';
import { useBindPlantShadow, usePlantShadowLight } from '../scene/plantShadowLayer';
import { CharacterProps } from './config';
import { useCharacterAssets } from './hooks/useCharacterAssets';
import { useCharacterBodyBounds } from './hooks/useCharacterBodyBounds';
import { useCharacterLook } from './hooks/useCharacterLook';

const LAY_CLIP = 'Lay';

export function Character({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  visible = true,
  fieldParentRef,
  onBounds,
}: CharacterProps) {
  const groupRef = useRef<Group>(null);
  const { scene, animations, bodyMat, detailMat, outlineMat } =
    useCharacterAssets();

  const plantShadowLight = usePlantShadowLight();
  useBindPlantShadow(plantShadowLight, bodyMat, detailMat);

  const sceneRef = useRef<Object3D | null>(null);
  sceneRef.current = scene;
  const { actions } = useAnimations(animations, sceneRef);

  useEffect(() => {
    const action = actions?.[LAY_CLIP];
    if (!action) return;
    action.reset().play();
    action.setEffectiveWeight(1);
    action.setLoop(LoopRepeat, Infinity);
    action.clampWhenFinished = true;
    return () => {
      void action.stop();
    };
  }, [actions]);

  useCharacterBodyBounds({
    groupRef,
    fieldParentRef,
    onBounds,
  });

  useCharacterLook(outlineMat, fieldParentRef, bodyMat, detailMat);

  if (!scene) return null;

  return (
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
  );
}
