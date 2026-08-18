import { button, folder } from 'leva';
import { CAMERA_DEFAULTS } from './cameraDefaults';

export function createCameraControlsSchema(
  defaults = CAMERA_DEFAULTS,
  { onLogLookAt, onRestartFlow } = {},
) {
  const d = defaults;
  return {
    Flow: folder({
      target: { value: d.target, label: 'Target' },
      startAngle: {
        value: d.startAngle,
        min: -Math.PI,
        max: Math.PI,
        step: 0.01,
        label: 'Start Angle',
      },
      overheadHeight: {
        value: d.overheadHeight,
        min: 3,
        max: 20,
        step: 0.05,
        label: 'Overhead Height',
      },
      overheadRadius: {
        value: d.overheadRadius,
        min: 0.15,
        max: 2,
        step: 0.01,
        label: 'Overhead Radius',
      },
      radius: {
        value: d.radius,
        min: d.radiusMin,
        max: d.radiusMax,
        step: 0.01,
      },
      radiusAmp: { value: d.radiusAmp, min: 0, max: 1.2, step: 0.01 },
      radiusCycles: { value: d.radiusCycles, min: 0.2, max: 4, step: 0.05 },
      height: { value: d.height, min: 0.4, max: 10, step: 0.05 },
      heightAmp: { value: d.heightAmp, min: 0, max: 2, step: 0.01 },
      heightCycles: { value: d.heightCycles, min: 0.2, max: 4, step: 0.05 },
      orbitSpeed: {
        value: d.orbitSpeed, min: 0.01, max: 0.3, step: 0.001,
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
