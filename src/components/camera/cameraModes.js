import { isDebugRoute } from '../../core/debugRoute';

export const CAMERA_MODE = {
  Flow: 'flow',
  Explore: 'explore',
  Frames: 'frames',
};

export const CAMERA_MODE_LABELS = {
  [CAMERA_MODE.Flow]: 'FLOW',
  [CAMERA_MODE.Explore]: 'EXPLORE',
  [CAMERA_MODE.Frames]: 'FRAMES',
};

export function getInitialCameraMode() {
  return isDebugRoute() ? CAMERA_MODE.Explore : CAMERA_MODE.Flow;
}

