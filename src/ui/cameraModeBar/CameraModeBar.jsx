import { CAMERA_MODE, CAMERA_MODE_LABELS } from '../../components/camera/cameraModes';
import { FRAME_SHOTS } from '../../components/camera/cameraShots';
import { useExperienceStore } from '../../core/experienceStore';
import { useEffect } from 'react';
import './cameraModeBar.css';

const MODES = [CAMERA_MODE.Flow, CAMERA_MODE.Explore, CAMERA_MODE.Frames];

export function CameraModeBar() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const cameraMode = useExperienceStore((state) => state.cameraMode);
  const setCameraMode = useExperienceStore((state) => state.setCameraMode);
  const frameIndex = useExperienceStore((state) => state.frameIndex);
  const nextFrame = useExperienceStore((state) => state.nextFrame);
  const prevFrame = useExperienceStore((state) => state.prevFrame);

  useEffect(() => {
    if (!isStarted || cameraMode !== CAMERA_MODE.Frames) return undefined;
    const onKey = (event) => {
      if (event.key === 'ArrowRight') nextFrame();
      if (event.key === 'ArrowLeft') prevFrame();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStarted, cameraMode, nextFrame, prevFrame]);

  if (!isStarted) return null;

  return (
    <div className="camera-mode-bar">
      <div className="camera-mode-bar__modes">
        {MODES.map((mode, index) => (
          <span key={mode}>
            {index > 0 ? <span className="camera-mode-bar__dot">·</span> : null}
            <button
              type="button"
              className={
                cameraMode === mode
                  ? 'camera-mode-bar__mode camera-mode-bar__mode--active'
                  : 'camera-mode-bar__mode'
              }
              onClick={() => setCameraMode(mode)}
            >
              {CAMERA_MODE_LABELS[mode]}
            </button>
          </span>
        ))}
      </div>
      {cameraMode === CAMERA_MODE.Frames ? (
        <div className="camera-mode-bar__frames">
          <button type="button" onClick={prevFrame} aria-label="Previous frame">
            ‹
          </button>
          <span>
            {String(frameIndex + 1).padStart(2, '0')} / {String(FRAME_SHOTS.length).padStart(2, '0')}
          </span>
          <button type="button" onClick={nextFrame} aria-label="Next frame">
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
