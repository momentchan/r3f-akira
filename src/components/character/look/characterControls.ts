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
    Dirt: folder({
      dirtAmount: {
        value: d.dirtAmount,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'dirt amount',
      },
      dirtLevels: {
        value: d.dirtLevels ?? 3,
        min: 2,
        max: 10,
        step: 1,
        label: 'tone levels',
      },
      dirtContactCut: {
        value: d.dirtContactCut ?? 0.12,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'contact cut',
      },
      dirtContactFade: {
        value: d.dirtContactFade ?? 0.48,
        min: 0.01,
        max: 1,
        step: 0.01,
        label: 'contact fade',
      },
      dirtDebug: {
        value: Boolean(d.dirtDebug),
        label: 'show contact mask',
      },
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
    uniforms.shadowTint.value.set(controls.shadowTint);
    uniforms.highlightTint.value.set(controls.highlightTint);
    uniforms.aoIntensity.value = controls.aoIntensity;
    if (uniforms.dirtAmount) uniforms.dirtAmount.value = controls.dirtAmount;
    if (uniforms.dirtLevels) uniforms.dirtLevels.value = controls.dirtLevels;
    if (uniforms.dirtContactCut) uniforms.dirtContactCut.value = controls.dirtContactCut;
    if (uniforms.dirtContactFade) uniforms.dirtContactFade.value = controls.dirtContactFade;
    if (uniforms.dirtDebug) {
      uniforms.dirtDebug.value = controls.dirtDebug ? 1 : 0;
    }
  }

  if (outlineUniforms) {
    outlineUniforms.edgeColor.value.set(controls.edgeColor);
    outlineUniforms.outlineWidth.value = controls.outlineWidth;
  }
}
