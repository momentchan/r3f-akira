import type { RefObject } from 'react';
import type { Object3D } from 'three';
import type { BodyBoundsPayload } from './hooks/useCharacterBodyBounds';

export const BODY_MESH_NAMES: readonly string[] = [
  'Astronaut_Suit_Body_Detail_01_Mesh',
  'Astronaut_Suit_Body_Mesh',
  'Astronaut_Suit_Shoes_Mesh',
];

export const BODY_TEXTURE_PATHS = {
  map: 'textures/Body/Astronaut_Suit_Body_Albedo.ktx2',
  dirtMap: 'textures/Body/Astronaut_Suit_Body_Dirt_Albedo.ktx2',
};

export const DETAIL_TEXTURE_PATHS = {
  map: 'textures/Details/Astronaut_Suit_Details_Albedo.ktx2',
  dirtMap: 'textures/Details/Astronaut_Suit_Details_Dirt_Albedo.ktx2',
};

export const CHARACTER_MODEL_PATH = '/models/Astronaut.glb';

export const BACKPACK_MODEL_PATH = '/models/backpack.glb';

export interface CharacterProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  visible?: boolean;
  /** Shared root with PlantField — Box3 locals are expressed in this space. */
  fieldParentRef?: RefObject<Object3D | null>;
  /** Receives measured bounds after Lay clip settles. */
  onBounds?: (bounds: BodyBoundsPayload | null) => void;
}
