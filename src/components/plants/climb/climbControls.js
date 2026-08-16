import { folder } from 'leva';
import { CLIMB_DEFAULTS } from './climbDefaults';

const CLOSED = { collapsed: true };

export function createClimbControlsSchema(defaults = CLIMB_DEFAULTS) {
  const d = defaults;
  return {
    enabled: { value: d.enabled, label: 'Enabled' },

    Coverage: folder({
      tendrilCount: {
        value: d.tendrilCount,
        min: 1,
        max: 512,
        step: 1,
        label: 'Total Wrap Count',
      },
      headDensity: {
        value: d.headDensity,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'Head Density',
      },
    }, CLOSED),

    Form: folder({
      wrapAngleRange: {
        value: d.wrapAngleRange,
        min: 90,
        max: 360,
        step: 5,
        label: 'Wrap Angle (deg)',
      },
      axialWeave: {
        value: d.axialWeave,
        min: 0,
        max: 2,
        step: 0.05,
        label: 'Along-Bone Weave',
      },
      surfaceOffset: {
        value: d.surfaceOffset,
        min: 0,
        max: 0.12,
        step: 0.001,
        label: 'Surface Gap',
      },
      tendrilRadius: {
        value: d.tendrilRadius,
        min: 0.001,
        max: 0.02,
        step: 0.0005,
        label: 'Tube Radius',
      },
      radiusAttenuation: {
        value: d.radiusAttenuation,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'Taper',
      },
      baseFlare: {
        value: d.baseFlare,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'Base Flare',
      },
    }, CLOSED),

    Variation: folder({
      noiseAmount: {
        value: d.noiseAmount,
        min: 0,
        max: 0.08,
        step: 0.001,
        label: 'Noise Amount',
      },
      noiseFrequency: {
        value: d.noiseFrequency,
        min: 0.1,
        max: 20,
        step: 0.1,
        label: 'Noise Frequency',
      },
      motionAmount: {
        value: d.motionAmount,
        min: 0,
        max: 0.03,
        step: 0.001,
        label: 'Motion Amount',
      },
      motionSpeed: {
        value: d.motionSpeed,
        min: 0,
        max: 2.5,
        step: 0.05,
        label: 'Motion Speed',
      },
    }, CLOSED),

    Leaves: folder({
      leafCount: {
        value: d.leafCount,
        min: 0,
        max: 4,
        step: 1,
        label: 'Leaves Per Tendril',
      },
      leafSpan: {
        value: d.leafSpan,
        min: 0.1,
        max: 0.9,
        step: 0.01,
        label: 'Leaf Growth Range',
      },
      leafScale: {
        value: d.leafScale,
        min: 0.02,
        max: 0.5,
        step: 0.01,
        label: 'Leaf Size',
      },
      leafDroop: {
        value: d.leafDroop,
        min: -1.2,
        max: 1.2,
        step: 0.01,
        label: 'Leaf Droop',
      },
      leafCurl: {
        value: d.leafCurl,
        min: -2,
        max: 2,
        step: 0.05,
        label: 'Leaf Curl',
      },
    }, CLOSED),

    Flowers: folder({
      flowerDensity: {
        value: d.flowerDensity,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'Flower Density',
      },
      flowerSpan: {
        value: d.flowerSpan,
        min: 0.05,
        max: 0.95,
        step: 0.01,
        label: 'Position Along Path',
      },
      flowerNormalVariation: {
        value: d.flowerNormalVariation,
        min: 0,
        max: 30,
        step: 1,
        label: 'Normal Variation (deg)',
      },
    }, CLOSED),

    Lifecycle: folder({
      restTimeRange: {
        value: d.restTimeRange,
        min: 0,
        max: 20,
        step: 0.1,
        label: 'Tree Rest Time (s)',
      },
      growthTimeRange: {
        value: d.growthTimeRange,
        min: 0.2,
        max: 20,
        step: 0.1,
        label: 'Tree Grow Time (s)',
      },
      holdTimeRange: {
        value: d.holdTimeRange,
        min: 0,
        max: 60,
        step: 0.1,
        label: 'Tree Hold Time (s)',
      },
      retractTimeRange: {
        value: d.retractTimeRange,
        min: 0.2,
        max: 20,
        step: 0.1,
        label: 'Tree Retract Time (s)',
      },
    }, CLOSED),

    Debug: folder({
      showDebug: { value: d.debug.showDebug, label: 'Show Debug' },
      showPaths: { value: d.debug.showPaths, label: 'Paths' },
      showSeeds: { value: d.debug.showSeeds, label: 'Ground Roots' },
      showCapsules: { value: d.debug.showCapsules, label: 'Body Regions' },
      showCapsuleLabels: {
        value: d.debug.showCapsuleLabels,
        label: 'Region Labels',
      },
      showDiagnostics: {
        value: d.debug.showDiagnostics,
        label: 'Counts & Diagnostics',
      },
      hideRenderedTendrils: {
        value: Boolean(d.debug.hideRenderedTendrils),
        label: 'Hide Rendered Tendrils',
      },
      pathCount: {
        value: d.debug.pathCount,
        min: 1,
        max: 256,
        step: 1,
        label: 'Max Debug Paths',
      },
    }, CLOSED),
  };
}
