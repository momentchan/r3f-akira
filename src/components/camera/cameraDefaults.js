import { getInitialCameraMode } from './cameraModes';

export const CAMERA_DEFAULTS = {
  mode: getInitialCameraMode(),

  // Look-at for FLOW spiral / close orbit (world space).
  target: [0.0, -0.12, 0.04],

  startAngle: 0.35,
  turns: 1,
  startRadius: 0.22,
  endRadius: 1.55,
  startHeight: 8.4,
  endHeight: 2.15,
  spiralSteps: 10,
  spiralDuration: 4.8,

  orbitSteps: 8,
  orbitDuration: 6.5,

  minDistance: 0.55,
  maxDistance: 15,
  maxPolarAngle: Math.PI / 2.08,
  exploreSmoothTime: 0.45,
};
