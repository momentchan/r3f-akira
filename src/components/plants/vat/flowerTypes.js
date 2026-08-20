import { DAHLIA_MATERIAL_DEFAULTS } from './dahliaDefaults';
import { PLUMERA_MATERIAL_DEFAULTS } from './plumeraDefaults';
import { ROSE_MATERIAL_DEFAULTS } from './roseDefaults';
import {
  DAHLIA_LOD_META,
  DAHLIA_META,
  PLUMERA_META,
  ROSE_LOD_META,
  ROSE_META,
} from '../field/paths';
import {
  FLOWER_MASK_PATH,
  PLUMERA_MASK_PATH,
  ROSE_MASK_PATH,
} from '../look/flowerDefaults';

/** Climb-only. Imported directly by ClimbTendrils, not via FLOWER_TYPES. */
export const PLUMERA_TYPE = {
  id: 'plumera',
  label: 'Plumera',
  metaUrl: PLUMERA_META,
  materialDefaults: PLUMERA_MATERIAL_DEFAULTS,
  partColorMode: 'allFlower',
  usePetalCutout: false,
  useMaskEdge: true,
  maskPath: PLUMERA_MASK_PATH,
};

export const FLOWER_TYPES = [
  {
    id: 'dahlia',
    label: 'Dahlia',
    metaUrl: DAHLIA_META,
    lodMetaUrl: DAHLIA_LOD_META,
    materialDefaults: DAHLIA_MATERIAL_DEFAULTS,
    usePetalCutout: true,
    useMaskEdge: true,
    maskPath: FLOWER_MASK_PATH,
  },
  {
    id: 'rose',
    label: 'Rose',
    metaUrl: ROSE_META,
    lodMetaUrl: ROSE_LOD_META,
    materialDefaults: ROSE_MATERIAL_DEFAULTS,
    usePetalCutout: true,
    useMaskEdge: true,
    maskPath: ROSE_MASK_PATH,
  },
];
