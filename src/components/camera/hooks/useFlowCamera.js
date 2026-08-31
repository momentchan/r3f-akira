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

/**
 * 0→1 with rest + flat accel at the start (quartic), slope v1 at the end.
 * Flatter than a cubic ease-in so the first seconds barely yaw, then catch
 * FLOW orbitSpeed at handoff.
 */
function easeInRest(u, v1) {
  const u3 = u * u * u;
  return (4 - v1) * u3 + (v1 - 3) * u3 * u;
}

const WHEEL_TO_RADIUS = 0.0025;
const INTRO_DURATION = 20;
const INTRO_TURNS = Math.PI * 2;
const REJOIN_DURATION = 2.2;

function nearestEquivalentAngle(angle, reference) {
  const turn = Math.PI * 2;
  return angle + Math.round((reference - angle) / turn) * turn;
}

function applyLookAt(controls, angle, radius, height, target, rejoin, weight) {
  const look = Array.isArray(target) ? target : CAMERA_DEFAULTS.target;
  const pos = pointOnOrbit(angle, radius, height, look);
  const camera = controls.camera;
  if (camera) camera.up.set(0, 1, 0);
  controls.setLookAt(
    pos[0],
    pos[1],
    pos[2],
    look[0] + rejoin.targetOffset.x * weight,
    look[1] + rejoin.targetOffset.y * weight,
    look[2] + rejoin.targetOffset.z * weight,
    false,
  );
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
  smoothResume = false,
}) {
  const setStillness = useExperienceStore((state) => state.setStillness);
  const setFlowIntroDone = useExperienceStore((state) => state.setFlowIntroDone);
  const angleRef = useRef(startAngle);
  const liveRadiusRef = useRef(radius);
  const smoothRadiusRef = useRef(radius);
  const introDoneRef = useRef(false);
  const introRef = useRef({
    p: 0,
    endSlope: 0.2,
  });
  const wasEnabledRef = useRef(enabled);
  const rejoinRef = useRef({
    active: false,
    elapsed: 0,
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    targetOffset: new THREE.Vector3(),
    radiusOffset: 0,
    heightOffset: 0,
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
    const wasEnabled = wasEnabledRef.current;
    wasEnabledRef.current = enabled;

    if (!enabled) {
      rejoinRef.current.active = false;
      return;
    }
    if (
      wasEnabled ||
      !isStarted ||
      !smoothResume ||
      !introDoneRef.current
    ) {
      return;
    }

    const controls = controlsRef.current;
    if (!controls) return;
    const look = Array.isArray(target) ? target : CAMERA_DEFAULTS.target;
    const rejoin = rejoinRef.current;
    controls.getPosition(rejoin.position);
    controls.getTarget(rejoin.target);

    const dx = rejoin.position.x - look[0];
    const dz = rejoin.position.z - look[2];
    const horizontalRadius = Math.hypot(dx, dz);
    if (horizontalRadius > 1e-5) {
      const currentAzimuth = Math.atan2(dx, dz);
      angleRef.current = nearestEquivalentAngle(
        currentAzimuth,
        angleRef.current,
      );
    }

    const radiusWave = alongPath(
      angleRef.current,
      radiusAmp,
      radiusCycles,
    );
    const nextRadius = THREE.MathUtils.clamp(
      horizontalRadius - radiusWave,
      radiusMin,
      radiusMax,
    );
    liveRadiusRef.current = nextRadius;
    smoothRadiusRef.current = nextRadius;

    const authoredRadius = Math.max(radiusMin, nextRadius + radiusWave);
    const authoredHeight =
      height + alongPath(angleRef.current, heightAmp, heightCycles);
    rejoin.radiusOffset = horizontalRadius - authoredRadius;
    rejoin.heightOffset = rejoin.position.y - look[1] - authoredHeight;
    rejoin.targetOffset.set(
      rejoin.target.x - look[0],
      rejoin.target.y - look[1],
      rejoin.target.z - look[2],
    );
    rejoin.elapsed = 0;
    rejoin.active = true;
  }, [
    controlsRef,
    enabled,
    height,
    heightAmp,
    heightCycles,
    isStarted,
    radiusAmp,
    radiusCycles,
    radiusMax,
    radiusMin,
    smoothResume,
    target,
  ]);

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
        setFlowIntroDone(true);
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
    setFlowIntroDone(true);
    return undefined;
  }, [enabled, isStarted, setFlowIntroDone]);

  useEffect(() => {
    if (!enabled || !isStarted) return undefined;

    const pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartRadius = 0;

    const pinchDist = () => {
      const pts = [...pointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    const onWheel = (event) => {
      if (!introDoneRef.current) return;
      event.preventDefault();
      const next = liveRadiusRef.current + event.deltaY * WHEEL_TO_RADIUS;
      liveRadiusRef.current = THREE.MathUtils.clamp(next, radiusMin, radiusMax);
    };

    const onPointerDown = (event) => {
      if (event.pointerType === 'mouse') return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        pinchStartDist = pinchDist();
        pinchStartRadius = liveRadiusRef.current;
      }
    };

    const onPointerMove = (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!introDoneRef.current || pointers.size !== 2 || pinchStartDist < 1) {
        return;
      }
      event.preventDefault();
      const scale = pinchDist() / pinchStartDist;
      if (scale < 1e-3) return;
      // Pinch out → closer (smaller radius), matching wheel-up.
      liveRadiusRef.current = THREE.MathUtils.clamp(
        pinchStartRadius / scale,
        radiusMin,
        radiusMax,
      );
    };

    const onPointerUp = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size === 2) {
        pinchStartDist = pinchDist();
        pinchStartRadius = liveRadiusRef.current;
        return;
      }
      pinchStartDist = 0;
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
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
    let rejoinWeight = 0;

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
        startAngle + INTRO_TURNS * easeInRest(u, intro.endSlope);
    } else {
      restH = height;
      amp = 1;
      let liveOrbitSpeed = orbitSpeed;
      const rejoin = rejoinRef.current;
      if (rejoin.active) {
        rejoin.elapsed += dt;
        const p = THREE.MathUtils.clamp(
          rejoin.elapsed / REJOIN_DURATION,
          0,
          1,
        );
        const eased = sineInOut(p);
        rejoinWeight = 1 - eased;
        liveOrbitSpeed *= eased;
        if (p >= 1) rejoin.active = false;
      }
      angleRef.current += liveOrbitSpeed * dt;
      smoothRadiusRef.current = THREE.MathUtils.damp(
        smoothRadiusRef.current,
        liveRadiusRef.current,
        6,
        dt,
      );
      restR = smoothRadiusRef.current;
    }

    const rejoin = rejoinRef.current;
    const elev =
      restH +
      alongPath(angleRef.current, heightAmp, heightCycles) * amp +
      rejoin.heightOffset * rejoinWeight;
    const swirl = restR + alongPath(angleRef.current, radiusAmp, radiusCycles) * amp;
    const r =
      (done ? Math.max(radiusMin, swirl) : Math.max(0, swirl)) +
      rejoin.radiusOffset * rejoinWeight;
    applyLookAt(
      controls,
      angleRef.current,
      r,
      elev,
      target,
      rejoin,
      rejoinWeight,
    );
  });
}
