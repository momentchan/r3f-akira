import { folder } from 'leva';
import { FIELD_DEFAULTS } from './fieldDefaults';
import { LAY_ANCHOR_DEFS } from './fieldAnchors';

const CLOSED = { collapsed: true };

/** How much of the field, and which species. */
function layoutGroup(d) {
  return {
    flowerCount: { value: d.arrangement.flowerCount, min: 1, max: 320, step: 1 },
    arrangementSeed: {
      value: d.arrangement.arrangementSeed, min: 0, max: 999, step: 1,
    },
    roseRatio: {
      value: d.arrangement.roseRatio ?? 0.45, min: 0, max: 1, step: 0.01,
    },
    leanOutward: {
      value: d.arrangement.leanOutward, min: 0, max: 1, step: 0.05,
    },
  };
}

/** Leva keys must be unique across folders, so each pin gets a prefix. */
const PIN_PREFIX = {
  torso: 'hip',
  'forearm.l': 'handL',
  'calf.l': 'bootL',
  backpack: 'backpack',
};

const PIN_FOLDER = {
  torso: 'hip',
  'forearm.l': 'hand L',
  'calf.l': 'boot L',
  backpack: 'backpack',
};

function pinsGroup(d) {
  const pinFolders = {};
  for (const def of LAY_ANCHOR_DEFS) {
    const p = PIN_PREFIX[def.id];
    const controls = {};
    controls[`${p}Weight`] = {
      value: def.weight, min: 0, max: 2.5, step: 0.05, label: 'weight',
    };
    controls[`${p}Reach`] = {
      value: def.reach, min: 0.2, max: 4, step: 0.05, label: 'reach',
    };
    controls[`${p}Elong`] = {
      value: def.elong, min: 1, max: 2.5, step: 0.05, label: 'elong',
    };
    pinFolders[PIN_FOLDER[def.id]] = folder(controls, CLOSED);
  }
  return {
    // Multiplies every pin's reach. Final radius = reach × all ×.
    reachScale: {
      value: d.anchors.reachScale ?? 1, min: 0.4, max: 2, step: 0.01,
      label: 'all ×',
    },
    ...pinFolders,
  };
}

export function pinOverridesFromFieldControls(c) {
  const out = {};
  for (const def of LAY_ANCHOR_DEFS) {
    const p = PIN_PREFIX[def.id];
    out[def.id] = {
      weight: c[`${p}Weight`] ?? def.weight,
      reach: c[`${p}Reach`] ?? def.reach,
      elong: c[`${p}Elong`] ?? def.elong,
    };
  }
  return out;
}

/** How the masses stop being ellipses. Per-pin size lives in Pins. */
function shapeGroup(d) {
  return {
    // Shape, not intensity. This is the knob that makes a cluster stop being a
    // circle. `Debug > densityField` is what makes the difference legible.
    shapeWarp: {
      value: d.anchors.shapeWarp ?? 0.3, min: 0, max: 1, step: 0.01,
    },
    warpScale: {
      value: d.anchors.warpScale ?? 1.6, min: 0.3, max: 6, step: 0.1,
    },
    // Shared across every mass, so the clearings read as properties of the ground
    // rather than as holes belonging to one cluster.
    barePatches: {
      value: d.anchors.barePatches ?? 0.2, min: 0, max: 0.9, step: 0.01,
    },
    patchScale: {
      value: d.anchors.patchScale ?? 1.1, min: 0.2, max: 4, step: 0.05,
    },
  };
}

/** How flowers organise inside a mass. Dispersal is the layout. */
function clumpingGroup(d) {
  return {
    // 0.14 → about 1 in 7 of a pin's flowers sit on a heart.
    // Lower = fewer, bigger clumps; higher = more, smaller clumps.
    hearts: {
      value: d.anchors.hearts ?? 0.14, min: 0.03, max: 0.6, step: 0.01,
    },
    // Tighter = agglomerated clumps, wider = loose scatter. Opening and death
    // both hop this far off the chosen heart.
    hopRange: {
      value: d.anchors.hopRange ?? [0.07, 0.2], min: 0.02, max: 0.6, step: 0.01,
    },
  };
}

