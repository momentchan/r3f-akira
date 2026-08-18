/**
 * Global simulation rate for every plant lifecycle.
 *
 * Module-level like the Space-pause ref next door, and for the same reason: the
 * flower field, the climbing tendrils and the standalone stems each run their own
 * `useFrame`, and they have to agree on how fast time is passing or they drift out
 * of sync with each other.
 *
 * Effective rate is authoredScale × debugMul. The mode director writes the
 * authored scale (FLOW envelope, EXPLORE stillness, FRAMES hold). The Sim panel
 * writes the debug multiplier so a reviewer can still 10x without stomping the
 * director.
 *
 * Scales lifecycle progress **and** the anchor-field migration, deliberately.
 * Reviewing the composition as it evolves means watching ~180s for six flower
 * generations at 1x; at 10x it is 18s. If the drift stayed on the render clock the
 * fast pass would show six generations of flowers against a stationary field —
 * which is exactly the thing being reviewed.
 *
 * NOT scaled: wind sway, and nothing else that reads `clock.elapsedTime` directly.
 * Wind is ambient motion rather than simulation state, and at 10x it reads as a
 * gale rather than a fast-forward. Camera orbit is also unscaled.
 *
 * 0 is a valid value and freezes progress exactly like the Space pause, except
 * that Space is a toggle a reviewer can hit without losing the slider position.
 */

const authoredScaleRef = { current: 1 };
const debugMulRef = { current: 1 };

function finiteNonNeg(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/** Shared multiplier for lifecycle dt and field drift. Read every frame. */
export function getSimSpeed() {
  return authoredScaleRef.current * debugMulRef.current;
}

/** Mode director: FLOW envelope / EXPLORE stillness / FRAMES hold. */
export function setAuthoredSimScale(value) {
  authoredScaleRef.current = finiteNonNeg(value, 1);
}

/** Sim panel multiplier. 1 = leave the authored scale alone. */
export function setSimSpeedMul(value) {
  debugMulRef.current = finiteNonNeg(value, 1);
}

/** @deprecated Writes the debug multiplier only. Prefer setSimSpeedMul. */
export function setSimSpeed(value) {
  setSimSpeedMul(value);
}

export { authoredScaleRef, debugMulRef };
