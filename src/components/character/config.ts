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
  metalnessMap: 'textures/Body/Astronaut_Suit_Body_Metallic.ktx2',
  aoMap: 'textures/Body/Astronaut_Suit_Body_Ao.ktx2',
  normalMap: 'textures/Body/Astronaut_Suit_Body_Normals.ktx2',
};

export const DETAIL_TEXTURE_PATHS = {
  map: 'textures/Details/Astronaut_Suit_Details_Albedo.ktx2',
  dirtMap: 'textures/Details/Astronaut_Suit_Details_Dirt_Albedo.ktx2',
  metalnessMap: 'textures/Details/Astronaut_Suit_Details_Metallic.ktx2',
  aoMap: 'textures/Details/Astronaut_Suit_Details_Ao.ktx2',
  normalMap: 'textures/Details/Astronaut_Suit_Details_Normals.ktx2',
};

/** Mesh + embedded clips (Lay / Fetal / Drift). */
export const CHARACTER_MODEL_PATH = '/models/Astronaut.glb';

/** Standalone backpack prop (placed in App — not bone-attached). */
export const BACKPACK_MODEL_PATH = '/models/backpack.glb';

/** Still subject in the flower bed vs playable locomotion. */
export type CharacterMode = 'tableau' | 'locomotion';

/** Clip name from the character GLB, or `Bind` for rest pose with no animation. */
export type CharacterPose =
  | 'Bind'
  | 'Lay'
  | 'Fetal'
  | 'Drift'
  | (string & {});

export interface CharacterProps {
  position?: [number, number, number];
  /** Euler radians applied on the root group (tableau lay-down, etc.). */
  rotation?: [number, number, number];
  scale?: number;
  visible?: boolean;
  /** `tableau` = still subject (the live scene); `locomotion` = WASD. */
  mode?: CharacterMode;
  /** `Bind` = GLB initial pose (no clips). Clip names (Lay, Fetal, Drift) play that anim alone. */
  pose?: CharacterPose;
  /** Shared root with PlantField — Box3 locals are expressed in this space. */
  fieldParentRef?: RefObject<Object3D | null>;
  /** Receives measured bounds after Lay pose settles. */
  onBodyBounds?: (bounds: BodyBoundsPayload | null) => void;
}

export interface PhysicsState {
  speed: number;
  rotationVelocity: number; // Used for FPV smoothing

  // Animation weights
  idleWeight: number;
  walkWeight: number;
  runWeight: number;
  backWeight: number;

  // Config Parameters
  walkSpeed: number;
  runSpeed: number;
  backSpeed: number;
  rotateSpeed: number; // Base rotation speed

  // Smoothing Factors
  speedLerpFactor: number;
  rotationLerpFactor: number;
  animBlendLerpFactor: number;
}

export const INITIAL_PHYSICS_STATE: PhysicsState = {
  speed: 0,
  rotationVelocity: 0,
  idleWeight: 1.0,
  walkWeight: 0.0,
  runWeight: 0.0,
  backWeight: 0.0,
  walkSpeed: 1.0,
  runSpeed: 3.5,
  backSpeed: 0.6,
  rotateSpeed: 2.5,
  speedLerpFactor: 0.1,
  rotationLerpFactor: 0.15,
  animBlendLerpFactor: 0.15,
};
