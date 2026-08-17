import { useExperienceStore } from '../../../core/experienceStore';
import { FRAME_SHOTS } from '../cameraShots';
import { useEffect, useRef } from 'react';

/**
 * Transitions CameraControls to the active authored frame.
 */
export function useFrameCamera({ controlsRef, enabled, frameIndex }) {
  const setStillness = useExperienceStore((state) => state.setStillness);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    const shot = FRAME_SHOTS[frameIndex];
    if (!shot) return undefined;

    let cancelled = false;
    requestRef.current += 1;
    const request = requestRef.current;

    const go = async (controls) => {
      setStillness(0.35);
      const prevSmooth = controls.smoothTime;
      controls.smoothTime = shot.transitionDuration ?? 2.2;
      try {
        await controls.setLookAt(
          shot.position[0],
          shot.position[1],
          shot.position[2],
          shot.target[0],
          shot.target[1],
          shot.target[2],
          true,
        );
      } catch {
        // Interrupted by a mode change or another frame.
      } finally {
        if (controls.smoothTime === shot.transitionDuration) {
          controls.smoothTime = prevSmooth;
        }
      }
      if (cancelled || request !== requestRef.current) return;
      if (shot.fov != null && controls.camera) {
        controls.camera.fov = shot.fov;
        controls.camera.updateProjectionMatrix();
      }
      setStillness(1);
    };

    const controls = controlsRef.current;
    if (controls) {
      go(controls);
    } else {
      const id = window.setInterval(() => {
        if (cancelled) {
          window.clearInterval(id);
          return;
        }
        const next = controlsRef.current;
        if (next) {
          window.clearInterval(id);
          go(next);
        }
      }, 50);
    }

    return () => {
      cancelled = true;
      requestRef.current += 1;
      controlsRef.current?.stop?.();
    };
  }, [controlsRef, enabled, frameIndex, setStillness]);
}
