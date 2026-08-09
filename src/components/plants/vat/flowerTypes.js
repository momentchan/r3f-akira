import { DAHLIA_MATERIAL_DEFAULTS } from './dahliaDefaults';
import { ROSE_MATERIAL_DEFAULTS } from './roseDefaults';
import { DAHLIA_META, ROSE_META } from '../field/paths';

export const FLOWER_TYPES = [
  {
    id: 'dahlia',
    label: 'Dahlia',
    metaUrl: DAHLIA_META,
    materialDefaults: DAHLIA_MATERIAL_DEFAULTS,
    usePetalMask: true,
  },
  {
    id: 'rose',
    label: 'Rose',
    metaUrl: ROSE_META,
    materialDefaults: ROSE_MATERIAL_DEFAULTS,
    // Solid VAT mesh — silhouette is in the geometry, not a 2D cutout mask.
    usePetalMask: false,
  },
];
