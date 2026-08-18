import { folder } from 'leva';
import { FIELD_DEFAULTS } from './fieldDefaults';

/**
 * Leva schema for the flower field.
 *
 * Grouped by **the question you are answering when you reach for the knob**, not
 * by which default object the value happens to live in.
 *
 * Three conventions worth keeping:
 *
 * - Leva folders are **presentational only** — `useControls` returns a flat
 *   object. So folders can be reorganised freely, but a KEY can never be renamed
 *   without also changing `PlantField`'s destructuring. Labels are free.
 * - **A knob that does nothing in the current mode is not shown at all.** Leva's
 *   `render` predicate hides it rather than parking it in a "legacy" folder, which
 *   was the previous approach and just relocated the problem: the controls were
 *   still on screen, still looked adjustable, and a folder label is not something
 *   you re-read every time you open the panel.
 * - Every knob here has a verified path to an observable effect. When one turns out
 *   not to — `minGap` was the last, whose only role was silently raising the size
 *   ramp radius — delete it rather than annotating it as inert.
 */

const CLOSED = { collapsed: true };

/**
 * Mode predicates for `render`.
 *
 * Both default to VISIBLE when the path cannot be resolved: leva's `get` returns
 * undefined for an unknown path, so if its path scheme changes under us the failure
 * mode is a panel showing too much rather than one that silently hides the control
 * you were reaching for.
 */
const MODE_PATH = 'Field.Layout.layoutMode';
const whenAnchors = (get) => {
  const mode = get(MODE_PATH);
  return mode === undefined || mode === 'anchors';
};
const whenSpiral = (get) => {
  const mode = get(MODE_PATH);
  return mode === undefined || mode === 'spiral';
};

/**
 * Folder settings that hide an ENTIRE folder outside its layout.
 *
 * Only for folders where every member is mode-specific. A folder holding even one
 * knob that is live in both layouts must stay visible and gate per input instead —
 * hiding a live control is the same bug as showing a dead one.
 */
const ANCHORS_ONLY = { collapsed: true, render: whenAnchors };
const SPIRAL_ONLY = { collapsed: true, render: whenSpiral };

/** What kind of layout, how much of it, and which species. Always relevant. */
function layoutGroup(d) {
  return {
    // 'anchors' is the live density-driven path; 'spiral' is the original
    // golden-angle layout. Switching this changes which knobs below are shown.
    layoutMode: {
      value: d.anchors.layoutMode ?? 'anchors',
      options: ['anchors', 'spiral'],
      label: 'layout',
    },
    count: { value: d.arrangement.count, min: 1, max: 320, step: 1, label: 'flower count' },
    arrangementSeed: {
      value: d.arrangement.arrangementSeed, min: 0, max: 999, step: 1, label: 'seed',
    },
    roseRatio: {
      value: d.arrangement.roseRatio ?? 0.45, min: 0, max: 1, step: 0.01, label: 'rose ratio',
    },
    leanOut: {
      value: d.arrangement.leanOut, min: 0, max: 1, step: 0.05, label: 'lean outward',
    },
  };
}

/** How big each mass is, and what stops it being an ellipse. Anchors only. */
function shapeGroup(d) {
  return {
    // The only knob that scales the masses themselves: it multiplies every
    // anchor's reach, which is the radius the falloff is measured against.
    anchorReach: {
      value: d.anchors.anchorReach ?? 1, min: 0.4, max: 2, step: 0.01, label: 'reach scale',
    },
    // Shape, not intensity. This is the knob that makes a cluster stop being a
    // circle; at 0 the masses are clean ellipses however high `edge ragged` goes,
    // because that one only varies brightness along an unchanged boundary.
    // `Debug > density field > as solid mask` is what makes the difference legible.
    warpAmount: {
      value: d.anchors.warpAmount ?? 0.3, min: 0, max: 1, step: 0.01, label: 'shape warp',
    },
    warpFrequency: {
      value: d.anchors.warpFrequency ?? 1.6, min: 0.3, max: 6, step: 0.1, label: 'warp scale',
    },
    // Shared across every mass, so the clearings read as properties of the ground
    // rather than as holes belonging to one cluster.
    gapAmount: {
      value: d.anchors.gapAmount ?? 0.2, min: 0, max: 0.9, step: 0.01, label: 'bare patches',
    },
    gapFrequency: {
      value: d.anchors.gapFrequency ?? 1.1, min: 0.2, max: 4, step: 0.05, label: 'patch scale',
    },
    edgeNoiseAmount: {
      value: d.anchors.edgeNoiseAmount ?? 0.35, min: 0, max: 1, step: 0.01, label: 'edge ragged',
    },
    edgeNoiseFrequency: {
      value: d.anchors.edgeNoiseFrequency ?? 2.6, min: 0.5, max: 8, step: 0.1, label: 'edge scale',
    },
  };
}

