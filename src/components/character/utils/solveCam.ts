import * as THREE from 'three/webgpu';
import { Group, Camera, Euler } from 'three';
import { PhysicsState } from '../config';
import { input } from '../input/controls';

const getShortestAngleDifference = (from: number, to: number) => {
  const delta = to - from;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
};

const tempEuler = new Euler(0, 0, 0, 'YXZ');

/**
 * Camera-relative movement: WASD as direction relative to the camera.
 * Character always walks forward along facing; facing chases input angle.
 */
export const solveCam = (
  group: Group,
  camera: Camera,
  s: PhysicsState,
  delta: number,
) => {
  const moveForward = input.isPressed('MoveForward');
  const moveBackward = input.isPressed('MoveBackward');
  const rotateLeft = input.isPressed('RotateLeft');
  const rotateRight = input.isPressed('RotateRight');
  const run = input.isPressed('Run');
  const joyX = input.getAxis('horizontal');
  const joyY = input.getAxis('vertical');

  let ix = 0;
  let iy = 0;

  if (Math.abs(joyX) > 0.01 || Math.abs(joyY) > 0.01) {
    ix = joyX;
    iy = joyY;
  } else {
    if (rotateLeft) ix -= 1;
    if (rotateRight) ix += 1;
    if (moveForward) iy += 1;
    if (moveBackward) iy -= 1;
  }

  const inputLen = Math.sqrt(ix * ix + iy * iy);
  let targetSpeed = 0;

  if (inputLen > 0.1) {
    const inputAngle = Math.atan2(ix, -iy);

    tempEuler.setFromQuaternion(camera.quaternion);
    const camAngle = tempEuler.y;
    const targetRotation = camAngle + inputAngle;

    const currentRotation = group.rotation.y;
    const diff = getShortestAngleDifference(currentRotation, targetRotation);

    const tpvRotateMultiplier = 3.0;
    group.rotation.y += diff * delta * tpvRotateMultiplier;

    const maxSpeed = run ? s.runSpeed : s.walkSpeed;
    targetSpeed = maxSpeed * Math.min(inputLen, 1.0);
  }

  s.speed = THREE.MathUtils.lerp(s.speed, targetSpeed, s.speedLerpFactor);

  if (Math.abs(s.speed) > 0.01) {
    group.translateZ(s.speed * delta);
  }

  s.rotationVelocity = 0;
};
