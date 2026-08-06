import { useEffect, useMemo, useState } from 'react';
import { useControls } from 'leva';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import {
  Fn, float, fwidth, max, mix, mx_fractal_noise_float, mx_noise_float,
  positionWorld, shadow, smoothstep, uniform,
} from 'three/tsl';

// Single-mesh painted shadow (Akira ink-wash style). One OPAQUE plane:
//   • samples the directional light's shadow directly via the `shadow()` node
//   • wash  — flat slate fill with a fractal-noise-warped soft edge (Akira wash)
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
    color:        { value: '#4e5769', label: 'wash color' },
    strength:     { value: 0.29, min: 0, max: 1, step: 0.01, label: 'wash strength' },
    spread:       { value: 0.47, min: 0.02, max: 0.9, step: 0.01, label: 'spread' },
    edgeSoft:     { value: 0.45, min: 0.02, max: 0.8, step: 0.01, label: 'edge soft' },
    edgeWarp:     { value: 0.36, min: 0, max: 0.5, step: 0.01, label: 'edge warp' },
    washNoise:    { value: 0.91, min: 0, max: 1.5, step: 0.01, label: 'wash noise' },
    washScale:    { value: 3.1, min: 1, max: 10, step: 0.1, label: 'wash scale' },
    contourColor: { value: '#232a42', label: 'contour color' },
    contour:      { value: 0.6, min: 0, max: 1, step: 0.01, label: 'contour strength' },
    contourWidth: { value: 1.5, min: 0.2, max: 6, step: 0.1, label: 'contour width' },
    edgeAt:       { value: 0.35, min: 0.02, max: 0.9, step: 0.01, label: 'edge at' },
    edgeNoise:    { value: 1.25, min: 0, max: 2, step: 0.01, label: 'edge noise' },
    edgeScale:    { value: 21, min: 1, max: 60, step: 1, label: 'edge scale' },
  }, { collapsed: true });

  const u = useMemo(() => ({
    bg:           uniform(new THREE.Color('#ede4d3')),
    washColor:    uniform(new THREE.Color('#3f4d6b')),
    contourColor: uniform(new THREE.Color('#232a42')),
    washStr:      uniform(0.4),
    spread:       uniform(0.25),
    edgeSoft:     uniform(0.18),
    edgeWarp:     uniform(0.12),
    washNoise:    uniform(0.35),
    washScale:    uniform(2),
    contourStr:   uniform(0.6),
    contourWidth: uniform(1.5),
    edgeAt:       uniform(0.35),
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
      // World-space multi-octave ink texture. Kept world-anchored (positionWorld)
      // so it moves with the geometry and COMPLEMENTS — rather than duplicates —
      // SilkWeave's screen-space paper grain.
      const ink = mx_fractal_noise_float(positionWorld.xz.mul(u.washScale), 4).toVar();
      // Organic, hand-painted silhouette: push the shadow boundary in/out.
      const field = amt.add(ink.mul(u.edgeWarp));
      // FLAT fill + a NARROW soft edge → a uniform slate shape (Akira) instead of a
      // broad gradient; the interior plateaus once past the edge band.
      const fill = smoothstep(u.spread, u.spread.add(u.edgeSoft), field);
      // Subtle interior ink-density mottle; ×fill keeps it inside the shadow and
      // fades it at the lit edge. `.max(0)` → only lighter watercolour-bleed patches.
      const wash = fill.mul(float(1.0).sub(ink.mul(u.washNoise).max(float(0.0))));
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
  }, [u, groundColor, ctrl]);

  return (
    <group {...props}>
      <mesh rotation-x={-Math.PI / 2} scale={size} receiveShadow material={material}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </group>
  );
}
