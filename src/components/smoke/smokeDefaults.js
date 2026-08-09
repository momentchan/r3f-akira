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

export function createSmokeControlsSchema(defaults = SMOKE_DEFAULTS) {
  const { simulation: sim, shape, motion, distortion: dist, shading: sh, outline } = defaults;
  return {
    Simulation: folder({
      puffCount: { value: sim.puffCount, min: 8, max: 240, step: 1 },
      randomSeed: { value: sim.randomSeed, min: 1, max: 9999, step: 1 },
      speedScale: { value: sim.speedScale, min: 0, max: 3, step: 0.01 },
    }),
    Shape: folder({
      puffScale: { value: shape.puffScale, min: 0, max: 0.5, step: 0.01 },
      scaleMin: { value: shape.scaleMin, min: 0, max: 1.5, step: 0.01 },
      scaleMax: { value: shape.scaleMax, min: 0, max: 1.5, step: 0.01 },
      heightScale: { value: shape.heightScale, min: 0.2, max: 2.5, step: 0.01 },
      radiusScale: { value: shape.radiusScale, min: 0.2, max: 5, step: 0.01 },
    }),
    Motion: folder({
      curlScale: { value: motion.curlScale, min: 0, max: 20, step: 0.01, label: 'eddyStrength' },
      driftScale: { value: motion.driftScale, min: 0, max: 40, step: 0.01, label: 'wanderStrength' },
    }),
    Distortion: folder({
      deformBig: { value: dist.deformBig, min: 0, max: 1, step: 0.001 },
      distortBigScale: { value: dist.distortBigScale, min: 0.1, max: 8, step: 0.01 },
      distortBigSpeed: { value: dist.distortBigSpeed, min: 0, max: 3, step: 0.01 },
      deformSmall: { value: dist.deformSmall, min: 0, max: 1, step: 0.001 },
      distortSmallScale: { value: dist.distortSmallScale, min: 0.1, max: 24, step: 0.01 },
      distortSmallSpeed: { value: dist.distortSmallSpeed, min: 0, max: 5, step: 0.01 },
      normalEpsilon: { value: dist.normalEpsilon, min: 0.001, max: 0.05, step: 0.001 },
    }),
    Shading: folder({
      Rim: folder({
        rimStrength: { value: sh.rimStrength, min: 0, max: 0.35, step: 0.005 },
        rimThreshold: { value: sh.rimThreshold, min: 0, max: 1, step: 0.01 },
        rimPower: { value: sh.rimPower, min: 0.5, max: 8, step: 0.1 },
      }),
      colorLevels: { value: sh.colorLevels, min: 2, max: 12, step: 1 },
      thresholdLow: { value: sh.thresholdLow, min: 0, max: 1, step: 0.01 },
      thresholdHigh: { value: sh.thresholdHigh, min: 0, max: 1, step: 0.01 },
      thresholdNoiseScale: { value: sh.thresholdNoiseScale, min: 0.1, max: 240, step: 0.1 },
      thresholdNoiseStrength: { value: sh.thresholdNoiseStrength, min: 0, max: 0.35, step: 0.005 },
      shadowColor: { value: sh.shadowColor },
      highlightColor: { value: sh.highlightColor },
      SurfaceLines: folder({
        surfaceInkColor: { value: sh.surfaceInkColor },
        surfaceInkStrength: { value: sh.surfaceInkStrength, min: 0, max: 1, step: 0.01 },
        surfaceLineScale: { value: sh.surfaceLineScale, min: 1, max: 1028, step: 0.1 },
        surfaceLineDensity: { value: sh.surfaceLineDensity, min: 0, max: 1, step: 0.01 },
        surfaceLineThickness: { value: sh.surfaceLineThickness, min: 0.002, max: 0.12, step: 0.001 },
        surfaceLineRotation: { value: sh.surfaceLineRotation, min: 0, max: 3.14, step: 0.01 },
        surfaceLineStartMin: { value: sh.surfaceLineStartMin, min: 0, max: 1, step: 0.01 },
        surfaceLineStartMax: { value: sh.surfaceLineStartMax, min: 0, max: 1, step: 0.01 },
        surfaceLineLengthMin: { value: sh.surfaceLineLengthMin, min: 0, max: 1, step: 0.01 },
        surfaceLineLengthMax: { value: sh.surfaceLineLengthMax, min: 0, max: 1, step: 0.01 },
        surfaceLineFade: { value: sh.surfaceLineFade, min: 0.001, max: 1, step: 0.001 },
      }),
    }),
    Outline: folder({
      outlineWidth: { value: outline.outlineWidth, min: 0, max: 0.12, step: 0.001 },
      outlineColor: { value: outline.outlineColor },
    }),
  };
}
