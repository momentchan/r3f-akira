export const FLOWER_CULL_DEFAULTS = {
  enabled: true,
  tintDrawn: false,
  lodDistance: 2.2,
  /** Clip-space pad on the frustum (same as false-earth Rose). */
  cullPadding: 3,
  freezeTips: false,
  forceAllLow: false,
  flowerCastShadows: true,
  lowShadowCasters: true,
  hideStems: false,
  hideLeaves: false,
  freezeMigrate: false,
};

/** GPU tint colors when "tint drawn" is on — hi vs low-poly LOD bands. */
export const FLOWER_LOD_DEBUG_COLORS = {
  hi: [0.2, 1.0, 0.45],
  lo: [1.0, 0.55, 0.08],
};
