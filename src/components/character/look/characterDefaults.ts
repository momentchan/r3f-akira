export const CHARACTER_LOOK_DEFAULTS = {
  colorLevels: 2,
  thresholdLow: 0.28,
  thresholdHigh: 0.62,
  rimStrength: 0.06,
  rimThreshold: 0.78,
  rimPower: 2.2,
  shadowTint: '#c3b2dd',
  highlightTint: '#ffffff',
  aoIntensity: 0,
  edgeColor: '#2a181c',
  outlineWidth: 0.001,
  lightDir: [0, 3, 5] as [number, number, number],
  /** 0 = clean only, 1 = full dirt albedo. */
  dirtAmount: 0.32,
  /** 0 = flat mix, 1 = dirt only where darker than clean (wear-focused). */
  dirtFocus: 0.7,
};

export function mergeCharacterLookDefaults(
  overrides: Partial<typeof CHARACTER_LOOK_DEFAULTS> = {},
  base = CHARACTER_LOOK_DEFAULTS,
) {
  return { ...base, ...overrides };
}
