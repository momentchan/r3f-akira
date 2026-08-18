import gsap from 'gsap';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { useExperienceStore } from '../../../core/experienceStore';
import { CAMERA_DEFAULTS } from '../cameraDefaults';
import { pointOnOrbit } from '../cameraShots';

function alongPath(angle, amp, cycles) {
  return amp * Math.sin(angle * cycles);
}

function sineInOut(u) {
  return 0.5 - 0.5 * Math.cos(Math.PI * u);
}

/** Cubic from 0→1 with endpoint slopes v0 / v1 (in units of the normalized clock). */
function hermite01(u, v0, v1) {
  const u2 = u * u;
  const u3 = u2 * u;
  return 3 * u2 - 2 * u3 + v0 * (u3 - 2 * u2 + u) + v1 * (u3 - u2);
}

const WHEEL_TO_RADIUS = 0.0025;
const INTRO_DURATION = 15;
const INTRO_TURNS = Math.PI * 2;
/** Start swirl slope. Does not move the t=0 pose. */
const INTRO_START_SLOPE = 2.4;

function applyLookAt(controls, angle, radius, height, target) {
  const look = Array.isArray(target) ? target : CAMERA_DEFAULTS.target;
  const pos = pointOnOrbit(angle, radius, height, look);
  const camera = controls.camera;
  if (camera) camera.up.set(0, 1, 0);
  controls.setLookAt(pos[0], pos[1], pos[2], look[0], look[1], look[2], false);
}

/**
 * Same orbit the whole time. Intro swirls out from a near-nadir radius
 * (not 0, so startAngle can hold 頭上腳下). INTRO_TURNS only scales how far
 * we rotate after that, ending on FLOW orbitSpeed.
 */
export function useFlowCamera({
  controlsRef,
  enabled,
  isStarted = false,
  target = CAMERA_DEFAULTS.target,
  radius = CAMERA_DEFAULTS.radius,
  height = CAMERA_DEFAULTS.height,
  startAngle = CAMERA_DEFAULTS.startAngle,
  orbitSpeed = CAMERA_DEFAULTS.orbitSpeed,
  heightAmp = CAMERA_DEFAULTS.heightAmp,
  heightCycles = CAMERA_DEFAULTS.heightCycles,
  radiusAmp = CAMERA_DEFAULTS.radiusAmp,
  radiusCycles = CAMERA_DEFAULTS.radiusCycles,
  radiusMin = CAMERA_DEFAULTS.radiusMin,
  radiusMax = CAMERA_DEFAULTS.radiusMax,
  overheadHeight = CAMERA_DEFAULTS.overheadHeight,
  overheadRadius = CAMERA_DEFAULTS.overheadRadius,
  restartKey = 0,
}) {
  const setStillness = useExperienceStore((state) => state.setStillness);
  const angleRef = useRef(startAngle);
  const liveRadiusRef = useRef(radius);
  const smoothRadiusRef = useRef(radius);
  const introDoneRef = useRef(false);
  const introRef = useRef({
    p: 0,
    endSlope: 0.2,
  });

  useEffect(() => {
    liveRadiusRef.current = radius;
    smoothRadiusRef.current = radius;
  }, [radius, restartKey]);

  useEffect(() => {
    angleRef.current = startAngle;
  }, [restartKey, startAngle]);

  useEffect(() => {
    if (!enabled) return undefined;
    setStillness(1);
    controlsRef.current?.stop?.();
    return undefined;
  }, [controlsRef, enabled, setStillness]);

  useEffect(() => {
    if (!enabled || !isStarted || introDoneRef.current) return undefined;

    const intro = introRef.current;
    intro.p = 0;
    intro.endSlope = (orbitSpeed * INTRO_DURATION) / INTRO_TURNS;
    angleRef.current = startAngle;

    const tl = gsap.to(intro, {
      p: 1,
      duration: INTRO_DURATION,
      ease: 'none',
      onComplete: () => {
        introDoneRef.current = true;
        intro.p = 1;
        angleRef.current = startAngle + INTRO_TURNS;
        liveRadiusRef.current = radius;
        smoothRadiusRef.current = radius;
      },
    });

    return () => {
      tl.kill();
    };
    // Snapshot height/radius at ENTER so later Leva edits do not replay the intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isStarted]);

  useEffect(() => {
    if (enabled || !isStarted) return undefined;
    introDoneRef.current = true;
    introRef.current.p = 1;
    return undefined;
  }, [enabled, isStarted]);

  useEffect(() => {
    if (!enabled || !isStarted) return undefined;

    const onWheel = (event) => {
      if (!introDoneRef.current) return;
      event.preventDefault();
      const next = liveRadiusRef.current + event.deltaY * WHEEL_TO_RADIUS;
      liveRadiusRef.current = THREE.MathUtils.clamp(next, radiusMin, radiusMax);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [enabled, isStarted, radiusMin, radiusMax]);

  useFrame((_, delta) => {
    if (!enabled) return;
    const controls = controlsRef.current;
    if (!controls) return;

    const dt = Math.min(delta, 0.1);
    const intro = introRef.current;
    const done = introDoneRef.current;
    const parked = !isStarted && !done;

    let restH;
    let restR;
    let amp;

    if (parked) {
      restH = overheadHeight;
      restR = overheadRadius;
      amp = 0;
      angleRef.current = startAngle;
    } else if (!done) {
      const u = THREE.MathUtils.clamp(intro.p, 0, 1);
      const s = sineInOut(u);
      restH = THREE.MathUtils.lerp(overheadHeight, height, s);
      restR = THREE.MathUtils.lerp(overheadRadius, radius, s);
      amp = s;
      angleRef.current =
        startAngle + INTRO_TURNS * hermite01(u, INTRO_START_SLOPE, intro.endSlope);
    } else {
      restH = height;
      amp = 1;
      angleRef.current += orbitSpeed * dt;
      smoothRadiusRef.current = THREE.MathUtils.damp(
        smoothRadiusRef.current,
        liveRadiusRef.current,
        6,
        dt,
      );
      restR = smoothRadiusRef.current;
    }

    const elev = restH + alongPath(angleRef.current, heightAmp, heightCycles) * amp;
    const swirl = restR + alongPath(angleRef.current, radiusAmp, radiusCycles) * amp;
    const r = done ? Math.max(radiusMin, swirl) : Math.max(0, swirl);
    applyLookAt(controls, angleRef.current, r, elev, target);
  });
}
