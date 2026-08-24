/**
 * Shared plant-time rate. Field and climb multiply dt by getSimSpeed().
 * Wind and camera stay on the render clock.
 *
 * Three writers, so three values:
 *   authored — camera / intro (usePlantTimeScale)
 *   debugMul — Leva simSpeed ×
 *   paused   — Space; a flag so unpause does not wipe the other two
 */

let authoredScale = 0;
let debugMul = 1;
let paused = false;

function finiteNonNeg(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function getSimSpeed() {
  if (paused) return 0;
  return authoredScale * debugMul;
}

export function toggleSimPause() {
  paused = !paused;
}

export function setAuthoredSimScale(value) {
  authoredScale = finiteNonNeg(value, 1);
}

export function setSimSpeedMul(value) {
  debugMul = finiteNonNeg(value, 1);
}
