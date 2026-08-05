import { stableRandomRange } from '@core';

// Pure, React-free phase machine for a flower's life:
//   delay → grow → keep → die → (loop)
// Ported from the lifecycle model in momentchan/false-earth's vatCompute.ts,
// but run on the CPU per-stem instead of in a compute shader.

// Distinct salt per phase so each duration draws an independent seeded stream.
const SALT_DELAY = 0;
const SALT_GROW = 1;
const SALT_KEEP = 2;
const SALT_DIE = 3;

// easeOutCubic — fast start, gentle settle (used for grow + retract).
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// easeOutBack — slight overshoot "pop" for the bloom scale.
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Fraction of grow (in) / die (out) over which the bud pops to / from full size.
const FLOWER_SCALE_IN = 0.25;

// Bud visibility pop: 0 → 1 over the first FLOWER_SCALE_IN of a normalized ramp.
function budScaleIn(x) {
  return Math.max(0, easeOutBack(Math.min(x / FLOWER_SCALE_IN, 1)));
}

/**
 * Randomize each phase duration (seconds) from a [min, max] window using the
 * stem's seed — mirrors the reference's `mix(min, max, seed)` per phase.
 *
 * @param {number} seed   per-stem seed
 * @param {{delay:[number,number], grow:[number,number], keep:[number,number], die:[number,number]}} ranges
 * @returns {{delay:number, grow:number, keep:number, die:number}}
 */
export function computeDurations(seed, ranges) {
  return {
    delay: stableRandomRange(seed, SALT_DELAY, 0, ranges.delay[0], ranges.delay[1]),
    grow: stableRandomRange(seed, SALT_GROW, 0, ranges.grow[0], ranges.grow[1]),
    keep: stableRandomRange(seed, SALT_KEEP, 0, ranges.keep[0], ranges.keep[1]),
    die: stableRandomRange(seed, SALT_DIE, 0, ranges.die[0], ranges.die[1]),
  };
}

/**
 * Map an accumulated age to the stem+flower state. Growth and bloom OVERLAP:
 *
 *   age →   delay      grow                    keep                    die
 *        ├────────┼──────────────┼──────────────────────────────┼──────────────┤
 *   STEM   (hide)   rises 0 → 1     ████████ held at 1 ████████    retract 1 → 0
 *   FLOWER (hide)   bud ···►opens ───────► hold ───────► closes ···►(closed) shrink
 *                       ▲ bloomStart·grow                        ▲ into die
 *
 * The bud starts opening WHILE the stem is still growing — the open window begins
 * at `bloomStart` of grow, crosses the grow→keep boundary, and finishes inside
 * keep. The close mirrors it: it begins inside keep and finishes during die as the
 * stem retracts. `bloomFrac` sets how deep into keep the open/close reach (their
 * speed, since keep is long); `bloomStart` sets the overlap — 1 = no overlap
 * (open begins exactly at the top of growth), lower = more overlap on both ends.
 * Zero-duration phases divide safely because each boundary check excludes them.
 *
 * @param {number} age        accumulated seconds within [0, lifetime)
 * @param {{delay:number, grow:number, keep:number, die:number}} durations
 * @param {number} bloomFrac  how far into KEEP the open (and close) reach — max 0.5
 * @param {number} bloomStart grow fraction at which the flower begins to open (overlap)
 * @returns {{stemGrow:number, flowerFrame:number, flowerScale:number, phase:string, lifetime:number}}
 */
export function computeLifecycle(age, durations, bloomFrac, bloomStart) {
  const { delay, grow, keep, die } = durations;
  const lifetime = delay + grow + keep + die;
  const growEnd = delay + grow;
  const keepEnd = growEnd + keep;
  const bf = Math.min(Math.max(bloomFrac, 0), 0.5); // open + close must fit in keep
  const bs = Math.min(Math.max(bloomStart, 0), 1); // where in grow the open begins

  // ── STEM: rise → hold → retract ────────────────────────────────────
  let stemGrow;
  let phase;
  if (age < delay) {
    stemGrow = 0;
    phase = 'delay';
  } else if (age < growEnd) {
    stemGrow = easeOutCubic((age - delay) / grow); // 0 → 1
    phase = 'grow';
  } else if (age < keepEnd) {
    stemGrow = 1;
    phase = 'keep';
  } else {
    stemGrow = easeOutCubic(Math.max(0, 1 - (age - keepEnd) / die)); // 1 → 0
    phase = 'die';
  }

  // ── FLOWER scale: pops in with the stem, holds, shrinks as the stem retracts ──
  let flowerScale;
  if (age < delay) {
    flowerScale = 0; // hidden with the stem
  } else if (age < growEnd) {
    flowerScale = budScaleIn((age - delay) / grow); // bud pops in with the stem
  } else if (age < keepEnd) {
    flowerScale = 1;
  } else {
    flowerScale = budScaleIn(1 - (age - keepEnd) / die); // shrink as the stem retracts
  }

  // ── FLOWER frame: open overlaps grow→keep, close mirrors into keep→die ──
  const openStart = delay + bs * grow; // begins DURING grow (overlaps growth)
  const openEnd = growEnd + bf * keep; // finishes inside keep
  const closeStart = keepEnd - bf * keep; // begins inside keep
  const closeEnd = keepEnd + (1 - bs) * die; // finishes during die (mirror of open)
  let flowerFrame;
  if (age < openStart) {
    flowerFrame = 0; // visible closed bud
  } else if (age < openEnd) {
    flowerFrame = (age - openStart) / Math.max(openEnd - openStart, 1e-6); // OPEN 0→1
  } else if (age < closeStart) {
    flowerFrame = 1; // HOLD fully open
  } else if (age < closeEnd) {
    flowerFrame = 1 - (age - closeStart) / Math.max(closeEnd - closeStart, 1e-6); // CLOSE 1→0
  } else {
    flowerFrame = 0; // closed bud
  }

  return { stemGrow, flowerFrame, flowerScale, phase, lifetime };
}
