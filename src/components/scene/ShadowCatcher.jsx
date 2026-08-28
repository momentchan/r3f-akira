import { useEffect, useMemo, useState } from 'react';
import { folder, useControls } from 'leva';
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
  // `wash*` and `contour*` prefixes throughout: the old names put `edgeSoft` and
  // `edgeWarp` (the blob) in the same apparent family as `edgeAt`, `edgeNoise` and
  // `edgeScale` (the line), which read as one group in the shader when they are
  // opposite halves of it.
  const ctrl = useControls('Shadow', {
    Wash: folder({
      washColor: { value: d.washColor, label: 'color' },
      washStr: { value: d.washStr, min: 0, max: 1, step: 0.01, label: 'strength' },
      /** Lower = bigger blob: more of the penumbra clears the threshold. */
      washAt: { value: d.washAt, min: 0.02, max: 0.9, step: 0.01, label: 'boundary at' },
      washSoft: {
        value: d.washSoft, min: 0.02, max: 0.8, step: 0.01, label: 'boundary softness',
      },
      washScale: { value: d.washScale, min: 1, max: 10, step: 0.1, label: 'paper scale' },
      /** Before the threshold, so it moves the boundary. Shape. */
      washBleed: { value: d.washBleed, min: 0, max: 0.5, step: 0.01, label: 'edge bleed' },
      /** After, so it cannot move the boundary. Density. */
      washMottle: {
        value: d.washMottle, min: 0, max: 1.5, step: 0.01, label: 'interior mottle',
      },
    }, { collapsed: true }),

    Contour: folder({
      contourColor: { value: d.contourColor, label: 'color' },
      contourStr: { value: d.contourStr, min: 0, max: 1, step: 0.01, label: 'strength' },
      /** Which level of the field to trace. Independent of `washAt`. */
      contourAt: { value: d.contourAt, min: 0.02, max: 0.9, step: 0.01, label: 'level at' },
      /** Screen-space via fwidth, so the line does not thin with distance. */
      contourWidth: { value: d.contourWidth, min: 0.2, max: 6, step: 0.1, label: 'pen width' },
      contourWobble: {
        value: d.contourWobble, min: 0, max: 2, step: 0.01, label: 'line wobble',
      },
      contourScale: { value: d.contourScale, min: 1, max: 60, step: 1, label: 'wobble scale' },
    }, { collapsed: true }),
  }, { collapsed: true });

  /** Floats only; the two colours are handled separately. Keys match `ctrl`. */
  const FLOATS = [
    'washStr', 'washAt', 'washSoft', 'washScale', 'washBleed', 'washMottle',
    'contourStr', 'contourAt', 'contourWidth', 'contourWobble', 'contourScale',
  ];

  const u = useMemo(() => {
    const out = {
      bg: uniform(new THREE.Color(SCENE_DEFAULTS.bgColor)),
      washColor: uniform(new THREE.Color(d.washColor)),
      contourColor: uniform(new THREE.Color(d.contourColor)),
    };
    for (const key of FLOATS) out[key] = uniform(d[key]);
    return out;
  }, []);

  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
    if (!light) {
      m.colorNode = u.bg;
      return m;
    }
    m.colorNode = Fn(() => {
      // A continuous 0..1 field, not a binary mask — that is what lets the wash
      // threshold it for a shape and the contour trace it for a stroke.
      const amt = shadow(light).oneMinus().toVar();
      // One noise field, used twice: bleed before the threshold, mottle after.
      const ink = fbm2(positionWorld.xz.mul(u.washScale)).toVar();

      // Wash — thresholded, not blurred. The noise is added to the shadow VALUE,
      // not to the sample position, so this is not a domain warp; the threshold
      // below is what turns a value offset into a boundary that moves.
      const inked = amt.add(ink.mul(u.washBleed));
      const fill = smoothstep(u.washAt, u.washAt.add(u.washSoft), inked);
      const wash = fill.mul(float(1.0).sub(ink.mul(u.washMottle).max(float(0.0))));

      // Contour — a second level of the same field, drawn at a constant pen width.
      const wobble = mx_noise_float(positionWorld.xz.mul(u.contourScale))
        .mul(u.contourWobble);
      const penWidth = fwidth(amt).mul(u.contourWidth).max(float(0.0001));
      const dist = amt.sub(u.contourAt.add(wobble)).abs();
      const line = float(1.0).sub(smoothstep(float(0.0), penWidth, dist));

      // `max`, not layering: one flat ink mark instead of two stacked passes.
      const shColor = mix(u.washColor, u.contourColor, line);
      const mask = max(wash.mul(u.washStr), line.mul(u.contourStr));
      return mix(u.bg, shColor, mask);
    })();
    return m;
  }, [light, u]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    u.washColor.value.set(ctrl.washColor);
    u.contourColor.value.set(ctrl.contourColor);
    for (const key of FLOATS) u[key].value = ctrl[key];
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
