import { DAHLIA_MATERIAL_DEFAULTS } from './dahliaDefaults';
import { JASMINE_MATERIAL_DEFAULTS } from './jasmineDefaults';
import { PLUMERA_MATERIAL_DEFAULTS } from './plumeraDefaults';
import { ROSE_MATERIAL_DEFAULTS } from './roseDefaults';
import {
  DAHLIA_META,
  JASMINE_META,
  PLUMERA_META,
  ROSE_META,
} from '../field/paths';
import {
  FLOWER_MASK_PATH,
  JASMINE_MASK_PATH,
  PLUMERA_MASK_PATH,
  ROSE_MASK_PATH,
} from '../look/flowerDefaults';

export const JASMINE_TYPE = {
  id: 'jasmine',
  label: 'Jasmine',
  metaUrl: JASMINE_META,
  materialDefaults: JASMINE_MATERIAL_DEFAULTS,
  partColorMode: 'allFlower',
  // Modeled petals need no alpha cutout; the UV mask adds only the ink contour.
  usePetalCutout: false,
  useMaskEdge: true,
  maskPath: JASMINE_MASK_PATH,
};

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
  JASMINE_TYPE,
  PLUMERA_TYPE,
];