/** How flowers organise inside a mass. Anchors only — dispersal is that layout. */
function clumpingGroup(d) {
  return {
    // Low = few large bouquets; high approaches plain field sampling, because
    // almost everything becomes a founder rather than spreading from one.
    founderShare: {
      value: d.anchors.founderShare ?? 0.14, min: 0.03, max: 0.6, step: 0.01, label: 'founders',
    },
    // Tighter = agglomerated clumps, wider = loose scatter. Decays with dispersal
    // depth, so this is the range for the first generation.
    hopRange: {
      value: d.anchors.hopRange ?? [0.07, 0.2], min: 0.02, max: 0.6, step: 0.01, label: 'spread hop',
    },
    // Scene-wide, not per mass. One focal flower per cluster averages the image
    // back out to uniform.
    primaryCount: {
      value: d.anchors.primaryCount ?? 4, min: 0, max: 16, step: 1, label: 'primaries (total)',
    },
  };
}

/**
 * Flower size. Both knobs run through `buildStem`, which both layouts call, so
 * these are the only size controls that are live in either mode.
 */
function sizeGroup(d) {
  return {
    // Floor of the radial ramp: the size an innermost flower gets. 1 disables the
    // hierarchy entirely.
    nearSizeMin: {
      value: d.surround.nearSizeMin ?? 0.48, min: 0.25, max: 1, step: 0.01, label: 'near bloom scale',
    },
    // Outer end of that ramp. It normalises each slot's `rimT`, so raising it
    // lowers rimT everywhere and shrinks every flower — it is a size control, not
    // a placement one, despite living in `Masses` under its old `field radius`
    // label. Verified chain: spreadRadius -> effectiveSpread -> farR -> slot.rimT
    // -> radialBase -> sizeMul.
    //
    // Two things to know. It clamps up to the body diagonal + 0.6, so lowering it
    // past ~1.8 does nothing. And in `spiral` mode it is ALSO the placement radius
    // — the one knob whose meaning differs between the layouts, which is why the
    // label says what it does in the mode you are actually in.
    spreadRadius: {
      value: d.arrangement.spreadRadius, min: 0, max: 4, step: 0.01, label: 'size ramp radius',
    },
  };
}

/**
 * How the composition changes over time.
 *
 * MIXED folder: the three migrate knobs are anchors-only, but `spare slots x` feeds
 * the spiral branch's pool too and `reshuffle on respawn` applies to both — so this
 * gates per input rather than as a whole.
 */
function evolutionGroup(d) {
  return {
    // 0 freezes the composition. Also sizes the spare-slot envelope at build time,
    // so changing it rebuilds the pool.
    migrateDist: {
      value: d.anchors.migrateDist ?? 0.45, min: 0, max: 1.2, step: 0.01, label: 'migrate range',
      render: whenAnchors,
    },
    migrateSpeed: {
      value: d.anchors.migrateSpeed ?? 0.035, min: 0, max: 0.3, step: 0.005, label: 'migrate speed',
      render: whenAnchors,
    },
    // Density floor for the respawn pick. Slots below it carry no weight, so a
    // flower finishing its cycle reappears where the field currently is. It never
    // interrupts a live plant — raising it steers new growth, it does not cull.
    migrateThreshold: {
      value: d.anchors.migrateThreshold ?? 0.12, min: 0, max: 0.6, step: 0.01, label: 'regrow floor',
      render: whenAnchors,
    },
    reshuffleOnRespawn: {
      value: d.arrangement.reshuffleOnRespawn ?? true, label: 'reshuffle on respawn',
    },
    // Spare slots per live plant. These are the targets a respawning flower moves
    // into, so at 1 the reshuffle has nowhere to go.
    slotFactor: {
      value: d.arrangement.slotFactor ?? 2, min: 1, max: 6, step: 1, label: 'spare slots x',
    },
  };
}

