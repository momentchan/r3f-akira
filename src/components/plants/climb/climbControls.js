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
      ringSpacing: {
        value: d.ringSpacing,
        min: 0.01,
        max: 0.25,
        step: 0.005,
        label: 'Ring Spacing',
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
      wrapAngleDegrees: {
        value: d.wrapAngleDegrees,
        min: 90,
        max: 360,
        step: 5,
        label: 'Wrap Angle (deg)',
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
    }),

    Growth: folder({
      growthTimeRange: {
        value: d.growthTimeRange,
        min: 0.2,
        max: 20,
        step: 0.1,
        label: 'Growth Time Range (s)',
      },
      maxStartDelay: {
        value: d.maxStartDelay,
        min: 0,
        max: 20,
        step: 0.1,
        label: 'Max Start Delay (s)',
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
