import { useControls } from 'leva';
import { FLOWER_CULL_DEFAULTS } from './flowerCullDefaults';

export function useFlowerCullControls() {
  const d = FLOWER_CULL_DEFAULTS;
  return useControls('Flower Cull / LOD', {
    enabled: { value: d.enabled, label: 'GPU cull' },
    tintDrawn: { value: d.tintDrawn, label: 'tint drawn (LOD colors)' },
    lodDistance: {
      value: d.lodDistance,
      min: 2,
      max: 30,
      step: 0.5,
      label: 'LOD distance',
    },
  }, { collapsed: false });
}
