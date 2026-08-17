import { useControls } from 'leva';
import { PLANT_WIND_DEFAULTS } from './plantWind';

export function usePlantWindControls() {
  const d = PLANT_WIND_DEFAULTS;
  return useControls('Plant Wind', {
    enabled: { value: d.enabled, label: 'Enabled' },
    windStrength: {
      value: d.windStrength,
      min: 0,
      max: 0.15,
      step: 0.001,
      label: 'Strength',
    },
    windAngle: {
      value: d.windAngle,
      min: 0,
      max: 360,
      step: 1,
      label: 'Direction (deg)',
    },
    windScale: {
      value: d.windScale,
      min: 0.1,
      max: 6,
      step: 0.1,
      label: 'Wave Scale',
    },
    windSpeed: {
      value: d.windSpeed,
      min: 0,
      max: 4,
      step: 0.05,
      label: 'Speed',
    },
    colorShift: {
      value: d.colorShift,
      min: 0,
      max: 0.5,
      step: 0.01,
      label: 'Wind Color Shift',
    },
  }, { collapsed: false });
}