function lifecycleGroup(d) {
  const l = d.lifecycle;
  const p = d.petalShed;
  return {
    // GLOBAL, and not only to this panel: it rescales the climbing tendrils and the
    // standalone stems too, and it drives the anchor-field drift as well as flower
    // ages, so the masses and the flowers on them move together. Everything below
    // is expressed in simulated seconds, which this multiplies.
    // 10x turns a ~180s / six-generation evolution review into ~18s.
    simSpeed: { value: 1, min: 0, max: 12, step: 0.1, label: 'sim speed (global)' },
    phaseSpread: { value: l.phaseSpread, min: 0, max: 1, step: 0.01, label: 'initial phase spread' },
    delay: { value: l.delay, min: 0, max: 10, step: 0.1, label: 'delay (s)' },
    grow: { value: l.grow, min: 0.1, max: 10, step: 0.1, label: 'grow (s)' },
    keep: { value: l.keep, min: 0, max: 20, step: 0.1, label: 'keep (s)' },
    die: { value: l.die, min: 0.1, max: 10, step: 0.1, label: 'die (s)' },
    petalShedFrac: {
      value: l.petalShedFrac ?? 0.75, min: 0, max: 0.95, step: 0.05, label: 'petal shed / die',
    },
    shedStemOverlap: {
      value: l.shedStemOverlap ?? 0.5, min: 0, max: 1, step: 0.05, label: 'stem/shed overlap',
    },
    // Nested: shed is a phase of the lifecycle, not a peer of it.
    'Petal Shed': folder({
      shedRise: { value: p.shedRise ?? 2, min: 0, max: 6, step: 0.1, label: 'rise / stem length' },
      shedRiseVariance: {
        value: p.shedRiseVariance ?? 0.5, min: 0, max: 1, step: 0.05, label: 'rise variance',
      },
      shedSpread: {
        value: p.shedSpread ?? 0.35, min: 0, max: 3, step: 0.05, label: 'spread / stem length',
      },
      shedStagger: {
        value: p.shedStagger ?? 0.55, min: 0, max: 0.95, step: 0.05, label: 'stagger',
      },
    }, CLOSED),
  };
}

/** Where flowers may not go. Applies in both layouts. */
function keepOutGroup(d) {
  return {
    enabled: { value: d.surround.enabled, label: 'clear body + backpack' },
    clearMargin: {
      value: d.surround.clearMargin, min: 0.05, max: 1.2, step: 0.01, label: 'mesh clear distance',
    },
    // A hard pocket, and now the ONLY helmet protection: the soft negative anchor
    // that used to feather density outward from it has been removed, so density
    // stops at this edge rather than thinning through it.
    faceClearRadius: {
      value: d.surround.faceClearRadius ?? 0.38, min: 0, max: 1.2, step: 0.01, label: 'face clear radius',
    },
    // Spiral only: how hard stems pack toward the body. The anchor layout gets the
    // equivalent from the contact-peaked anchor falloff, which is not a knob.
    contactPow: {
      value: d.surround.contactPow ?? 2.55, min: 1, max: 4, step: 0.05, label: 'contact density',
      render: whenSpiral,
    },
  };
}

/**
 * Spiral only. The anchor layout gets its irregularity from `Mass Shape`, so a
 * uniform positional jitter has nothing to perturb there.
 */
function spiralGroup(d) {
  return {
    positionJitter: {
      value: d.arrangement.positionJitter ?? 0.35,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'position jitter',
    },
  };
}

function debugGroup(d) {
  // The three field-view knobs are meaningless with the view off, so they are
  // gated on it as well as on the mode.
  const whenField = (get) => whenAnchors(get) && get('Field.Debug.showAnchorField') !== false;
  return {
    showAnchors: {
      value: d.anchors.showAnchors ?? false, label: 'anchors', render: whenAnchors,
    },
    // Samples the same function the sampler does, so it shows what the sampler sees.
    showAnchorField: {
      value: d.anchors.showAnchorField ?? false, label: 'density field',
      render: whenAnchors,
    },
    // Solid mask at one threshold instead of a heat map. This is the mode to use
    // when tuning Mass Shape: a heat map's brightness variation reads as shape
    // variation, so `shape warp` and `edge ragged` are hard to tell apart in it.
    fieldFlat: { value: false, label: '↳ as solid mask', render: whenField },
    // Sweep this in mask mode to walk the iso-contours and see how steeply a mass
    // falls off. In heat-map mode it only hides the dimmest cells.
    fieldThreshold: {
      value: 0.06, min: 0.01, max: 0.9, step: 0.01, label: '↳ threshold', render: whenField,
    },
    // Cost is resolution² field samples, rebuilt only when a knob changes.
    fieldResolution: {
      value: 56, min: 24, max: 160, step: 4, label: '↳ grid resolution', render: whenField,
    },
    showCompositionDebug: {
      value: d.surround.showCompositionDebug ?? false, label: 'composition guides',
    },
    showDebug: { value: d.surround.showDebug, label: 'BVH helper' },
    bvhDepth: { value: d.surround.bvhDepth, min: 3, max: 20, step: 1, label: 'BVH helper depth' },
  };
}

export function createFieldControlsSchema(defaults = FIELD_DEFAULTS) {
  const d = defaults;
  return {
    Layout: folder(layoutGroup(d), CLOSED),
    'Mass Shape': folder(shapeGroup(d), ANCHORS_ONLY),
    Clumping: folder(clumpingGroup(d), ANCHORS_ONLY),
    Size: folder(sizeGroup(d), CLOSED),
    Evolution: folder(evolutionGroup(d), CLOSED),
    Lifecycle: folder(lifecycleGroup(d), CLOSED),
    'Keep-out': folder(keepOutGroup(d), CLOSED),
    Spiral: folder(spiralGroup(d), SPIRAL_ONLY),
    Debug: folder(debugGroup(d), CLOSED),
  };
}
