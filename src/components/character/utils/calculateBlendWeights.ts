/**
 * Pure function for 1D Blend Tree logic.
 * Maps speed + rotation intent -> target weights for Idle / Walk / Run / Back.
 */

export interface BlendWeights {
  idle: number;
  walk: number;
  run: number;
  back: number;
}

export function calculateBlendWeights(
  speed: number, // Signed speed (positive = forward, negative = backward)
  isRotating: boolean,
  walkSpeed: number,
  runSpeed: number,
  backSpeed: number,
): BlendWeights {
  const absSpeed = Math.abs(speed);
  const isStationary = absSpeed < 0.05;

  // Stationary rotation: light walk blend to simulate stepping while turning
  if (isStationary && isRotating) {
    return { idle: 0.3, walk: 0.7, run: 0, back: 0 };
  }

  let idle = 0;
  let walk = 0;
  let run = 0;
  let back = 0;

  if (speed < 0) {
    const t = Math.min(absSpeed / backSpeed, 1.0);
    idle = 1 - t;
    back = t;
  } else if (speed <= walkSpeed) {
    const t = absSpeed / walkSpeed;
    idle = 1 - t;
    walk = t;
  } else {
    const t = (absSpeed - walkSpeed) / (runSpeed - walkSpeed);
    const clampT = Math.min(Math.max(t, 0), 1);
    walk = 1 - clampT;
    run = clampT;
  }

  return { idle, walk, run, back };
}
