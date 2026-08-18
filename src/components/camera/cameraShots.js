/**
 * Authored camera compositions for Still.
 *
 * Positions and targets are in world space (field group is at y = -1).
 * transitionDuration: CameraControls.smoothTime while moving (seconds).
 */

import { CAMERA_DEFAULTS } from './cameraDefaults';

export function pointOnOrbit(angle, radius, height, target) {
  return [
    target[0] + Math.sin(angle) * radius,
    target[1] + height,
    target[2] + Math.cos(angle) * radius,
  ];
}

export function flowStartPose(params = CAMERA_DEFAULTS) {
  const target = params.target;
  return {
    position: pointOnOrbit(params.startAngle, params.radius, params.height, target),
    target,
  };
}

export const FLOW_START = flowStartPose();

export const FRAME_SHOTS = [
  {
    id: '01-wide-body',
    position: [1.55, 1.45, 2.35],
    target: [0.0, 0.1, 0.0],
    fov: 45,
    transitionDuration: 2.4,
  },
  {
    id: '02-helmet',
    position: [0.28, 0.78, 0.72],
    target: [0.0, 0.4, 0.1],
    fov: 38,
    transitionDuration: 2.2,
  },
  {
    id: '03-backpack',
    position: [-0.9, 0.7, 0.35],
    target: [-1.75, -0.5, -0.5],
    fov: 40,
    transitionDuration: 2.2,
  },
  {
    id: '04-flowers',
    position: [0.7, 0.38, 1.05],
    target: [0.15, -0.2, 0.05],
    fov: 42,
    transitionDuration: 2.4,
  },
  {
    id: '05-landscape',
    position: [2.6, 0.28, 2.1],
    target: [-0.4, -0.25, -0.6],
    fov: 50,
    transitionDuration: 2.8,
  },
];
