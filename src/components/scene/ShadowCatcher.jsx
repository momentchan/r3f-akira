import { useEffect, useMemo, useState } from 'react';
import { useControls } from 'leva';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import {
  Fn, Loop, float, fwidth, max, mix, mx_noise_float,
  positionWorld, shadow, smoothstep, uniform, vec2,
} from 'three/tsl';
import { SHADOW_DEFAULTS } from './shadowDefaults';
import { SCENE_DEFAULTS } from './sceneDefaults';
import { getLiveThemeColors } from './themeTween';
import { PLANT_SHADOW_LIGHT_FLAG } from './plantShadowLayer';

/** Same look as mx_fractal_noise_float(p, 4, 2, 0.5), but 2D — that helper is vec3-only. */
const fbm2 = /*@__PURE__*/ Fn(([p]) => {
  const point = vec2(p).toVar();
  const value = float(0).toVar();
  const amplitude = float(1).toVar();
  Loop(4, () => {
    value.addAssign(amplitude.mul(mx_noise_float(point)));
    point.mulAssign(2.0);
    amplitude.mulAssign(0.5);
  });
  return value;
});

export function ShadowCatcher({
  size = 10,
  groundColor = SCENE_DEFAULTS.bgColor,
  ...props
}) {
  const { scene } = useThree();
  const [light, setLight] = useState(null);
  useEffect(() => {
    let found = null;
    scene.traverse((o) => {
      // Skip the plant-only shadow light: the ground needs the character's
      // shadow, which that light's depth map deliberately excludes.
      if (o.isDirectionalLight && !o.userData?.[PLANT_SHADOW_LIGHT_FLAG] && !found) {
        found = o;
      }
    });
    setLight(found);
  }, [scene]);

  const d = SHADOW_DEFAULTS;
  const ctrl = useControls('Shadow', {
    color: { value: d.color, label: 'wash color' },
    strength: { value: d.strength, min: 0, max: 1, step: 0.01, label: 'wash strength' },
    spread: { value: d.spread, min: 0.02, max: 0.9, step: 0.01, label: 'spread' },
    edgeSoft: { value: d.edgeSoft, min: 0.02, max: 0.8, step: 0.01, label: 'edge soft' },
    edgeWarp: { value: d.edgeWarp, min: 0, max: 0.5, step: 0.01, label: 'edge warp' },
    washNoise: { value: d.washNoise, min: 0, max: 1.5, step: 0.01, label: 'wash noise' },
    washScale: { value: d.washScale, min: 1, max: 10, step: 0.1, label: 'wash scale' },
    contourColor: { value: d.contourColor, label: 'contour color' },
    contour: { value: d.contour, min: 0, max: 1, step: 0.01, label: 'contour strength' },
    contourWidth: { value: d.contourWidth, min: 0.2, max: 6, step: 0.1, label: 'contour width' },
    edgeAt: { value: d.edgeAt, min: 0.02, max: 0.9, step: 0.01, label: 'edge at' },
    edgeNoise: { value: d.edgeNoise, min: 0, max: 2, step: 0.01, label: 'edge noise' },
    edgeScale: { value: d.edgeScale, min: 1, max: 60, step: 1, label: 'edge scale' },
  }, { collapsed: true });

  const u = useMemo(() => ({
    bg: uniform(new THREE.Color(SCENE_DEFAULTS.bgColor)),
    washColor: uniform(new THREE.Color(d.color)),
    contourColor: uniform(new THREE.Color(d.contourColor)),
    washStr: uniform(d.strength),
    spread: uniform(d.spread),
    edgeSoft: uniform(d.edgeSoft),
    edgeWarp: uniform(d.edgeWarp),
    washNoise: uniform(d.washNoise),
    washScale: uniform(d.washScale),
    contourStr: uniform(d.contour),
    contourWidth: uniform(d.contourWidth),
    edgeAt: uniform(d.edgeAt),
    edgeNoise: uniform(d.edgeNoise),
    edgeScale: uniform(d.edgeScale),
  }), []);

  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
    if (!light) {
      m.colorNode = u.bg;
      return m;
    }
    m.colorNode = Fn(() => {
      const s = shadow(light);
      const amt = s.oneMinus().toVar();
      const ink = fbm2(positionWorld.xz.mul(u.washScale)).toVar();
      const field = amt.add(ink.mul(u.edgeWarp));
      const fill = smoothstep(u.spread, u.spread.add(u.edgeSoft), field);
      const wash = fill.mul(float(1.0).sub(ink.mul(u.washNoise).max(float(0.0))));
      const n = mx_noise_float(positionWorld.xz.mul(u.edgeScale)).mul(u.edgeNoise);
      const w = fwidth(amt).mul(u.contourWidth).max(float(0.0001));
      const dist = amt.sub(u.edgeAt.add(n)).abs();
      const edge = float(1.0).sub(smoothstep(float(0.0), w, dist));
      const shColor = mix(u.washColor, u.contourColor, edge);
      const mask = max(wash.mul(u.washStr), edge.mul(u.contourStr));
      return mix(u.bg, shColor, mask);
    })();
    return m;
  }, [light, u]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    u.washColor.value.set(ctrl.color);
    u.contourColor.value.set(ctrl.contourColor);
    u.washStr.value = ctrl.strength;
    u.spread.value = ctrl.spread;
    u.edgeSoft.value = ctrl.edgeSoft;
    u.edgeWarp.value = ctrl.edgeWarp;
    u.washNoise.value = ctrl.washNoise;
    u.washScale.value = ctrl.washScale;
    u.contourStr.value = ctrl.contour;
    u.contourWidth.value = ctrl.contourWidth;
    u.edgeAt.value = ctrl.edgeAt;
    u.edgeNoise.value = ctrl.edgeNoise;
    u.edgeScale.value = ctrl.edgeScale;
  }, [u, ctrl]);

  useFrame(() => {
    u.bg.value.copy(getLiveThemeColors().bg);
  });

  return (
    <group {...props}>
      <mesh rotation-x={-Math.PI / 2} scale={size} receiveShadow material={material}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </group>
  );
}
