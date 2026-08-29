import { useEffect, useMemo, useState } from "react";
import { folder, useControls } from "leva";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import {
  Fn,
  Loop,
  float,
  fwidth,
  max,
  mix,
  mx_noise_float,
  positionWorld,
  saturate,
  shadow,
  smoothstep,
  uniform,
  vec2,
} from "three/tsl";
import { SHADOW_DEFAULTS } from "./shadowDefaults";
import { SCENE_DEFAULTS } from "./sceneDefaults";
import { getLiveThemeColors } from "./themeTween";
import { PLANT_SHADOW_LIGHT_FLAG } from "./plantShadowLayer";

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
      if (
        o.isDirectionalLight &&
        !o.userData?.[PLANT_SHADOW_LIGHT_FLAG] &&
        !found
      ) {
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
  const ctrl = useControls(
    "Shadow",
    {
      preview: {
        value: "final",
        options: ["shade", "flatten", "bleed", "mottle", "penWidth", "contour", "final"],
      },
      Wash: folder(
        {
          washColor: { value: d.washColor },
          washStr: { value: d.washStr, min: 0, max: 1, step: 0.01 },
          /** Lower = bigger blob: more of the penumbra clears the threshold. */
          washAt: { value: d.washAt, min: 0.02, max: 0.9, step: 0.01 },
          washSoft: {
            value: d.washSoft,
            min: 0.02,
            max: 0.8,
            step: 0.01,
          },
          washScale: { value: d.washScale, min: 1, max: 10, step: 0.1 },
          /** Before the threshold, so it moves the boundary. Shape. */
          washBleed: { value: d.washBleed, min: 0, max: 0.5, step: 0.01 },
          /** After, so it cannot move the boundary. Density. */
          washMottle: {
            value: d.washMottle,
            min: 0,
            max: 1.5,
            step: 0.01,
          },
        },
        { collapsed: true },
      ),

      Contour: folder(
        {
          contourColor: { value: d.contourColor },
          contourStr: { value: d.contourStr, min: 0, max: 1, step: 0.01 },
          /** Draw the line where `shade` is close to this. Lower = further out. */
          contourShade: {
            value: d.contourShade,
            min: 0.02,
            max: 0.9,
            step: 0.01,
          },
          /** Screen-space via fwidth, so the line does not thin with distance. */
          contourWidth: { value: d.contourWidth, min: 0.2, max: 6, step: 0.1 },
          contourWobble: {
            value: d.contourWobble,
            min: 0,
            max: 2,
            step: 0.01,
          },
          contourWobbleScale: {
            value: d.contourWobbleScale,
            min: 1,
            max: 60,
            step: 1,
          },
        },
        { collapsed: true },
      ),
    },
    { collapsed: true },
  );

  /** Floats only; the two colours are handled separately. Keys match `ctrl`. */
  const FLOATS = [
    "washStr",
    "washAt",
    "washSoft",
    "washScale",
    "washBleed",
    "washMottle",
    "contourStr",
    "contourShade",
    "contourWidth",
    "contourWobble",
    "contourWobbleScale",
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
      const shade = shadow(light).oneMinus().toVar();
      // Debug previews sit on paper like the final mix: light bg, dark field.
      const onPaper = (amount) => mix(u.bg, u.washColor, amount);
      // One noise field, used twice: bleed before the threshold, mottle after.
      const noise = fbm2(positionWorld.xz.mul(u.washScale)).toVar();

      // Wash — thresholded, not blurred. The noise is added to the shadow VALUE,
      // not to the sample position, so this is not a domain warp; the threshold
      // below is what turns a value offset into a boundary that moves.
      const flatten = smoothstep(u.washAt, u.washAt.add(u.washSoft), shade);
      const fill = smoothstep(
        u.washAt,
        u.washAt.add(u.washSoft),
        shade.add(noise.mul(u.washBleed)),
      );
      const wash = fill.mul(
        float(1.0).sub(noise.mul(u.washMottle).max(float(0.0))),
      );

      // Contour — a second level of the same field, drawn at a constant pen width.
      const wobble = mx_noise_float(
        positionWorld.xz.mul(u.contourWobbleScale),
      ).mul(u.contourWobble);
      const penWidth = fwidth(shade).mul(u.contourWidth).max(float(0.0001));
      const dist = shade.sub(u.contourShade.add(wobble)).abs();
      const line = float(1.0).sub(smoothstep(float(0.0), penWidth, dist));

      // `max`, not layering: one flat ink mark instead of two stacked passes.
      const shColor = mix(u.washColor, u.contourColor, line);
      const mask = max(wash.mul(u.washStr), line.mul(u.contourStr));

      const preview = ctrl.preview;
      if (preview === "shade") return onPaper(shade);
      if (preview === "flatten") return onPaper(flatten);
      if (preview === "bleed") return onPaper(fill);
      if (preview === "mottle") return onPaper(wash);
      if (preview === "penWidth") return mix(u.bg, u.contourColor, saturate(penWidth));
      if (preview === "contour") return mix(u.bg, u.contourColor, line);
      return mix(u.bg, shColor, mask);
    })();
    return m;
  }, [light, u, ctrl.preview]);
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
      <mesh
        rotation-x={-Math.PI / 2}
        scale={size}
        receiveShadow
        material={material}
      >
        <planeGeometry args={[4, 4]} />
      </mesh>
    </group>
  );
}
