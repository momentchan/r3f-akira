import { useExperienceStore } from '../../../core/experienceStore';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three/webgpu';

const MOVE_SPEED_EPS = 0.045;
const SETTLE_START = 1.0;
const SETTLE_FULL = 3.4;

/**
 * Explore-only stillness: visitor orbit/zoom, not CameraControls damping noise.
 * 0 = looking around, 1 = sustained rest.
 */
export function useExploreStillness({ controlsRef, enabled }) {
  const setStillness = useExperienceStore((state) => state.setStillness);
  const prevPos = useRef(new THREE.Vector3());
  const prevTarget = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  const idleTime = useRef(0);
  const smoothness = useRef(0);
  const primed = useRef(false);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!enabled || !controls) {
      primed.current = false;
      return;
    }

    const dt = Math.min(delta, 0.08);
    controls.getPosition(pos.current);
    controls.getTarget(target.current);

    if (!primed.current) {
      prevPos.current.copy(pos.current);
      prevTarget.current.copy(target.current);
      primed.current = true;
      idleTime.current = 0;
      smoothness.current = 0;
      setStillness(0);
      return;
    }

    const speed =
      (pos.current.distanceTo(prevPos.current) +
        target.current.distanceTo(prevTarget.current)) /
      Math.max(dt, 1 / 120);

    prevPos.current.copy(pos.current);
    prevTarget.current.copy(target.current);

    if (speed > MOVE_SPEED_EPS) {
      idleTime.current = 0;
    } else {
      idleTime.current += dt;
    }

    const raw = THREE.MathUtils.smoothstep(
      idleTime.current,
      SETTLE_START,
      SETTLE_FULL,
    );
    smoothness.current = THREE.MathUtils.damp(
      smoothness.current,
      raw,
      raw > smoothness.current ? 1.8 : 4.5,
      dt,
    );
    setStillness(smoothness.current);
  });
}
