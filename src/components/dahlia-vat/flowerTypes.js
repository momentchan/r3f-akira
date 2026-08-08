import { DahliaVAT } from './DahliaVAT';
import { RoseVAT } from './RoseVAT';
import { DAHLIA_MATERIAL_DEFAULTS } from './dahliaDefaults';
import { ROSE_MATERIAL_DEFAULTS } from './roseDefaults';
import { FLOWER_META, ROSE_META } from './config';

// Registry of VAT tip flowers. Add an entry here to intermix a new species:
//   id / label     — Leva panel name + seeded pick key
//   metaUrl        — VAT meta JSON (also used for preload)
//   Component      — thin VatFlower wrapper (assets / extract options)
//   materialDefaults — starting look for that type's Leva panel
export const FLOWER_TYPES = [
  {
    id: 'dahlia',
    label: 'Dahlia',
    metaUrl: FLOWER_META,
    Component: DahliaVAT,
    materialDefaults: DAHLIA_MATERIAL_DEFAULTS,
  },
  {
    id: 'rose',
    label: 'Rose',
    metaUrl: ROSE_META,
    Component: RoseVAT,
    materialDefaults: ROSE_MATERIAL_DEFAULTS,
  },
];
