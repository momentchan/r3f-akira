import { folder } from 'leva';

export const SMOKE_DEFAULTS = {
  simulation: {
    puffCount: 84,
    randomSeed: 1337,
    speedScale: 0.85,
  },
  shape: {
    puffScale: 0.2,
    scaleMin: 0.5,
    scaleMax: 1.2,
    heightScale: 1.05,
    radiusScale: 0.68,
  },
  motion: {
    curlScale: 0.5,
    driftScale: 10,
  },
  distortion: {
    deformBig: 0.45,
    deformSmall: 0.08,
    distortBigScale: 0.97,
    distortSmallScale: 7.32,
    distortBigSpeed: 0.25,
    distortSmallSpeed: 0.8,
    normalEpsilon: 0.012,
  },
  shading: {
    colorLevels: 5,
    rimStrength: 0.10,
    rimThreshold: 0.76,
    rimPower: 2.8,
    thresholdLow: 0.42,
    thresholdHigh: 0.74,
    thresholdNoiseScale: 240,
    thresholdNoiseStrength: 0.02,
    shadowColor: '#b4b5b8',
    highlightColor: '#ececed',
    surfaceInkColor: '#7a7f80',
    surfaceInkStrength: 0.32,
    surfaceLineScale: 9.0,
    surfaceLineDensity: 0.3,
    surfaceLineThickness: 0.018,
    surfaceLineRotation: 0.35,
    surfaceLineStartMin: 0.12,
    surfaceLineStartMax: 0.28,
    surfaceLineLengthMin: 0.24,
    surfaceLineLengthMax: 0.48,
    surfaceLineFade: 0.045,
  },
  outline: {
    outlineWidth: 0.016,
    outlineColor: '#7b7d82',
  },
};

export function createSmokeControlsSchema(
  count = 84,
  seed = 1337,
) {
  return {
    Simulation: folder({
      puffCount: { value: count, min: 8, max: 240, step: 1 },
      randomSeed: { value: seed, min: 1, max: 9999, step: 1 },
      speedScale: { value: 0.85, min: 0, max: 3, step: 0.01 },
    }),
    Shape: folder({
      puffScale: { value: 0.1, min: 0, max: 0.5, step: 0.01 },
      scaleMin: { value: 0.5, min: 0, max: 1.5, step: 0.01 },
      scaleMax: { value: 1.2, min: 0, max: 1.5, step: 0.01 },
      heightScale: { value: 1.05, min: 0.2, max: 2.5, step: 0.01 },
      radiusScale: { value: 5, min: 0.2, max: 5, step: 0.01 },
    }),
    Motion: folder({
      curlScale: { value: 0.5, min: 0, max: 20, step: 0.01, label: 'eddyStrength' },
      driftScale: { value: 10, min: 0, max: 40, step: 0.01, label: 'wanderStrength' },
    }),
    Distortion: folder({
      deformBig: { value: 0.45, min: 0, max: 1, step: 0.001 },
      distortBigScale: { value: 0.97, min: 0.1, max: 8, step: 0.01 },
      distortBigSpeed: { value: 1.5, min: 0, max: 3, step: 0.01 },
      deformSmall: { value: 0.07, min: 0, max: 1, step: 0.001 },
      distortSmallScale: { value: 5, min: 0.1, max: 24, step: 0.01 },
      distortSmallSpeed: { value: 0.6, min: 0, max: 5, step: 0.01 },
      normalEpsilon: { value: 0.012, min: 0.001, max: 0.05, step: 0.001 },
    }),
    Shading: folder({
      Rim: folder({
        rimStrength: { value: 0.10, min: 0, max: 0.35, step: 0.005 },
        rimThreshold: { value: 0.76, min: 0, max: 1, step: 0.01 },
        rimPower: { value: 2.8, min: 0.5, max: 8, step: 0.1 },
      }),
      colorLevels: { value: 2, min: 2, max: 12, step: 1 },
      thresholdLow: { value: 0.1, min: 0, max: 1, step: 0.01 },
      thresholdHigh: { value: 0.5, min: 0, max: 1, step: 0.01 },
      thresholdNoiseScale: { value: 47.8, min: 0.1, max: 240, step: 0.1 },
      thresholdNoiseStrength: { value: 0.15, min: 0, max: 0.35, step: 0.005 },
      shadowColor: { value: '#b4b5b8' },
      highlightColor: { value: '#ececed' },
      SurfaceLines: folder({
        surfaceInkColor: { value: '#7a7f80' },
        surfaceInkStrength: { value: 1, min: 0, max: 1, step: 0.01 },
        surfaceLineScale: { value: 270, min: 1, max: 1028, step: 0.1 },
        surfaceLineDensity: { value: 0.45, min: 0, max: 1, step: 0.01 },
        surfaceLineThickness: { value: 0.1, min: 0.002, max: 0.12, step: 0.001 },
        surfaceLineRotation: { value: .11, min: 0, max: 3.14, step: 0.01 },
        surfaceLineStartMin: { value: 0.45, min: 0, max: 1, step: 0.01 },
        surfaceLineStartMax: { value: 0.5, min: 0, max: 1, step: 0.01 },
        surfaceLineLengthMin: { value: 0.04, min: 0, max: 1, step: 0.01 },
        surfaceLineLengthMax: { value: 0.06, min: 0, max: 1, step: 0.01 },
        surfaceLineFade: { value: 0.1, min: 0.001, max: 1, step: 0.001 },
      }),
    }),
    Outline: folder({
      outlineWidth: { value: 0.016, min: 0, max: 0.12, step: 0.001 },
      outlineColor: { value: '#696969' },
    }),
  };
}
