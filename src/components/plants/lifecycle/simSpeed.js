/**
 * Global simulation rate for every plant lifecycle.
 *
 * Module-level like the Space-pause ref next door, and for the same reason: the
 * flower field, the climbing tendrils and the standalone stems each run their own
 * `useFrame`, and they have to agree on how fast time is passing or they drift out
 * of sync with each other.
 *
 * Scales lifecycle progress **and** the anchor-field migration, deliberately.
 * Reviewing the composition as it evolves means watching ~180s for six flower
 * generations at 1x; at 10x it is 18s. If the drift stayed on the render clock the
 * fast pass would show six generations of flowers against a stationary field —
 * which is exactly the thing being reviewed.
 *
 * NOT scaled: wind sway, and nothing else that reads `clock.elapsedTime` directly.
 * Wind is ambient motion rather than simulation state, and at 10x it reads as a
 * gale rather than a fast-forward.
 *
 * 0 is a valid value and freezes progress exactly like the Space pause, except
 * that Space is a toggle a reviewer can hit without losing the slider position.
 */
const simSpeedRef = { current: 1 };

/** Shared multiplier for lifecycle dt and field drift. Read every frame. */
export function getSimSpeed() {
  return simSpeedRef.current;
}

export function setSimSpeed(value) {
  // Guard against NaN from a half-typed leva field, which would otherwise poison
  // every accumulated age in the scene and require a reload to clear.
  simSpeedRef.current = Number.isFinite(value) ? Math.max(0, value) : 1;
}

export { simSpeedRef };
