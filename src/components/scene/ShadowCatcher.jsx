import { useEffect, useMemo, useState } from 'react';
import { useControls } from 'leva';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import {
  clamp, Fn, float, fwidth, length, max, mix, mx_fractal_noise_float,
  mx_noise_float, positionWorld, shadow, sin, smoothstep, uniform,
} from 'three/tsl';
import { GROUND_MEADOW_DEFAULTS } from '../plants/ground/groundMeadowDefaults';
import { SHADOW_DEFAULTS } from './shadowDefaults';
import { SCENE_DEFAULTS } from './sceneDefaults';

function combinedGroundCenter(bodyBounds, backpackBounds) {
  const boxes = [bodyBounds?.localBox, backpackBounds?.localBox].filter(Boolean);
  if (!boxes.length) return [0, 0];
  const box = boxes[0].clone();
  for (let i = 1; i < boxes.length; i += 1) box.union(boxes[i]);
  return [
    (box.min.x + box.max.x) * 0.5,
    (box.min.z + box.max.z) * 0.5,
  ];
}

export function ShadowCatcher({
  size = 10,
  groundColor = SCENE_DEFAULTS.bgColor,
  bodyBounds = null,
  backpackBounds = null,
  meadow = GROUND_MEADOW_DEFAULTS,
  ...props
}) {
  const { scene } = useThree();
  const [light, setLight] = useState(null);
  useEffect(() => {
    let found = null;
    scene.traverse((o) => { if (o.isDirectionalLight && !found) found = o; });
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
    meadowEnabled: uniform(GROUND_MEADOW_DEFAULTS.enabled ? 1 : 0),
    meadowCenter: uniform(new THREE.Vector2()),
    meadowRadius: uniform(new THREE.Vector2(GROUND_MEADOW_DEFAULTS.areaX, GROUND_MEADOW_DEFAULTS.areaZ)),
    meadowPatchScale: uniform(GROUND_MEADOW_DEFAULTS.patchScale),
    meadowEdgeScale: uniform(GROUND_MEADOW_DEFAULTS.edgeScale),
    meadowEdgeWarp: uniform(GROUND_MEADOW_DEFAULTS.edgeWarp),
    grassColorA: uniform(new THREE.Color(GROUND_MEADOW_DEFAULTS.grassColorA)),
    grassColorB: uniform(new THREE.Color(GROUND_MEADOW_DEFAULTS.grassColorB)),
  }), []);

  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
    if (!light) {
      m.colorNode = u.bg;
      return m;
    }
    m.colorNode = Fn(() => {
      const meadowPosition = positionWorld.xz.sub(u.meadowCenter);
      const meadowDistance = length(meadowPosition.div(u.meadowRadius));
      const meadowEdgeNoise = mx_fractal_noise_float(
        positionWorld.xz.mul(u.meadowEdgeScale),
        3,
      ).sub(float(0.5));
      const meadowMask = float(1).sub(smoothstep(
        float(0.88),
        float(1.02),
        meadowDistance.add(meadowEdgeNoise.mul(u.meadowEdgeWarp)),
      )).mul(u.meadowEnabled);

      // This is the same paint field used by the CPU blade scatter. Keeping the
      // surface and instances synchronized mirrors the tutorial's shared mask.
      const paintPosition = positionWorld.xz.mul(u.meadowPatchScale);
      const broadPatch = sin(
        paintPosition.x.mul(float(1.37)).add(
          sin(paintPosition.y.mul(float(0.73))).mul(float(1.4)),
        ),
      );
      const crossPatch = sin(
        paintPosition.y.mul(float(1.91)).sub(paintPosition.x.mul(float(0.42))),
      );
      const paint = clamp(
        float(0.5).add(broadPatch.mul(float(0.25))).add(crossPatch.mul(float(0.2))),
        float(0),
        float(1),
      );
      const meadowColor = mix(
        u.grassColorA,
        u.grassColorB,
        smoothstep(float(0.3), float(0.7), paint),
      );
      const groundBase = mix(u.bg, meadowColor, meadowMask);

      const s = shadow(light);
      const amt = s.oneMinus().toVar();
      const ink = mx_fractal_noise_float(positionWorld.xz.mul(u.washScale), 4).toVar();
      const field = amt.add(ink.mul(u.edgeWarp));
      const fill = smoothstep(u.spread, u.spread.add(u.edgeSoft), field);
      const wash = fill.mul(float(1.0).sub(ink.mul(u.washNoise).max(float(0.0))));
      const n = mx_noise_float(positionWorld.xz.mul(u.edgeScale)).mul(u.edgeNoise);
      const w = fwidth(amt).mul(u.contourWidth).max(float(0.0001));
      const dist = amt.sub(u.edgeAt.add(n)).abs();
      const edge = float(1.0).sub(smoothstep(float(0.0), w, dist));
      const shColor = mix(u.washColor, u.contourColor, edge);
      // Keep the meadow shadows in the same green family; outside the meadow,
      // retain the original ink-wash shadow used by the paper background.
      const groundedShadowColor = mix(
        shColor,
        u.grassColorA,
        meadowMask.mul(float(0.78)),
      );
      const mask = max(wash.mul(u.washStr), edge.mul(u.contourStr));
      return mix(groundBase, groundedShadowColor, mask);
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
    const [centerX, centerZ] = combinedGroundCenter(bodyBounds, backpackBounds);
    u.meadowCenter.value.set(centerX, centerZ);
    u.meadowRadius.value.set(meadow.areaX, meadow.areaZ);
    u.meadowEnabled.value = meadow.enabled ? 1 : 0;
    u.meadowPatchScale.value = meadow.patchScale;
    u.grassColorA.value.set(meadow.grassColorA);
    u.grassColorB.value.set(meadow.grassColorB);
  }, [u, groundColor, ctrl, meadow, bodyBounds, backpackBounds]);

  return (
    <group {...props}>
      <mesh rotation-x={-Math.PI / 2} scale={size} receiveShadow material={material}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </group>
  );
}
