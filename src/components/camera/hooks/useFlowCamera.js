import { useExperienceStore } from '../../../core/experienceStore';
import { FLOW_LOOP_FROM, FLOW_SHOTS } from '../cameraShots';
import { useEffect, useRef } from 'react';

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

async function lookAtShot(controls, shot, duration, signal) {
  const prevSmooth = controls.smoothTime;
  controls.smoothTime = duration;
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
    // CameraControls rejects if interrupted.
  } finally {
    if (controls.smoothTime === duration) controls.smoothTime = prevSmooth;
  }
  if (shot.fov != null && controls.camera) {
    controls.camera.fov = shot.fov;
    controls.camera.updateProjectionMatrix();
  }
  return !signal.aborted;
}

/**
 * Authored drifting attention. Owns CameraControls while FLOW is active.
 */
export function useFlowCamera({
  controlsRef,
  enabled,
  shots = FLOW_SHOTS,
  loopFrom = FLOW_LOOP_FROM,
  restartKey = 0,
}) {
  const setStillness = useExperienceStore((state) => state.setStillness);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    const abort = new AbortController();
    generationRef.current += 1;
    const generation = generationRef.current;
    let running = true;
    const path = shots.length ? shots : FLOW_SHOTS;
    const loopStart = Math.min(loopFrom, path.length);

    const run = async (controls) => {
      let pass = 0;
      while (running && generation === generationRef.current) {
        const start = pass === 0 ? 0 : loopStart;
        for (let i = start; i < path.length; i += 1) {
          const shot = path[i];
          if (!running || abort.signal.aborted) return;
          setStillness(0.85);
          const moved = await lookAtShot(
            controls,
            shot,
            shot.duration ?? 6,
            abort.signal,
          );
          if (!moved || abort.signal.aborted) return;
          const hold = shot.holdDuration ?? 0;
          if (hold > 0) {
            setStillness(1);
            await sleep(hold * 1000, abort.signal);
          }
        }
        pass += 1;
      }
    };

    const waitForControls = () => {
      const controls = controlsRef.current;
      if (controls) {
        run(controls);
        return;
      }
      const id = window.setInterval(() => {
        if (!running) {
          window.clearInterval(id);
          return;
        }
        const next = controlsRef.current;
        if (next) {
          window.clearInterval(id);
          run(next);
        }
      }, 50);
    };

    waitForControls();

    return () => {
      running = false;
      abort.abort();
      generationRef.current += 1;
      controlsRef.current?.stop?.();
    };
  }, [controlsRef, enabled, loopFrom, restartKey, setStillness, shots]);
}
