import { stableRandomRange } from '@core';

const SALT_REST = 0;
const SALT_GROW = 1;
const SALT_HOLD = 2;
const SALT_RETRACT = 3;
const GENERATION_SEED_STEP = 131;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

const FLOWER_SCALE_IN = 0.25;

function budScaleIn(x) {
  return Math.max(0, easeOutBack(Math.min(x / FLOWER_SCALE_IN, 1)));
}

function initialPhaseFraction(seed) {
  const value = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/** Stable numeric seed for lifecycle owners identified by a string or number. */
export function hashLifecycleIdentity(identity) {
  let hash = 2166136261;
  const value = String(identity);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function lifecycleLength(durations) {
  return durations.delay + durations.grow + durations.keep + durations.die;
}

/** Seeded durations for rest -> grow -> hold -> retract. */
export function computeDurations(seed, ranges) {
  return {
    delay: stableRandomRange(seed, SALT_REST, 0, ranges.delay[0], ranges.delay[1]),
    grow: stableRandomRange(seed, SALT_GROW, 0, ranges.grow[0], ranges.grow[1]),
    keep: stableRandomRange(seed, SALT_HOLD, 0, ranges.keep[0], ranges.keep[1]),
    die: stableRandomRange(seed, SALT_RETRACT, 0, ranges.die[0], ranges.die[1]),
  };
}

function generationSeed(state) {
  const generation = state.rerollEachGeneration
    ? state.generation * GENERATION_SEED_STEP
    : 0;
  return state.seed + generation;
}

/**
 * Create a mutable lifecycle clock. `initialStagger` adds a deterministic
 * pre-growth wait; it never mounts an organism partially grown.
 */
export function createLifecycleState({
  seed,
  ranges,
  initialStagger = 0,
  rerollEachGeneration = true,
}) {
  const durations = computeDurations(seed, ranges);
  const stagger = Math.max(initialStagger, 0);
  return {
    age: -initialPhaseFraction(seed) * lifecycleLength(durations) * stagger,
    generation: 0,
    seed,
    rerollEachGeneration,
    durations,
  };
}

/**
 * Re-derive durations from current ranges without disturbing progress, so a
 * timing change applies to living organisms without rebuilding any geometry.
 */
export function applyLifecycleRanges(state, ranges) {
  state.durations = computeDurations(generationSeed(state), ranges);
  return state;
}

/** Preserve a clock across geometry rebuilds while applying current ranges. */
export function restoreLifecycleProgress(state, previous, ranges) {
  if (!previous) return state;
  state.age = previous.age;
  state.generation = previous.generation;
  return applyLifecycleRanges(state, ranges);
}

/**
 * Map lifecycle age to generic organism growth.
 *
 * `petalShedFrac` > 0 reserves that fraction of `die` for the flower to drop its
 * petals while the stem still stands. `shedOverlap` then decides how much of that
 * the stem joins in on: 0 = the stem waits for every petal (staged), 1 = it starts
 * retracting the moment petals begin to leave (simultaneous).
 */
export function computeGrowthLifecycle(
  age,
  durations,
  petalShedFrac = 0,
  shedOverlap = 0,
) {
  const { delay, grow, keep, die } = durations;
  const lifetime = lifecycleLength(durations);
  const growEnd = delay + grow;
  const keepEnd = growEnd + keep;

  if (age < delay) return { growth: 0, phase: 'rest', lifetime };
  if (age < growEnd) {
    return {
      growth: easeOutCubic((age - delay) / Math.max(grow, 1e-6)),
      phase: 'grow',
      lifetime,
    };
  }
  if (age < keepEnd) return { growth: 1, phase: 'hold', lifetime };

  const dieProgress = (age - keepEnd) / Math.max(die, 1e-6);
  const shedFrac = Math.min(Math.max(petalShedFrac, 0), 0.95);
  if (shedFrac > 0) {
    // Pull the stem's exit earlier into the shed as overlap rises.
    const overlap = Math.min(Math.max(shedOverlap, 0), 1);
    const retractStart = shedFrac * (1 - overlap);
    if (dieProgress < retractStart) return { growth: 1, phase: 'shed', lifetime };
    const retract = (dieProgress - retractStart) / Math.max(1 - retractStart, 1e-6);
    return {
      growth: easeOutCubic(Math.max(0, 1 - retract)),
      phase: 'retract',
      lifetime,
    };
  }
  return {
    growth: easeOutCubic(Math.max(0, 1 - dieProgress)),
    phase: 'retract',
    lifetime,
  };
}

/** Advance a mutable lifecycle clock and return its generic growth state. */
export function advanceLifecycleState(state, delta, ranges) {
  state.age += Math.max(delta, 0);
  let lifetime = lifecycleLength(state.durations);

  // Frame delta is clamped by callers, but the loop also makes restored clocks
  // safe when timing ranges become shorter.
  while (lifetime > 0 && state.age >= lifetime) {
    state.age -= lifetime;
    state.generation += 1;
    state.durations = computeDurations(generationSeed(state), ranges);
    lifetime = lifecycleLength(state.durations);
  }

  if (lifetime <= 0) state.age = 0;
  return computeGrowthLifecycle(state.age, state.durations);
}

/**
 * Flower-only animation layered on top of generic organism growth.
 *
 * With `petalShed`, death stops rewinding the bloom: the head stays fully open at
 * full size and `shed` runs 0→1 instead, so the petal shader can shrink each petal
 * about its own centre and lift it away. The stem still retracts as usual.
 */
export function computeBloomLifecycle(
  age,
  durations,
  bloomFrac,
  bloomStart,
  petalShedFrac = 0,
) {
  const { delay, grow, keep, die } = durations;
  const growEnd = delay + grow;
  const keepEnd = growEnd + keep;
  const bf = Math.min(Math.max(bloomFrac, 0), 0.5);
  const bs = Math.min(Math.max(bloomStart, 0), 1);

  let flowerScale;
  if (age < delay) flowerScale = 0;
  else if (age < growEnd) {
    flowerScale = budScaleIn((age - delay) / Math.max(grow, 1e-6));
  } else if (age < keepEnd) flowerScale = 1;
  else flowerScale = budScaleIn(1 - (age - keepEnd) / Math.max(die, 1e-6));

  const shedFrac = Math.min(Math.max(petalShedFrac, 0), 0.95);
  const shedding = shedFrac > 0;

  const openStart = delay + bs * grow;
  const openEnd = growEnd + bf * keep;
  const closeStart = keepEnd - bf * keep;
  const closeEnd = keepEnd + (1 - bs) * die;
  let flowerFrame;
  if (age < openStart) flowerFrame = 0;
  else if (age < openEnd) {
    flowerFrame = (age - openStart) / Math.max(openEnd - openStart, 1e-6);
  } else if (shedding) {
    // Never rewind the bloom when petals shed. The close normally begins at
    // closeStart (before keepEnd), so forcing "fully open" at keepEnd instead
    // would snap the flower back open — a visible pop right as the shed starts.
    flowerFrame = 1;
  } else if (age < closeStart) flowerFrame = 1;
  else if (age < closeEnd) {
    flowerFrame = 1 - (age - closeStart) / Math.max(closeEnd - closeStart, 1e-6);
  } else flowerFrame = 0;

  let shed = 0;
  if (shedding && age >= keepEnd) {
    const dieProgress = (age - keepEnd) / Math.max(die, 1e-6);
    shed = Math.min(Math.max(dieProgress / shedFrac, 0), 1);
    // Hold the head at full size — the petals do the disappearing, and the stem
    // only starts retracting once they are gone.
    flowerScale = 1;
  }

  return { flowerFrame, flowerScale, shed };
}

/** Compatibility API for standalone flower stems. */
export function computeLifecycle(age, durations, bloomFrac, bloomStart) {
  const growthState = computeGrowthLifecycle(age, durations);
  const bloomState = computeBloomLifecycle(age, durations, bloomFrac, bloomStart);
  return {
    stemGrow: growthState.growth,
    ...bloomState,
    phase: growthState.phase,
    lifetime: growthState.lifetime,
  };
}
