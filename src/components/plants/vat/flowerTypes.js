import { DAHLIA_MATERIAL_DEFAULTS } from './dahliaDefaults';
import { ROSE_MATERIAL_DEFAULTS } from './roseDefaults';
import { DAHLIA_META, ROSE_META } from '../field/paths';
import {
  FLOWER_MASK_PATH,
  ROSE_MASK_PATH,
} from '../look/flowerDefaults';

export const FLOWER_TYPES = [
  {
    id: 'dahlia',
    label: 'Dahlia',
    metaUrl: DAHLIA_META,
    materialDefaults: DAHLIA_MATERIAL_DEFAULTS,
    usePetalCutout: true,
    useMaskEdge: true,
    maskPath: FLOWER_MASK_PATH,
  },
  {
    id: 'rose',
    label: 'Rose',
    metaUrl: ROSE_META,
    materialDefaults: ROSE_MATERIAL_DEFAULTS,
    usePetalCutout: true,
    useMaskEdge: true,
    maskPath: ROSE_MASK_PATH,
  },
];
