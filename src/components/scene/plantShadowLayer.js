import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';

/** Extra layer so the plant-shadow light sees plants, not the character. */
export const PLANT_SHADOW_LAYER = 1;

/** Low-poly flower casters; hidden from the view camera (layer 0). */
export const FLOWER_SHADOW_CASTER_LAYER = 2;

// Module-scope ref: an inline callback would remount the mesh every render.
export const enablePlantShadowLayer = (object) => {
  if (object) object.layers.enable(PLANT_SHADOW_LAYER);
};

/** Off layer 0; still in plant shadow maps. */
export const enableFlowerShadowCasterLayers = (object) => {
  if (!object) return;
  object.layers.disable(0);
  object.layers.enable(PLANT_SHADOW_LAYER);
  object.layers.enable(FLOWER_SHADOW_CASTER_LAYER);
};

export const PLANT_SHADOW_LIGHT_FLAG = 'isPlantShadowLight';

/** Scene light tagged for character toon `shadow(light)`. */
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

/**
 * Wait until the plant light has a shadow map, then patch toon materials.
 * TSL `shadow(light)` compiles a null uniform if the map is still missing.
 */
export function useBindPlantShadow(light, ...materials) {
  useEffect(() => {
    const mats = materials.filter(Boolean);
    if (!light || mats.length === 0) return undefined;
    let cancelled = false;
    const tryBind = () => {
      if (cancelled) return;
      if (!light.shadow?.map) {
        requestAnimationFrame(tryBind);
        return;
      }
      for (const mat of mats) mat.userData.patchShadow?.(light);
    };
    tryBind();
    return () => {
      cancelled = true;
    };
  }, [light, ...materials]);
}
