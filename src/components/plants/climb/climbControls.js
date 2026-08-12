import { folder } from 'leva';
import { CLIMB_DEFAULTS } from './climbDefaults';

export function createClimbControlsSchema(defaults = CLIMB_DEFAULTS) {
  const d = defaults;
  return {
    enabled: { value: d.enabled, label: 'enabled' },
    region: {
      value: d.region ?? 'all',
      options: ['calf.r', 'calves', 'legs', 'arms', 'limbs', 'torso', 'all'],
      label: 'region',
    },
    count: { value: d.count, min: 0, max: 512, step: 1, label: 'coil budget' },
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
        min: 24,
        max: 96,
        step: 1,
        label: 'arc samples',
      },
      stepLength: {
        value: d.stepLength,
        min: 0.04,
        max: 0.25,
        step: 0.005,
        label: 'station pitch',
      },
      stationJitter: {
        value: d.stationJitter ?? 0.45,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'station jitter',
      },
      turns: {
        value: d.turns,
        min: 0.5,
        max: 3,
        step: 0.05,
        label: 'turns per coil',
      },
      ringArcDegrees: {
        value: d.ringArcDegrees ?? 220,
        min: 90,
        max: 360,
        step: 5,
        label: 'ring arc (degrees)',
      },
      rootBendStrength: {
        value: d.rootBendStrength ?? 0.55,
        min: 0.1,
        max: 1,
        step: 0.01,
        label: 'bend strength',
      },
      climbBias: {
        value: d.climbBias,
        min: 0.1,
        max: 1,
        step: 0.01,
        label: 'climb bias',
      },
      clearGap: {
        value: d.clearGap,
        min: 0,
        max: 0.12,
        step: 0.001,
        label: 'mesh surface offset',
      },
      peelAt: {
        value: d.peelAt,
        min: 0.5,
        max: 1,
        step: 0.01,
        label: 'peel tip',
      },
      maxCoilsPerCapsule: {
        value: d.maxCoilsPerCapsule,
        min: 1,
        max: 12,
        step: 1,
        label: 'max coils / limb',
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
      showDebug: { value: d.debug.showDebug, label: 'show debug (master)' },
      showSeeds: { value: d.debug.showSeeds, label: 'ground roots' },
      showPaths: { value: d.debug.showPaths, label: 'path polylines' },
      showHitch: {
        value: d.debug.showHitch ?? false,
        label: 'surface hitch',
      },
      showDirs: { value: d.debug.showDirs, label: 'direction axes' },
      showBounds: { value: d.debug.showBounds, label: 'host AABB' },
      showCapsules: {
        value: d.debug.showCapsules ?? false,
        label: 'limb capsules',
      },
      showCapsuleLabels: {
        value: d.debug.showCapsuleLabels ?? false,
        label: 'labels',
      },
      showDiagnostics: {
        value: d.debug.showDiagnostics ?? false,
        label: 'diagnostics panel',
      },
      debugSingleHelix: {
        value: d.debug.debugSingleHelix ?? false,
        label: 'single helix debug',
      },
      debugCapsuleId: {
        value: d.debug.debugCapsuleId ?? 'calf.r',
        label: 'debug capsule id',
      },
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
