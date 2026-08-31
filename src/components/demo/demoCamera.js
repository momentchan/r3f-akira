/**
 * Locked pose for article demo captures. Position + look-at in world space
 * (same space as Canvas camera; field group is at y = -1).
 *
 * Frame with orbit (demos start in Explore). Then Camera → logLookAt, paste
 * here, and set LOCK_DEMO_CAMERA to true.
 */
export const LOCK_DEMO_CAMERA = false;

export const DEMO_CAMERA = {
  fov: 45,
  position: [-0.4853, 7.576, -0.4144],
  target: [-0.4853, 0.0064, -0.4144],
};


// export const DEMO_CAMERA = {
//   fov: 45,
//   position: [-1.1263, 0.4506, -0.876],
//   target: [-0.0338, -0.3292, -0.6046],
// };
