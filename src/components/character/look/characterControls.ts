import { folder } from 'leva';
import {
  CHARACTER_LOOK_DEFAULTS,
  mergeCharacterLookDefaults,
} from './characterDefaults';
import type {
  OutlineUniforms,
  UniformValue,
  ToonUniforms,
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
        value: d.dirtLevels,
        min: 2,
        max: 10,
        step: 1,
        label: 'tone levels',
      },
      dirtContactCut: {
        value: d.dirtContactCut,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'contact cut',
      },
      dirtContactFade: {
        value: d.dirtContactFade,
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
    castShadowEnabled: { value: d.castShadowEnabled, label: 'receive cast shadow' },
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

function setFloat(uniform: UniformValue<number> | undefined, value: unknown) {
  if (!uniform || typeof value !== 'number' || !Number.isFinite(value)) return;
  uniform.value = value;
}

export function syncCharacterControls(
  controls: Record<string, any>,
  lookUniformsList: ToonUniforms[],
  outlineUniforms?: OutlineUniforms,
) {
  for (const uniforms of lookUniformsList) {
    setFloat(uniforms.colorLevels, controls.colorLevels);
    setFloat(uniforms.thresholdLow, controls.thresholdLow);
    setFloat(uniforms.thresholdHigh, controls.thresholdHigh);
    if (controls.shadowTint) uniforms.shadowTint.value.set(controls.shadowTint);
    if (controls.highlightTint) uniforms.highlightTint.value.set(controls.highlightTint);
    setFloat(uniforms.dirtAmount, controls.dirtAmount);
    setFloat(uniforms.dirtLevels, controls.dirtLevels);
    setFloat(uniforms.dirtContactCut, controls.dirtContactCut);
    setFloat(uniforms.dirtContactFade, controls.dirtContactFade);
    if (typeof controls.dirtDebug === 'boolean') {
      uniforms.dirtDebug.value = controls.dirtDebug ? 1 : 0;
    }
    if (typeof controls.castShadowEnabled === 'boolean') {
      uniforms.castShadowEnabled.value = controls.castShadowEnabled ? 1 : 0;
    }
  }

  if (outlineUniforms) {
    if (controls.edgeColor) outlineUniforms.edgeColor.value.set(controls.edgeColor);
    setFloat(outlineUniforms.outlineWidth, controls.outlineWidth);
  }
}
