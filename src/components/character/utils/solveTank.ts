import * as THREE from 'three/webgpu';
import { Group } from 'three';
import { PhysicsState } from '../config';
import { input } from '../input/controls';

/**
 * Tank controls: W/S move forward/back, A/D rotate in place.
 */
export const solveTank = (group: Group, s: PhysicsState, delta: number) => {
  const moveForward = input.isPressed('MoveForward');
  const moveBackward = input.isPressed('MoveBackward');
  const rotateLeft = input.isPressed('RotateLeft');
  const rotateRight = input.isPressed('RotateRight');
  const run = input.isPressed('Run');

  let targetRotationVelocity = 0;
  if (rotateLeft) {
    targetRotationVelocity = s.rotateSpeed;
  } else if (rotateRight) {
    targetRotationVelocity = -s.rotateSpeed;
  }

  s.rotationVelocity = THREE.MathUtils.lerp(
    s.rotationVelocity,
    targetRotationVelocity,
    s.rotationLerpFactor,
  );

  if (Math.abs(s.rotationVelocity) > 0.001) {
    group.rotation.y += s.rotationVelocity * delta;
  }

  let targetSpeed = 0;
  if (moveForward) {
    targetSpeed = run ? s.runSpeed : s.walkSpeed;
  } else if (moveBackward) {
    targetSpeed = -s.backSpeed;
  }

  s.speed = THREE.MathUtils.lerp(s.speed, targetSpeed, s.speedLerpFactor);

  if (Math.abs(s.speed) > 0.01) {
    group.translateZ(s.speed * delta);
  }
};
