export const CHARACTER_LOOK_DEFAULTS = {
  colorLevels: 2,
  thresholdLow: 0.28,
  thresholdHigh: 0.62,
  shadowTint: '#c3b2dd',
  highlightTint: '#ffffff',
  edgeColor: '#2a181c',
  outlineWidth: 0.001,
  lightDir: [0, 3, 5] as [number, number, number],
  dirtAmount: 0.78,
  dirtLevels: 6,
  /** cut = dirt start height; fade = soft width after cut. */
  dirtContactCut: 0,
  dirtContactFade: 0.15,
  dirtDebug: false,
  /** Receive plant shadows; never self-shadow. */
  castShadowEnabled: true,
};

export function mergeCharacterLookDefaults(
  overrides: Partial<typeof CHARACTER_LOOK_DEFAULTS> = {},
  base = CHARACTER_LOOK_DEFAULTS,
) {
  return { ...base, ...overrides };
}
