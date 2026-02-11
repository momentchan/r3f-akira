import { useRef } from 'react';
import { Group } from 'three';
import { CharacterProps } from './config';
import { useCharacterAssets } from './hooks/useCharacterAssets';

export const Character = ({ position = [0, 0, 0], scale = 1, visible = true }: CharacterProps) => {
  const groupRef = useRef<Group>(null);

  const { scene, animations } = useCharacterAssets();

  if (!scene) return null;

  return (
    <group ref={groupRef} position={position} scale={scale} visible={visible} dispose={null}>
      {scene && <primitive object={scene} />}
    </group>
  );
};
