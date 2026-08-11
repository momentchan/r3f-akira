export const CHARACTER_LOOK_DEFAULTS = {
  colorLevels: 2,
  thresholdLow: 0.28,
  thresholdHigh: 0.62,
  shadowTint: '#c3b2dd',
  highlightTint: '#ffffff',
  aoIntensity: 0,
  edgeColor: '#2a181c',
  outlineWidth: 0.001,
  lightDir: [0, 3, 5] as [number, number, number],
  /** Dirt albedo mix strength in contact bands. */
  dirtAmount: 0.78,
  /** Light posterize of dirt albedo (2 = harder blocks). */
  dirtLevels: 6,
  /** Soft contact: cut = where dirt starts; fade = soft edge width after cut. */
  dirtContactCut: 0,
  dirtContactFade: 0.15,
  /** Visualize aContactDirt as magenta heat overlay. */
  dirtDebug: false,
};

export function mergeCharacterLookDefaults(
  overrides: Partial<typeof CHARACTER_LOOK_DEFAULTS> = {},
  base = CHARACTER_LOOK_DEFAULTS,
) {
  return { ...base, ...overrides };
}
