export const THEME = {
  light: 'light',
  dark: 'dark',
};

export const THEME_FADE = 0.5;

export const SCENE_THEMES = {
  light: {
    bgColor: '#ede4d3',
    // Apparent TIME ink: rgba(48,40,32,0.72) over cream — not opaque #302820.
    audioColor: '#655d52',
    silkTint: '#e9dcbf',
    silkTintStrength: 0.35,
  },
  dark: {
    bgColor: '#12100e',
    // Apparent TIME ink: rgba(237,228,211,0.82) over charcoal — not opaque cream.
    audioColor: '#c6beb0',
    silkTint: '#2a2620',
    silkTintStrength: 0.28,
  },
};

export const SCENE_DEFAULTS = {
  bgColor: SCENE_THEMES.light.bgColor,
};
