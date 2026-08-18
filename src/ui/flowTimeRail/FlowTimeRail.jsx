import { useEffect, useRef, useState } from 'react';
import { CAMERA_MODE } from '../../components/camera/cameraModes';
import {
  FLOW_TIME_MAX,
  FLOW_TIME_MIN,
} from '../../components/plants/lifecycle/usePlantTimeScale';
import { useExperienceStore } from '../../core/experienceStore';
import './flowTimeRail.css';

const IDLE_MS = 2800;
const UNIT_1 = (1 - FLOW_TIME_MIN) / (FLOW_TIME_MAX - FLOW_TIME_MIN);

/**
 * FLOW-only legend: vertical position is plant time.
 * Axis stays; the live multiplier appears only while the visitor is changing it.
 */
export function FlowTimeRail() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const cameraMode = useExperienceStore((state) => state.cameraMode);
  const plantTimeScale = useExperienceStore((state) => state.plantTimeScale);
  const flowIntroDone = useExperienceStore((state) => state.flowIntroDone);
  const [liveOn, setLiveOn] = useState(false);
  const prevScale = useRef(plantTimeScale);
  const hideTimer = useRef(0);

  const visible =
    isStarted && cameraMode === CAMERA_MODE.Flow && flowIntroDone;

  useEffect(() => {
    if (!visible) {
      setLiveOn(false);
      prevScale.current = plantTimeScale;
      return undefined;
    }
    if (Math.abs(prevScale.current - plantTimeScale) < 0.02) return undefined;
    prevScale.current = plantTimeScale;
    setLiveOn(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setLiveOn(false), IDLE_MS);
    return () => window.clearTimeout(hideTimer.current);
  }, [plantTimeScale, visible]);

  if (!isStarted) return null;

  const span = FLOW_TIME_MAX - FLOW_TIME_MIN;
  const t = Math.min(1, Math.max(0, (plantTimeScale - FLOW_TIME_MIN) / span));

  return (
    <div
      className={
        visible
          ? 'flow-time-rail flow-time-rail--visible'
          : 'flow-time-rail'
      }
      aria-hidden="true"
    >
      <span className="flow-time-rail__title">TIME</span>
      <div className="flow-time-rail__track">
        <span className="flow-time-rail__mark" style={{ bottom: '100%' }}>×8</span>
        <span className="flow-time-rail__mark" style={{ bottom: `${UNIT_1 * 100}%` }}>×1</span>
        <span className="flow-time-rail__mark" style={{ bottom: '0%' }}>×0</span>
        <span
          className="flow-time-rail__tick"
          style={{ bottom: `${t * 100}%` }}
        >
          <span
            className={
              liveOn
                ? 'flow-time-rail__live flow-time-rail__live--on'
                : 'flow-time-rail__live'
            }
          >
            {`×${plantTimeScale.toFixed(1)}`}
          </span>
        </span>
      </div>
    </div>
  );
}
