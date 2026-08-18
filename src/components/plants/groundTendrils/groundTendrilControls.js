import { folder } from 'leva';
import { GROUND_TENDRIL_DEFAULTS } from './groundTendrilDefaults';

const CLOSED = { collapsed: true };

export function createGroundTendrilControlsSchema(defaults = GROUND_TENDRIL_DEFAULTS) {
  const d = defaults;
  return {
    enabled: { value: d.enabled, label: 'Enabled' },
    Coverage: folder({
      bodyTreeCount: {
        value: d.bodyTreeCount,
        min: 0,
        max: 20,
        step: 1,
        label: 'Body Main Trees',
      },
      backpackTreeCount: {
        value: d.backpackTreeCount,
        min: 0,
        max: 12,
        step: 1,
        label: 'Backpack Main Trees',
      },
      bodyShortTreeCount: {
        value: d.bodyShortTreeCount,
        min: 0,
        max: 16,
        step: 1,
        label: 'Body Nearby Trees',
      },
      backpackShortTreeCount: {
        value: d.backpackShortTreeCount,
        min: 0,
        max: 12,
        step: 1,
        label: 'Backpack Nearby Trees',
      },
    }, CLOSED),
    Composition: folder({
      directionCenter: {
        value: d.directionCenter,
        min: -180,
        max: 180,
        step: 1,
        label: 'Main Direction (deg)',
      },
      directionSpread: {
        value: d.directionSpread,
        min: 30,
        max: 360,
        step: 5,
        label: 'Direction Spread (deg)',
      },
    }, CLOSED),
    'Path Shape': folder({
      trunkLength: {
        value: d.trunkLength,
        min: 0.3,
        max: 4,
        step: 0.05,
        label: 'Outward Length',
      },
      curvature: {
        value: d.curvature,
        min: 0,
        max: 0.5,
        step: 0.01,
        label: 'Ground Curvature',
      },
      lengthVariation: {
        value: d.lengthVariation,
        min: 0,
        max: 0.6,
        step: 0.01,
        label: 'Length Variation',
      },
      shortTreeLengthScale: {
        value: d.shortTreeLengthScale,
        min: 0.1,
        max: 0.75,
        step: 0.01,
        label: 'Nearby Length x',
      },
    }, CLOSED),
    Branching: folder({
      branchDepth: {
        value: d.branchDepth,
        min: 0,
        max: 3,
        step: 1,
        label: 'Branch Generations',
      },
      branchesPerLevel: {
        value: d.branchesPerLevel,
        min: 1,
        max: 3,
        step: 1,
        label: 'Children Per Parent',
      },
      branchLengthScale: {
        value: d.branchLengthScale,
        min: 0.3,
        max: 0.85,
        step: 0.01,
        label: 'Child Length Scale',
      },
      branchAngleRange: {
        value: d.branchAngleRange,
        min: 5,
        max: 80,
        step: 1,
        label: 'Branch Angle (deg)',
      },
      shootsPerPath: {
        value: d.shootsPerPath,
        min: 0,
        max: 4,
        step: 1,
        label: 'Side Shoots Per Trace',
      },
      shootLengthScale: {
        value: d.shootLengthScale,
        min: 0.05,
        max: 0.45,
        step: 0.01,
        label: 'Shoot Length Scale',
      },
      // Kept high on purpose: a shoot has to visibly leave its parent, or its
      // flower still reads as threaded onto the main line.
      shootAngleRange: {
        value: d.shootAngleRange,
        min: 20,
        max: 90,
        step: 1,
        label: 'Shoot Angle (deg)',
      },
    }, CLOSED),
    'Live Placement': folder({
      groundGap: {
        value: d.groundGap,
        min: 0,
        max: 0.05,
        step: 0.001,
        label: 'Extra Ground Gap',
      },
    }, CLOSED),
    Tube: folder({
      tendrilRadius: {
        value: d.tendrilRadius,
        min: 0.002,
        max: 0.02,
        step: 0.0005,
        label: 'Tube Radius',
      },
      radiusDecay: {
        value: d.radiusDecay,
        min: 0.35,
        max: 0.9,
        step: 0.01,
        label: 'Parent to Child Width',
      },
      tipRadiusScale: {
        value: d.tipRadiusScale,
        min: 0.1,
        max: 0.9,
        step: 0.01,
        label: 'Segment Tip Width',
      },
    }, CLOSED),
    Lifecycle: folder({
      restTimeRange: {
        value: d.restTimeRange,
        min: 0,
        max: 20,
        step: 0.1,
        label: 'Start Delay (s)',
      },
      growthTimeRange: {
        value: d.growthTimeRange,
        min: 0.2,
        max: 30,
        step: 0.1,
        label: 'Grow Time (s)',
      },
      retractTimeRange: {
        value: d.retractTimeRange,
        min: 0.2,
        max: 30,
        step: 0.1,
        label: 'Retract Time (s)',
      },
    }, CLOSED),
    Debug: folder({
      showDebug: { value: d.showDebug, label: 'Tree Structure' },
      hideRenderedTendrils: {
        value: d.hideRenderedTendrils,
        label: 'Hide Final Tendrils',
      },
    }, CLOSED),
  };
}
