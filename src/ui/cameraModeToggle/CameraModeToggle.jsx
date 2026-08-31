import {
  CAMERA_MODE,
  EXPLORE_PROFILE,
} from '../../components/camera/cameraModes';
import { useExperienceStore } from '../../core/experienceStore';

export function CameraModeToggle() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const flowIntroDone = useExperienceStore((state) => state.flowIntroDone);
  const cameraMode = useExperienceStore((state) => state.cameraMode);
  const setCameraMode = useExperienceStore((state) => state.setCameraMode);
  const setExploreProfile = useExperienceStore(
    (state) => state.setExploreProfile,
  );

  if (!isStarted) return null;

  const visible = flowIntroDone;

  const chooseFlow = () => setCameraMode(CAMERA_MODE.Flow);
  const chooseExplore = () => {
    setExploreProfile(EXPLORE_PROFILE.Public);
    setCameraMode(CAMERA_MODE.Explore);
  };

  return (
    <div
      className={
        visible
          ? 'hud-control-row hud-control-row--deferred hud-control-row--deferred--visible camera-mode-toggle'
          : 'hud-control-row hud-control-row--deferred camera-mode-toggle'
      }
      role="group"
      aria-label="Camera mode"
      aria-hidden={!visible}
    >
      <span className="hud-control-row__title">CAMERA</span>
      <div className="hud-control-row__options">
        <button
          type="button"
          className={
            cameraMode === CAMERA_MODE.Flow
              ? 'hud-control-row__mode hud-control-row__mode--on'
              : 'hud-control-row__mode'
          }
          aria-pressed={cameraMode === CAMERA_MODE.Flow}
          tabIndex={visible ? 0 : -1}
          onClick={chooseFlow}
        >
          FLOW
        </button>
        <span className="hud-control-row__rule" aria-hidden="true" />
        <button
          type="button"
          className={
            cameraMode === CAMERA_MODE.Explore
              ? 'hud-control-row__mode hud-control-row__mode--on'
              : 'hud-control-row__mode'
          }
          aria-pressed={cameraMode === CAMERA_MODE.Explore}
          tabIndex={visible ? 0 : -1}
          onClick={chooseExplore}
        >
          EXPLORE
        </button>
      </div>
    </div>
  );
}
