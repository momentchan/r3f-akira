import { folder } from 'leva';
import {
  STEM_DEFAULTS,
  STEM_RANGES,
  STEM_Y_MAX,
} from './stemDefaults';

export function createStemGeometrySchema(defaults = STEM_DEFAULTS.geometry) {
  const d = defaults;
  const R = STEM_RANGES;
  return {
    stemLength: { value: d.stemLength, min: R.stemLength.min, max: R.stemLength.max, step: 0.01, label: 'length' },
    stemRadius: { value: d.stemRadius, min: R.stemRadius.min, max: R.stemRadius.max, step: 0.001, label: 'radius' },
    leanAngle: { value: d.leanAngle, min: R.leanAngle.min, max: R.leanAngle.max, step: 0.5, label: 'lean °' },
    bendDegree: { value: d.bendDegree, min: R.bendDegree.min, max: R.bendDegree.max, step: 0.005, label: 'bend' },
    radiusAttenuation: {
      value: d.radiusAttenuation,
      min: R.radiusAttenuation.min,
      max: R.radiusAttenuation.max,
      step: 0.01,
      label: 'taper',
    },
    baseFlare: { value: d.baseFlare, min: R.baseFlare.min, max: R.baseFlare.max, step: 0.01, label: 'flare' },
    stemSegments: { value: d.stemSegments, min: 4, max: 128, step: 1, label: 'segments' },
    radialSegs: { value: d.radialSegs, min: 3, max: 16, step: 1, label: 'radial' },
    bloomStart: { value: d.bloomStart, min: 0, max: 1, step: 0.01, label: 'bloom start' },
    bloomFrac: { value: d.bloomFrac, min: 0, max: 0.5, step: 0.01, label: 'bloom frac' },
    stemYMax: {
      value: d.stemYMax ?? STEM_Y_MAX,
      min: -0.5,
      max: 0.5,
      step: 0.01,
      label: 'stem Y max',
    },
  };
}

export function createStemLookSchema(defaults = STEM_DEFAULTS.look) {
  const d = defaults;
  return {
    stemColorLevels: { value: d.colorLevels, min: 2, max: 6, step: 1, label: 'colorLevels' },
    stemThresholdLow: { value: d.thresholdLow, min: 0, max: 1, step: 0.01, label: 'thresholdLow' },
    stemThresholdHigh: { value: d.thresholdHigh, min: 0, max: 1, step: 0.01, label: 'thresholdHigh' },
    stemEdgeThreshold: { value: d.edgeThreshold, min: 0, max: 0.5, step: 0.01, label: 'edge start' },
    stemEdgeSoftness: {
      value: d.edgeSoftness,
      min: 0,
      max: 6,
      step: 0.05,
      label: 'edge (screenspace)',
    },
  };
}

/** All stem params — geometry + shared toon look + leaves — under top-level Stem. */
export function createStemSchema(
  geometryDefaults = STEM_DEFAULTS.geometry,
  lookDefaults = STEM_DEFAULTS.look,
  leafDefaults = STEM_DEFAULTS.leaves,
) {
  return {
    Geometry: folder(createStemGeometrySchema(geometryDefaults), { collapsed: false }),
    Look: folder(createStemLookSchema(lookDefaults), { collapsed: true }),
    Leaves: folder(createLeafSchema(leafDefaults), { collapsed: true }),
  };
}

function createLeafSchema(defaults = STEM_DEFAULTS.leaves) {
  const d = defaults;
  return {
    leafCount: { value: d.leafCount, min: 0, max: 8, step: 1, label: 'count / stem' },
    leafSpan: { value: d.leafSpan, min: 0, max: 1, step: 0.01, label: 'spawn range' },
    leafScale: { value: d.leafScale, min: 0.05, max: 1.2, step: 0.01, label: 'size / stem len' },
    scaleVariance: { value: d.scaleVariance, min: 0, max: 1, step: 0.05, label: 'size variance' },
    droop: { value: d.droop, min: -1.2, max: 1.2, step: 0.01, label: 'droop (rad)' },
    leafBend: { value: d.leafBend, min: -2, max: 2, step: 0.05, label: 'bend (curl)' },
    curlStrengthStart: { value: d.curlStrengthStart, min: 0, max: 8, step: 0.1, label: 'curl str: start' },
    curlStrengthEnd: { value: d.curlStrengthEnd, min: 0, max: 8, step: 0.1, label: 'curl str: end' },
    curlPowerStart: { value: d.curlPowerStart, min: 0.2, max: 8, step: 0.05, label: 'curl pow: start' },
    curlPowerEnd: { value: d.curlPowerEnd, min: 0.2, max: 8, step: 0.05, label: 'curl pow: end' },
    bendStrength: { value: d.bendStrength, min: 0, max: 12, step: 0.1, label: 'wind flex' },
    bendVariance: { value: d.bendVariance, min: 0, max: 1, step: 0.05, label: 'curl variance' },
    colorLevels: { value: d.colorLevels, min: 1, max: 16, step: 1, label: 'toon smoothness' },
  };
}

/** Sync shared stem look into one or more flowerUniforms.stem sets. */
export function syncStemLookControls(controls, flowerUniformsList) {
  const list = Array.isArray(flowerUniformsList) ? flowerUniformsList : [flowerUniformsList];
  for (const flowerUniforms of list) {
    if (!flowerUniforms?.stem) continue;
    const { stem } = flowerUniforms;
    stem.colorLevels.value = controls.stemColorLevels;
    stem.thresholdLow.value = controls.stemThresholdLow;
    stem.thresholdHigh.value = controls.stemThresholdHigh;
    stem.shadowColor.value.set(controls.stemShadowColor);
    stem.highlightColor.value.set(controls.stemHighlightColor);
    stem.edgeColor.value.set(controls.stemEdgeColor);
    stem.edgeThreshold.value = controls.stemEdgeThreshold;
    stem.edgeSoftness.value = controls.stemEdgeSoftness;
  }
}

export { DEFAULT_STEM_LOOK } from './stemDefaults';
