import { useControls } from 'leva';
import { FLOWER_CULL_DEFAULTS } from './flowerCullDefaults';

export function useFlowerCullControls() {
  const d = FLOWER_CULL_DEFAULTS;
  return useControls('Flower Cull / LOD', {
    enabled: { value: d.enabled, label: 'GPU cull' },
    tintDrawn: { value: d.tintDrawn, label: 'tint drawn (LOD colors)' },
    lodDistance: {
      value: d.lodDistance,
      min: 0,
      max: 10,
      step: 0.1,
      label: 'LOD distance',
    },
    freezeTips: { value: d.freezeTips, label: 'freeze tips' },
    forceAllLow: { value: d.forceAllLow, label: 'force all low' },
    flowerCastShadows: { value: d.flowerCastShadows, label: 'flower head shadows' },
    lowShadowCasters: { value: d.lowShadowCasters, label: 'low-poly shadow casters' },
    hideStems: { value: d.hideStems, label: 'hide stems' },
    hideLeaves: { value: d.hideLeaves, label: 'hide leaves' },
    freezeMigrate: { value: d.freezeMigrate, label: 'freeze migrate' },
  }, { collapsed: false });
}
