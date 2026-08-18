export const CAMERA_MODE = {
  Flow: 'flow',
  Explore: 'explore',
};

export const CAMERA_MODE_LABELS = {
  [CAMERA_MODE.Flow]: 'FLOW',
  [CAMERA_MODE.Explore]: 'EXPLORE',
};

export function getInitialCameraMode() {
  return CAMERA_MODE.Flow;
}
