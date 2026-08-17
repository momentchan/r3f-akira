/**
 * Authored camera compositions for Still.
 *
 * Positions and targets are in world space (field group is at y = -1).
 * duration / transitionDuration: CameraControls.smoothTime while moving (seconds).
 * holdDuration: pause after rest (seconds). FLOW only.
 */

import { CAMERA_DEFAULTS } from './cameraDefaults';

function pointOnOrbit(angle, radius, height, target) {
  return [
    target[0] + Math.sin(angle) * radius,
    target[1] + height,
    target[2] + Math.cos(angle) * radius,
  ];
}

function buildSpiralShots({
  target,
  startAngle,
  turns,
  startRadius,
  endRadius,
  startHeight,
  endHeight,
  steps,
  duration,
}) {
  const shots = [];
  const count = Math.max(1, Math.round(steps));
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const eased = t * t * (3 - 2 * t);
    const angle = startAngle + turns * Math.PI * 2 * eased;
    const radius = startRadius + (endRadius - startRadius) * eased;
    const height = startHeight + (endHeight - startHeight) * eased;
    shots.push({
      id: `spiral-${i}`,
      position: pointOnOrbit(angle, radius, height, target),
      target,
      duration,
      holdDuration: 0,
    });
  }
  return shots;
}

function buildOrbitShots({
  target,
  startAngle,
  radius,
  height,
  steps,
  duration,
}) {
  const shots = [];
  const count = Math.max(1, Math.round(steps));
  for (let i = 1; i <= count; i += 1) {
    const angle = startAngle + (i / count) * Math.PI * 2;
    shots.push({
      id: `orbit-${i}`,
      position: pointOnOrbit(angle, radius, height, target),
      target,
      duration,
      holdDuration: 0,
    });
  }
  return shots;
}

export function buildFlowPath(params = CAMERA_DEFAULTS) {
  const target = params.target ?? CAMERA_DEFAULTS.target;
  const spiral = buildSpiralShots({
    target,
    startAngle: params.startAngle,
    turns: params.turns,
    startRadius: params.startRadius,
    endRadius: params.endRadius,
    startHeight: params.startHeight,
    endHeight: params.endHeight,
    steps: params.spiralSteps,
    duration: params.spiralDuration,
  });
  const orbit = buildOrbitShots({
    target,
    startAngle: params.startAngle + params.turns * Math.PI * 2,
    radius: params.endRadius,
    height: params.endHeight,
    steps: params.orbitSteps,
    duration: params.orbitDuration,
  });
  return {
    shots: [...spiral, ...orbit],
    loopFrom: spiral.length,
    start: spiral[0],
  };
}

const INITIAL_FLOW = buildFlowPath(CAMERA_DEFAULTS);

export const FLOW_SHOTS = INITIAL_FLOW.shots;
export const FLOW_LOOP_FROM = INITIAL_FLOW.loopFrom;
export const FLOW_START = INITIAL_FLOW.start;

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
