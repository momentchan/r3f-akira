import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import type { AnimationAction, Group } from 'three';

import { INITIAL_PHYSICS_STATE, type PhysicsState } from '../config';
import { input } from '../input/controls';
import { calculateBlendWeights } from '../utils/calculateBlendWeights';
import { solveCam } from '../utils/solveCam';
import { solveTank } from '../utils/solveTank';

export type ControlMode = 'camera' | 'tank';

export function useCharacterPhysics(
  groupRef: MutableRefObject<Group | null>,
  actions: Record<string, AnimationAction | null | undefined> | null | undefined,
  controlMode: ControlMode = 'camera',
  enabled = true,
) {
  const { camera } = useThree();

  const state = useRef<PhysicsState>({ ...INITIAL_PHYSICS_STATE });
  const modeRef = useRef(controlMode);
  modeRef.current = controlMode;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled || !actions) return;
    (['Idle', 'Walk', 'Run', 'Back'] as const).forEach((name) => {
      const action = actions[name];
      if (action) {
        action.reset().play();
        action.setEffectiveWeight(name === 'Idle' ? 1.0 : 0.0);
      }
    });
  }, [actions, enabled]);

  useFrame((_, delta) => {
    if (!enabledRef.current || !groupRef.current || !actions) return;

    const s = state.current;
    const mode = modeRef.current;

    if (mode === 'tank') {
      solveTank(groupRef.current, s, delta);
    } else {
      solveCam(groupRef.current, camera, s, delta);
    }

    const rotateLeft =
      input.isPressed('RotateLeft') || input.getAxis('horizontal') < -0.1;
    const rotateRight =
      input.isPressed('RotateRight') || input.getAxis('horizontal') > 0.1;
    const isRotating = mode === 'tank' && (rotateLeft || rotateRight);

    const targetWeights = calculateBlendWeights(
      s.speed,
      isRotating,
      s.walkSpeed,
      s.runSpeed,
      s.backSpeed,
    );

    s.idleWeight = THREE.MathUtils.lerp(
      s.idleWeight,
      targetWeights.idle,
      s.animBlendLerpFactor,
    );
    s.walkWeight = THREE.MathUtils.lerp(
      s.walkWeight,
      targetWeights.walk,
      s.animBlendLerpFactor,
    );
    s.runWeight = THREE.MathUtils.lerp(
      s.runWeight,
      targetWeights.run,
      s.animBlendLerpFactor,
    );
    s.backWeight = THREE.MathUtils.lerp(
      s.backWeight,
      targetWeights.back,
      s.animBlendLerpFactor,
    );

    actions.Idle?.setEffectiveWeight(s.idleWeight);
    actions.Walk?.setEffectiveWeight(s.walkWeight);
    actions.Run?.setEffectiveWeight(s.runWeight);
    actions.Back?.setEffectiveWeight(s.backWeight);
  });
}
