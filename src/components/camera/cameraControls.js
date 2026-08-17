import { button, folder } from 'leva';
import { CAMERA_MODE, CAMERA_MODE_LABELS } from './cameraModes';
import { CAMERA_DEFAULTS } from './cameraDefaults';
import { FRAME_SHOTS } from './cameraShots';

const MODE_OPTIONS = {
  [CAMERA_MODE_LABELS[CAMERA_MODE.Flow]]: CAMERA_MODE.Flow,
  [CAMERA_MODE_LABELS[CAMERA_MODE.Explore]]: CAMERA_MODE.Explore,
  [CAMERA_MODE_LABELS[CAMERA_MODE.Frames]]: CAMERA_MODE.Frames,
};

export function createCameraControlsSchema(
  defaults = CAMERA_DEFAULTS,
  { onLogLookAt, onRestartFlow, onModeChange, onFrameChange } = {},
) {
  const d = defaults;
  return {
    mode: {
      value: d.mode,
      options: MODE_OPTIONS,
      label: 'Mode',
      onChange: (value, _path, context) => {
        if (!context?.fromPanel) return;
        onModeChange?.(value);
      },
    },
    frame: {
      value: 0,
      min: 0,
      max: Math.max(0, FRAME_SHOTS.length - 1),
      step: 1,
      label: 'Frame',
      onChange: (value, _path, context) => {
        if (!context?.fromPanel) return;
        onFrameChange?.(value);
      },
    },

    Flow: folder({
      target: { value: d.target, label: 'Target' },
      startAngle: {
        value: d.startAngle,
        min: 0,
        max: Math.PI * 2,
        step: 0.01,
        label: 'Start Angle',
      },
      turns: { value: d.turns, min: 0.1, max: 3, step: 0.05, label: 'Turns' },
      startRadius: {
        value: d.startRadius,
        min: 0,
        max: 4,
        step: 0.01,
        label: 'Start Radius',
      },
      endRadius: {
        value: d.endRadius,
        min: 0.1,
        max: 6,
        step: 0.01,
        label: 'End Radius',
      },
      startHeight: {
        value: d.startHeight,
        min: 0.5,
        max: 16,
        step: 0.05,
        label: 'Start Height',
      },
      endHeight: {
        value: d.endHeight,
        min: 0.2,
        max: 10,
        step: 0.05,
        label: 'End Height',
      },
      spiralSteps: {
        value: d.spiralSteps,
        min: 3,
        max: 24,
        step: 1,
        label: 'Spiral Steps',
      },
      spiralDuration: {
        value: d.spiralDuration,
        min: 0.5,
        max: 16,
        step: 0.1,
        label: 'Spiral Step Time',
      },
      orbitSteps: {
        value: d.orbitSteps,
        min: 3,
        max: 24,
        step: 1,
        label: 'Orbit Steps',
      },
      orbitDuration: {
        value: d.orbitDuration,
        min: 0.5,
        max: 16,
        step: 0.1,
        label: 'Orbit Step Time',
      },
      restartFlow: button(() => onRestartFlow?.()),
    }),

    Explore: folder({
      minDistance: {
        value: d.minDistance,
        min: 0.2,
        max: 4,
        step: 0.05,
        label: 'Min Distance',
      },
      maxDistance: {
        value: d.maxDistance,
        min: 1,
        max: 20,
        step: 0.1,
        label: 'Max Distance',
      },
      maxPolarAngle: {
        value: d.maxPolarAngle,
        min: 0.2,
        max: Math.PI,
        step: 0.01,
        label: 'Max Polar',
      },
      exploreSmoothTime: {
        value: d.exploreSmoothTime,
        min: 0.05,
        max: 2,
        step: 0.01,
        label: 'Smooth Time',
      },
    }),

    logLookAt: button(() => onLogLookAt?.()),
  };
}
