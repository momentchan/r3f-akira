import { useEffect, useRef, useState } from 'react';
import {
  FLOW_TIME_MAX,
  FLOW_TIME_MIN,
} from '../../components/plants/lifecycle/usePlantTimeScale';
import { useExperienceStore } from '../../core/experienceStore';
import './flowTimeRail.css';

const IDLE_MS = 2800;
const UNIT_1 = (1 - FLOW_TIME_MIN) / (FLOW_TIME_MAX - FLOW_TIME_MIN);

/**
 * Shared simulation-time control. FLOW can also write it from pointer Y;
 * EXPLORE leaves it alone so orbit gestures never change plant time.
 */
export function FlowTimeRail() {
  const isStarted = useExperienceStore((state) => state.isStarted);
  const plantTimeScale = useExperienceStore((state) => state.plantTimeScale);
  const plantTimeTarget = useExperienceStore((state) => state.plantTimeTarget);
  const setPlantTimeTarget = useExperienceStore(
    (state) => state.setPlantTimeTarget,
  );
  const isTimeScrubbing = useExperienceStore(
    (state) => state.isTimeScrubbing,
  );
  const setTimeScrubbing = useExperienceStore(
    (state) => state.setTimeScrubbing,
  );
  const flowIntroDone = useExperienceStore((state) => state.flowIntroDone);
  const [liveOn, setLiveOn] = useState(false);
  const prevScale = useRef(plantTimeScale);
  const hideTimer = useRef(0);
  const dragging = useRef(false);

  const visible = isStarted && flowIntroDone;

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
  const writeFromClientY = (clientY, track) => {
    const rect = track.getBoundingClientRect();
    const unit = Math.min(
      1,
      Math.max(0, (rect.bottom - clientY) / Math.max(rect.height, 1)),
    );
    setPlantTimeTarget(FLOW_TIME_MIN + span * unit);
  };

  const finishScrub = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setTimeScrubbing(false);
  };

  const onTrackKeyDown = (event) => {
    const step = event.shiftKey ? 1 : 0.25;
    let next = plantTimeTarget;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next += step;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next -= step;
    else if (event.key === 'Home') next = FLOW_TIME_MIN;
    else if (event.key === 'End') next = FLOW_TIME_MAX;
    else return;
    event.preventDefault();
    setPlantTimeTarget(Math.min(FLOW_TIME_MAX, Math.max(FLOW_TIME_MIN, next)));
  };

  return (
    <div
      className={visible ? 'flow-time-rail flow-time-rail--visible' : 'flow-time-rail'}
      aria-hidden={!visible}
    >
      <span className="flow-time-rail__title">TIME</span>
      <div
        className={
          isTimeScrubbing
            ? 'flow-time-rail__track flow-time-rail__track--dragging'
            : 'flow-time-rail__track'
        }
        role="slider"
        aria-label="Simulation speed"
        aria-orientation="vertical"
        aria-valuemin={FLOW_TIME_MIN}
        aria-valuemax={FLOW_TIME_MAX}
        aria-valuenow={Number(plantTimeTarget.toFixed(2))}
        aria-valuetext={`${plantTimeTarget.toFixed(1)} times speed`}
        tabIndex={visible ? 0 : -1}
        onKeyDown={onTrackKeyDown}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dragging.current = true;
          setTimeScrubbing(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          writeFromClientY(event.clientY, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          event.preventDefault();
          event.stopPropagation();
          writeFromClientY(event.clientY, event.currentTarget);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          finishScrub();
        }}
        onPointerCancel={finishScrub}
        onLostPointerCapture={finishScrub}
      >
        <span className="flow-time-rail__mark" style={{ bottom: '100%' }}>×8</span>
        <span className="flow-time-rail__mark" style={{ bottom: `${UNIT_1 * 100}%` }}>×1</span>
        <span className="flow-time-rail__mark" style={{ bottom: '0%' }}>×0</span>
        <span
          className="flow-time-rail__tick"
          style={{ bottom: `${t * 100}%` }}
        >
          <span
            className={
              liveOn || isTimeScrubbing
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
