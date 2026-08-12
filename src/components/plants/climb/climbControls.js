import { folder } from 'leva';
import { CLIMB_DEFAULTS } from './climbDefaults';

export function createClimbControlsSchema(defaults = CLIMB_DEFAULTS) {
  const d = defaults;
  return {
    enabled: { value: d.enabled, label: 'enabled' },
    count: { value: d.count, min: 0, max: 1024, step: 1, label: 'tendril count' },
    bodyRatio: {
      value: d.bodyRatio,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'body vs pack',
    },
    arrangementSeed: {
      value: d.arrangementSeed,
      min: 0,
      max: 100,
      step: 1,
      label: 'seed',
    },
    animMode: {
      value: d.animMode,
      options: ['settle', 'loop'],
      label: 'anim mode',
    },
    phaseSpread: {
      value: d.phaseSpread,
      min: 0,
      max: 1,
      step: 0.05,
      label: 'phase spread',
    },
    Path: folder({
      sampleCount: {
        value: d.sampleCount,
        min: 6,
        max: 28,
        step: 1,
        label: 'samples',
      },
      stepLength: {
        value: d.stepLength,
        min: 0.015,
        max: 0.12,
        step: 0.001,
        label: 'step length',
      },
      turns: { value: d.turns, min: 0.2, max: 3, step: 0.05, label: 'turns' },
      climbBias: {
        value: d.climbBias,
        min: 0.1,
        max: 0.95,
        step: 0.01,
        label: 'climb bias',
      },
      clearGap: {
        value: d.clearGap,
        min: 0.002,
        max: 0.04,
        step: 0.001,
        label: 'surface gap',
      },
      peelAt: {
        value: d.peelAt,
        min: 0.5,
        max: 1,
        step: 0.01,
        label: 'peel tip',
      },
      capsuleRadiusScale: {
        value: d.capsuleRadiusScale,
        min: 0.4,
        max: 2.5,
        step: 0.05,
        label: 'capsule radius',
      },
    }, { collapsed: true }),
    Tube: folder({
      stemRadius: {
        value: d.stemRadius,
        min: 0.001,
        max: 0.02,
        step: 0.0005,
        label: 'radius',
      },
      radiusAttenuation: {
        value: d.radiusAttenuation,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'taper',
      },
      baseFlare: {
        value: d.baseFlare,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'flare',
      },
      stemSegments: {
        value: d.stemSegments,
        min: 6,
        max: 32,
        step: 1,
        label: 'segments',
      },
      radialSegs: {
        value: d.radialSegs,
        min: 3,
        max: 6,
        step: 1,
        label: 'radial',
      },
    }, { collapsed: true }),
    Lifecycle: folder({
      delay: { value: d.lifecycle.delay, min: 0, max: 8, step: 0.1, label: 'delay' },
      grow: { value: d.lifecycle.grow, min: 0.2, max: 20, step: 0.1, label: 'grow' },
      keep: { value: d.lifecycle.keep, min: 0.5, max: 40, step: 0.1, label: 'keep' },
      die: { value: d.lifecycle.die, min: 0.2, max: 12, step: 0.1, label: 'die' },
    }, { collapsed: true }),
    Wind: folder({
      windStrength: {
        value: d.wind.windStrength,
        min: 0,
        max: 0.2,
        step: 0.001,
        label: 'strength',
      },
      windAngle: {
        value: d.wind.windAngle,
        min: 0,
        max: 360,
        step: 1,
        label: 'angle',
      },
      windScale: {
        value: d.wind.windScale,
        min: 0.1,
        max: 6,
        step: 0.05,
        label: 'scale',
      },
      windSpeed: {
        value: d.wind.windSpeed,
        min: 0,
        max: 3,
        step: 0.01,
        label: 'speed',
      },
    }, { collapsed: true }),
    Debug: folder({
      showDebug: { value: d.debug.showDebug, label: 'show climb debug' },
      showSeeds: { value: d.debug.showSeeds, label: 'seeds / hitch' },
      showPaths: { value: d.debug.showPaths, label: 'path polylines' },
      showDirs: { value: d.debug.showDirs, label: 'direction axes' },
      showBounds: { value: d.debug.showBounds, label: 'host AABB' },
      showCapsules: { value: d.debug.showCapsules ?? true, label: 'limb capsules' },
      pathCount: {
        value: d.debug.pathCount,
        min: 1,
        max: 128,
        step: 1,
        label: 'debug path count',
      },
    }, { collapsed: true }),
  };
}
