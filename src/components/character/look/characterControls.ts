import { folder } from 'leva';
import {
  CHARACTER_LOOK_DEFAULTS,
  mergeCharacterLookDefaults,
} from './characterDefaults';
import type {
  OutlineUniforms,
  WoodblockToonUniforms,
} from '../materials/createToonNodeMaterial';

export function createCharacterControlsSchema(
  defaults: Partial<typeof CHARACTER_LOOK_DEFAULTS> = {},
) {
  const d = mergeCharacterLookDefaults(defaults);

  return {
    colorLevels: { value: d.colorLevels, min: 2, max: 6, step: 1 },
    thresholdLow: { value: d.thresholdLow, min: 0, max: 1, step: 0.01 },
    thresholdHigh: { value: d.thresholdHigh, min: 0, max: 1, step: 0.01 },
    Rim: folder({
      rimStrength: { value: d.rimStrength, min: 0, max: 0.5, step: 0.005 },
      rimThreshold: { value: d.rimThreshold, min: 0, max: 1, step: 0.01 },
      rimPower: { value: d.rimPower, min: 0.5, max: 8, step: 0.1 },
    }),
    shadowTint: { value: d.shadowTint },
    highlightTint: { value: d.highlightTint },
    aoIntensity: { value: d.aoIntensity, min: 0, max: 1, step: 0.01 },
    Outline: folder({
      edgeColor: { value: d.edgeColor },
      outlineWidth: {
        value: d.outlineWidth,
        min: 0,
        max: 0.05,
        step: 0.001,
        label: 'contour width',
      },
    }),
  };
}

export function syncCharacterControls(
  controls: Record<string, any>,
  lookUniformsList: WoodblockToonUniforms[],
  outlineUniforms?: OutlineUniforms,
) {
  for (const uniforms of lookUniformsList) {
    uniforms.colorLevels.value = controls.colorLevels;
    uniforms.thresholdLow.value = controls.thresholdLow;
    uniforms.thresholdHigh.value = controls.thresholdHigh;
    uniforms.rimStrength.value = controls.rimStrength;
    uniforms.rimThreshold.value = controls.rimThreshold;
    uniforms.rimPower.value = controls.rimPower;
    uniforms.shadowTint.value.set(controls.shadowTint);
    uniforms.highlightTint.value.set(controls.highlightTint);
    uniforms.aoIntensity.value = controls.aoIntensity;
  }

  if (outlineUniforms) {
    outlineUniforms.edgeColor.value.set(controls.edgeColor);
    outlineUniforms.outlineWidth.value = controls.outlineWidth;
  }
}
