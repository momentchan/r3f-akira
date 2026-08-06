import { useEffect, useMemo, useState } from 'react';
import { useControls } from 'leva';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import {
  Fn, float, fwidth, max, mix, mx_noise_float, positionWorld, shadow, smoothstep, uniform,
} from 'three/tsl';

// Single-mesh painted shadow (Akira ink-wash style). One OPAQUE plane:
//   • samples the directional light's shadow directly via the `shadow()` node
//   • wash  — smoothstep falloff fill
//   • contour — a constant-width edge at the `threshold` isoline via fwidth
//               (crisp regardless of how soft the shadow is), noise-feathered
//   • composites wash colour + contour colour over the background colour
// Because it's opaque and background-coloured where there's no shadow, the plane is
// invisible AND occludes the buried stem bases — so no separate occluder, no render
// target, no extra pass. The paper/canvas texture comes from the SilkWeave post.
export function ShadowCatcher({ size = 10, groundColor = '#ede4d3', ...props }) {
  const { scene } = useThree();
  const [light, setLight] = useState(null);
  useEffect(() => {
    let found = null;
    scene.traverse((o) => { if (o.isDirectionalLight && !found) found = o; });
    setLight(found);
  }, [scene]);

  const ctrl = useControls('Shadow', {
    color:        { value: '#3f4d6b', label: 'wash color' },
    strength:     { value: 0.4, min: 0, max: 1, step: 0.01, label: 'wash strength' },
    washNoise:    { value: 0.35, min: 0, max: 1.5, step: 0.01, label: 'wash noise' },
    washScale:    { value: 2, min: 1, max: 10, step: 0.1, label: 'wash scale' },
    contourColor: { value: '#232a42', label: 'contour color' },
    contour:      { value: 0.6, min: 0, max: 1, step: 0.01, label: 'contour strength' },
    contourWidth: { value: 1.5, min: 0.2, max: 6, step: 0.1, label: 'contour width' },
    edgeAt:       { value: 0.35, min: 0.02, max: 0.9, step: 0.01, label: 'edge at' },
    falloff:      { value: 0.6, min: 0.05, max: 1, step: 0.01 },
    edgeNoise:    { value: 1.25, min: 0, max: 2, step: 0.01, label: 'edge noise' },
    edgeScale:    { value: 21, min: 1, max: 60, step: 1, label: 'edge scale' },
  }, { collapsed: true });

  const u = useMemo(() => ({
    bg:           uniform(new THREE.Color('#ede4d3')),
    washColor:    uniform(new THREE.Color('#3f4d6b')),
    contourColor: uniform(new THREE.Color('#232a42')),
    washStr:      uniform(0.4),
    washNoise:    uniform(0.35),
    washScale:    uniform(18),
    contourStr:   uniform(0.6),
    contourWidth: uniform(1.5),
    edgeAt:       uniform(0.35),
    falloff:      uniform(0.6),
    edgeNoise:    uniform(0.15),
    edgeScale:    uniform(14),
  }), []);

  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
    if (!light) {
      m.colorNode = u.bg; // before the light is found: plain bg (still opaque → occludes)
      return m;
    }
    m.colorNode = Fn(() => {
      const s = shadow(light);                    // 1 = lit, 0 = shadowed
      const amt = s.oneMinus().toVar();           // 0 = lit → 1 = shadowed (smooth)
      // inner ink-wash grain: mottle the shadow DENSITY with noise before the
      // falloff. Scales `amt`, so it fades out toward the lit edge and lives in the
      // interior — separate from the contour feather below.
      const grain = mx_noise_float(positionWorld.xz.mul(u.washScale)).mul(u.washNoise);
      const wash = smoothstep(float(0.0), u.falloff, amt.mul(float(1.0).add(grain)));
      // constant-width contour at the `edgeAt` isoline; noise shifts it → feathered
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
    u.bg.value.set(groundColor);
    u.washColor.value.set(ctrl.color);
    u.contourColor.value.set(ctrl.contourColor);
    u.washStr.value = ctrl.strength;
    u.washNoise.value = ctrl.washNoise;
    u.washScale.value = ctrl.washScale;
    u.contourStr.value = ctrl.contour;
    u.contourWidth.value = ctrl.contourWidth;
    u.edgeAt.value = ctrl.edgeAt;
    u.falloff.value = ctrl.falloff;
    u.edgeNoise.value = ctrl.edgeNoise;
    u.edgeScale.value = ctrl.edgeScale;
  }, [u, groundColor, ctrl]);

  return (
    <group {...props}>
      <mesh rotation-x={-Math.PI / 2} scale={size} receiveShadow material={material}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </group>
  );
}
