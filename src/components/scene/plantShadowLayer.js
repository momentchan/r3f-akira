import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * Plants live on layer 0 (seen by the camera and the main shadow map) *and* on
 * this layer. The plant-shadow light's shadow camera is restricted to this layer
 * alone, so its depth map contains plants but not the character — which is what
 * lets the character receive flower shadows without shadowing itself.
 *
 * Every plant mesh that should cast onto the character needs `enablePlantShadowLayer`
 * as its ref. Forgetting it fails silently (no shadow, no error), so prefer the
 * shared helper over an inline `layers.enable(1)`.
 */
export const PLANT_SHADOW_LAYER = 1;

/** Flower low-poly shadow proxies live here so the view camera (layer 0) skips them. */
export const FLOWER_SHADOW_CASTER_LAYER = 2;

/**
 * Stable ref callback — module scope on purpose. An inline arrow would be a new
 * identity every render, making React detach and re-attach the ref each time.
 */
export const enablePlantShadowLayer = (object) => {
  if (object) object.layers.enable(PLANT_SHADOW_LAYER);
};

/** Hidden from the view camera; still in the ground + character plant shadow maps. */
export const enableFlowerShadowCasterLayers = (object) => {
  if (!object) return;
  object.layers.disable(0);
  object.layers.enable(PLANT_SHADOW_LAYER);
  object.layers.enable(FLOWER_SHADOW_CASTER_LAYER);
};

/** Tags the light whose shadow map holds plants only. */
export const PLANT_SHADOW_LIGHT_FLAG = 'isPlantShadowLight';

/**
 * The plant-only shadow light, once it is in the scene. Materials read its
 * shadow map via TSL `shadow(light)`; see `createToonNodeMaterial`.
 */
export function usePlantShadowLight() {
  const scene = useThree((state) => state.scene);
  const [light, setLight] = useState(null);

  useEffect(() => {
    let found = null;
    scene.traverse((object) => {
      if (!found && object.userData?.[PLANT_SHADOW_LIGHT_FLAG]) found = object;
    });
    setLight(found);
  }, [scene]);

  return light;
}
