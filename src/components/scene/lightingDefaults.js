export const LIGHTING_DEFAULTS = {
  rotationSpeed: 0,
  color: '#ffffff',
  intensity: 2.0,
  debug: false,
  shadowBias: -0.0005,
  shadowRadius: 6,
  /** Ground shadow map — read by ShadowCatcher, spans the whole field. */
  shadowMapSize: 2048,
  /**
   * Plant-only shadow map — read solely by the character's toon material, so it
   * can be cheaper than the ground map. Halving it quarters the depth pass;
   * `shadowRadius` blurs in texels, so a smaller map widens the shadow's soft
   * edge in world units unless the radius comes down with it.
   */
  plantShadowMapSize: 2048,
};
