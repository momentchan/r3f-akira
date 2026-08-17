import { useControls } from 'leva';
import { GROUND_MEADOW_DEFAULTS } from './groundMeadowDefaults';

export function useGroundMeadowControls() {
  const d = GROUND_MEADOW_DEFAULTS;
  return useControls('Ground Meadow', {
    enabled: { value: d.enabled, label: 'Enabled' },
    areaX: { value: d.areaX, min: 1, max: 8, step: 0.1, label: 'Area Width' },
    areaZ: { value: d.areaZ, min: 1, max: 8, step: 0.1, label: 'Area Depth' },
    patchScale: {
      value: d.patchScale,
      min: 0.15,
      max: 3,
      step: 0.01,
      label: 'Color Patch Scale',
    },
    bladeCount: {
      value: d.bladeCount,
      min: 0,
      max: 40000,
      step: 500,
      label: 'Blade Count',
    },
    grassHeight: {
      value: d.grassHeight,
      min: 0.25,
      max: 2,
      step: 0.05,
      label: 'Grass Height',
    },
    bladeSegments: {
      value: d.bladeSegments,
      min: 3,
      max: 12,
      step: 1,
      label: 'Blade Segments',
    },
    grassColorA: { value: d.grassColorA, label: 'Grass Color A' },
    grassColorB: { value: d.grassColorB, label: 'Grass Color B' },
  }, { collapsed: false });
}
