/**
 * Shared plant-time rate: authoredScale × debugMul.
 * Module-level so field, climb, and stems read the same value each frame.
 * Scales lifecycle and field drift. Wind and camera stay on the render clock.
 */

const authoredScaleRef = { current: 0 };
const debugMulRef = { current: 1 };

function finiteNonNeg(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function getSimSpeed() {
  return authoredScaleRef.current * debugMulRef.current;
}

export function setAuthoredSimScale(value) {
  authoredScaleRef.current = finiteNonNeg(value, 1);
}

export function setSimSpeedMul(value) {
  debugMulRef.current = finiteNonNeg(value, 1);
}
