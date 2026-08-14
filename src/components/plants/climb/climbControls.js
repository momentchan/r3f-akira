import { folder } from 'leva';
import { CLIMB_DEFAULTS } from './climbDefaults';

export function createClimbControlsSchema(defaults = CLIMB_DEFAULTS) {
  const d = defaults;
  return {
    enabled: { value: d.enabled, label: 'Enabled' },

    Target: folder({
      region: {
        value: d.region,
        options: ['calf.r', 'calves', 'legs', 'arms', 'limbs', 'torso', 'all'],
        label: 'Body Region',
      },
    }),

    Distribution: folder({
      layoutSeed: {
        value: d.layoutSeed,
        min: 0,
        max: 100,
        step: 1,
        label: 'Layout Seed',
      },
      tendrilCount: {
        value: d.tendrilCount,
        min: 1,
        max: 512,
        step: 1,
        label: 'Tendril Count',
      },
      spacingVariation: {
        value: d.spacingVariation,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'Spacing Variation',
      },
    }),

    Shape: folder({
      wrapAngleRange: {
        value: d.wrapAngleRange,
        min: 90,
        max: 360,
        step: 5,
        label: 'Wrap Angle Range (deg)',
      },
      axialWeave: {
        value: d.axialWeave,
        min: 0,
        max: 2,
        step: 0.05,
        label: 'Axial Weave',
      },
      entryBend: {
        value: d.entryBend,
        min: 0.1,
        max: 1,
        step: 0.01,
        label: 'Entry Bend',
      },
      surfaceOffset: {
        value: d.surfaceOffset,
        min: 0,
        max: 0.12,
        step: 0.001,
        label: 'Surface Offset',
      },
      curveSamples: {
        value: d.curveSamples,
        min: 24,
        max: 96,
        step: 1,
        label: 'Curve Samples',
      },
    }, { collapsed: true }),

    Appearance: folder({
      tendrilRadius: {
        value: d.tendrilRadius,
        min: 0.001,
        max: 0.02,
        step: 0.0005,
        label: 'Tendril Radius',
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
    }),

    'Noise Field': folder({
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
      noiseSeed: {
        value: d.noiseSeed,
        min: 0,
        max: 100,
        step: 1,
        label: 'Noise Seed',
      },
    }),

    'Living Motion': folder({
      motionAmount: {
        value: d.motionAmount,
        min: 0,
        max: 0.03,
        step: 0.001,
        label: 'Motion Amount',
      },
      motionFrequency: {
        value: d.motionFrequency,
        min: 0.1,
        max: 10,
        step: 0.1,
        label: 'Motion Frequency',
      },
      motionSpeed: {
        value: d.motionSpeed,
        min: 0,
        max: 2.5,
        step: 0.05,
        label: 'Motion Speed',
      },
    }),

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
      leafScaleVariation: {
        value: d.leafScaleVariation,
        min: 0,
        max: 1,
        step: 0.05,
        label: 'Size Variation',
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
      leafCurlVariation: {
        value: d.leafCurlVariation,
        min: 0,
        max: 1,
        step: 0.05,
        label: 'Curl Variation',
      },
      leafColorLevels: {
        value: d.leafColorLevels,
        min: 1,
        max: 16,
        step: 1,
        label: 'Leaf Color Levels',
      },
    }, { collapsed: true }),

    Growth: folder({
      restTimeRange: {
        value: d.restTimeRange,
        min: 0,
        max: 20,
        step: 0.1,
        label: 'Rest Time Range (s)',
      },
      growthTimeRange: {
        value: d.growthTimeRange,
        min: 0.2,
        max: 20,
        step: 0.1,
        label: 'Growth Time Range (s)',
      },
      holdTimeRange: {
        value: d.holdTimeRange,
        min: 0,
        max: 60,
        step: 0.1,
        label: 'Hold Time Range (s)',
      },
      retractTimeRange: {
        value: d.retractTimeRange,
        min: 0.2,
        max: 20,
        step: 0.1,
        label: 'Retract Time Range (s)',
      },
      initialPhaseSpread: {
        value: d.initialPhaseSpread,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'Initial Phase Spread',
      },
    }),

    Debug: folder({
      showDebug: { value: d.debug.showDebug, label: 'Show Debug' },
      showPaths: { value: d.debug.showPaths, label: 'Paths' },
      showSeeds: { value: d.debug.showSeeds, label: 'Ground Roots' },
      showCapsules: { value: d.debug.showCapsules, label: 'Body Regions' },
      showCapsuleLabels: { value: d.debug.showCapsuleLabels, label: 'Region Labels' },
      showDiagnostics: { value: d.debug.showDiagnostics, label: 'Extraction Diagnostics' },
      pathCount: {
        value: d.debug.pathCount,
        min: 1,
        max: 256,
        step: 1,
        label: 'Max Debug Paths',
      },
    }, { collapsed: true }),
  };
}
