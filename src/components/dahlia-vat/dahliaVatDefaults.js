export const DAHLIA_VAT_META_PATH = '/Dahlia_Full/Dahlia_Full_meta.json';

export const DAHLIA_VAT_DEFAULTS = {
  speed: 0.35,
  frame: 0.35,
  useTime: false,
  scale: 1,
  stemYMax: 0.05,
};

export function createDahliaVatControlsSchema() {
  const defaults = DAHLIA_VAT_DEFAULTS;

  return {
    speed: { value: defaults.speed, min: 0, max: 2, step: 0.01 },
    frame: { value: defaults.frame, min: 0, max: 1, step: 0.001 },
    useTime: { value: defaults.useTime, label: 'animate' },
    scale: { value: defaults.scale, min: 0.01, max: 4, step: 0.01 },
    stemYMax: {
      value: defaults.stemYMax,
      min: -0.5,
      max: 0.5,
      step: 0.01,
      label: 'stem Y max',
    },
  };
}