/** How the composition changes over time. */
function evolutionGroup(d) {
  return {
    // 0 freezes hearts. Dying flowers still pick among them by field × distance.
    migrateRange: {
      value: d.anchors.migrateRange ?? 0.45, min: 0, max: 1.2, step: 0.01,
    },
    // Also sets how often hearts hop (~10s at the default 0.035).
    migrateSpeed: {
      value: d.anchors.migrateSpeed ?? 0.035, min: 0, max: 0.3, step: 0.005,
    },
  };
}

function lifecycleGroup(d) {
  const l = d.lifecycle;
  const p = d.petalShed;
  return {
    // Everything below is simulated seconds. Global rate lives on the Sim
    // panel — this folder only sets the field's own lifecycle windows.
    initialPhaseSpread: { value: l.initialPhaseSpread, min: 0, max: 1, step: 0.01 },
    delay: { value: l.delay, min: 0, max: 10, step: 0.1 },
    grow: { value: l.grow, min: 0.1, max: 10, step: 0.1 },
    keep: { value: l.keep, min: 0, max: 20, step: 0.1 },
    die: { value: l.die, min: 0.1, max: 10, step: 0.1 },
    petalShedFrac: {
      value: l.petalShedFrac ?? 0.75, min: 0, max: 0.95, step: 0.05,
    },
    shedStemOverlap: {
      value: l.shedStemOverlap ?? 0.5, min: 0, max: 1, step: 0.05,
    },
    // Nested: shed is a phase of the lifecycle, not a peer of it.
    'Petal Shed': folder({
      shedRise: { value: p.shedRise ?? 2, min: 0, max: 6, step: 0.1 },
      shedRiseVariance: {
        value: p.shedRiseVariance ?? 0.5, min: 0, max: 1, step: 0.05,
      },
      shedSpread: {
        value: p.shedSpread ?? 0.35, min: 0, max: 3, step: 0.05,
      },
      shedStagger: {
        value: p.shedStagger ?? 0.55, min: 0, max: 0.95, step: 0.05,
      },
    }, CLOSED),
  };
}

/** Where flowers may not go. */
function keepOutGroup(d) {
  return {
    meshClearDistance: {
      value: d.surround.meshClearDistance, min: 0.0, max: 1, step: 0.01,
    },
  };
}

function debugGroup(d) {
  // Grid resolution is meaningless with the view off.
  const whenField = (get) => get('Field.Debug.densityField') !== false;
  return {
    showAnchors: {
      value: d.anchors.showAnchors ?? false,
    },
    showHearts: {
      value: d.anchors.showHearts ?? false,
    },
    // Samples the same function the sampler does, so it shows what the sampler sees.
    densityField: {
      value: d.anchors.densityField ?? false,
    },
    // Cost is resolution² field samples, rebuilt only when a knob changes.
    gridResolution: {
      value: 56, min: 24, max: 160, step: 4, render: whenField,
    },
    bvhHelper: { value: d.surround.bvhHelper },
    bvhHelperDepth: { value: d.surround.bvhHelperDepth, min: 3, max: 20, step: 1 },
  };
}

export function createFieldControlsSchema(defaults = FIELD_DEFAULTS) {
  const d = defaults;
  return {
    Layout: folder(layoutGroup(d), CLOSED),
    Pins: folder(pinsGroup(d), CLOSED),
    'Mass Shape': folder(shapeGroup(d), CLOSED),
    Clumping: folder(clumpingGroup(d), CLOSED),
    Evolution: folder(evolutionGroup(d), CLOSED),
    Lifecycle: folder(lifecycleGroup(d), CLOSED),
    'Keep-out': folder(keepOutGroup(d), CLOSED),
    Debug: folder(debugGroup(d), CLOSED),
  };
}

export const FIELD_CONTROLS_SCHEMA = createFieldControlsSchema();
