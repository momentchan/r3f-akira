/**
 * FLOW orbit geometry for Still.
 *
 * Positions and targets are in world space (field group is at y = -1).
 */

import { CAMERA_DEFAULTS } from './cameraDefaults';

export function pointOnOrbit(angle, radius, height, target) {
  return [
    target[0] + Math.sin(angle) * radius,
    target[1] + height,
    target[2] + Math.cos(angle) * radius,
  ];
}

function flowOverheadPose(params = CAMERA_DEFAULTS) {
  const target = params.target;
  return {
    position: pointOnOrbit(
      params.startAngle,
      params.overheadRadius,
      params.overheadHeight,
      target,
    ),
    target,
  };
}

export const FLOW_OVERHEAD = flowOverheadPose();

