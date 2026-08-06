import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  createFlowerMaskUniforms,
  createFlowerOutlineUniforms,
  createFlowerStemMaterial,
  createFlowerUniforms,
} from '../flower/createFlowerMaterials';
import { syncFlowerControls } from '../flower/flowerControls';
import { computeDurations, computeLifecycle } from './flowerLifecycle';
import { computeWindSway, windMask, WIND_MASK_POW } from './wind';
import { DahliaVAT } from './DahliaVAT';
import { DEFAULT_LIFECYCLE_RANGES, FLOWER_META, STEM_Y_MAX } from './config';

const _up = new THREE.Vector3(0, 1, 0);
// How thin the sprout starts (fraction of full size), shared by the stem radius
// (shader) and the flower size (CPU group scale) so they grow in proportion.
const GROWTH_START_SCALE = 0.1;
// Sink the stem base this far below the ground so the open tube end is hidden by
// the (invisible) ground occluder and the stem reads as emerging from the surface.
const BASE_BURY = 0.06;

// Minimal LCG so the same seed always produces the same stem shape
function seededRng(seed) {
  let s = ((seed + 1) * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Post-process TubeGeometry: scale each ring's radial offsets by taperFn(t).
// Ring centres are looked up via curve.getPointAt so they stay in sync with
// how TubeGeometry itself places them (arc-length parameterised).
function applyTubeRadiusTaper(geometry, curve, tubularSegments, radialSegments, taperFn) {
  const pos = geometry.attributes.position;
  const vertsPerRing = radialSegments + 1;
  const ringCenter = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const scale = taperFn(t);
    curve.getPointAt(t, ringCenter);

    for (let j = 0; j <= radialSegments; j++) {
      const idx = i * vertsPerRing + j;
      const dx = pos.getX(idx) - ringCenter.x;
      const dy = pos.getY(idx) - ringCenter.y;
      const dz = pos.getZ(idx) - ringCenter.z;
      pos.setXYZ(idx,
        ringCenter.x + dx * scale,
        ringCenter.y + dy * scale,
        ringCenter.z + dz * scale,
      );
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

// One plant: procedural stem tube + a VAT flower at the tip. Pure render — all
// settings come from props (StemArrangement owns the Leva panels). Owns ONE
// flower-uniform set per plant (shared by the tube material and the VAT flower),
// synced from the passed `flowerControls` with an optional per-flower colour.
export function ProceduralStem({
  position = [0, 0, 0],
  phaseSpread = 1,
  seed = 0,
  flowerMeta = FLOWER_META,
  colorOverride = null,
  params = {}, // per-stem randomized geometry
  stemSegments = 32,
  radialSegs = 8,
  flowerSize = 4.2,
  stemYMax = STEM_Y_MAX,
  bloomStart = 0.23,
  bloomFrac = 0.3,
  lifecycleRanges = DEFAULT_LIFECYCLE_RANGES,
  flowerControls = null,
  windAngle = 30,
  windStrength = 0.02,
  windScale = 1.5,
  windSpeed = 0.6,
}) {
  const {
    stemLength = 0.55,
    stemRadius = 0.012,
    leanAngle = 5,
    bendDegree = 0.12,
    radiusAttenuation = 0.4,
    baseFlare = 0.25,
  } = params;

  // Each completed cycle regrows a fresh flower: bumping the generation reseeds
  // the stem's lean/bend direction and timing so a plot doesn't replay the
  // identical stem when it dies and respawns.
  const [generation, setGeneration] = useState(0);
  const effSeed = seed + generation * 131;

  // Per-stem phase durations, seeded so each plant cycles on its own schedule
  const durations = useMemo(
    () => computeDurations(effSeed, lifecycleRanges),
    [effSeed, lifecycleRanges],
  );

  // Seeded starting phase [0,1) so each plant begins at a different point in its
  // cycle — the field is always a mix of sprout/bloom/wilt (continuous spawning).
  const phaseFrac = useMemo(() => {
    const s = Math.sin((seed + 1) * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }, [seed]);

  // One shader-uniform set per plant, shared by the tube + VAT flower materials.
  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);
  const outlineUniforms = useMemo(() => createFlowerOutlineUniforms(), []);

  // Sync the shared 'Flower' controls into this plant's uniforms, then layer the
  // per-flower colour on top (sync resets petal colours first, so it can't compound).
  useEffect(() => {
    if (!flowerControls) return;
    syncFlowerControls(flowerControls, flowerUniforms, maskUniforms, outlineUniforms);
    if (colorOverride) {
      const { hueShift = 0, lightShift = 0 } = colorOverride;
      flowerUniforms.petal.baseColor.value.offsetHSL(hueShift, 0, lightShift);
      flowerUniforms.petal.midColor.value.offsetHSL(hueShift, 0, lightShift);
      flowerUniforms.petal.tipColor.value.offsetHSL(hueShift, 0, lightShift);
    }
  }, [flowerControls, flowerUniforms, maskUniforms, outlineUniforms, colorOverride]);

  // Per-plant wind sway uniform (world XZ), set on CPU each frame; the shader
  // distributes it up the stem via a height mask (see createFlowerStemMaterial).
  const windSway = useMemo(() => uniform(new THREE.Vector2()), []);
  // Raw growth progress (0→1), set each frame from stemGrow; the shader turns it
  // into the radius scale, so the whole life-based scaling runs on the GPU.
  const stemGrowU = useMemo(() => uniform(0), []);

  const stemMaterial = useMemo(
    () => createFlowerStemMaterial(flowerUniforms, {
      wind: { sway: windSway, maskPow: WIND_MASK_POW },
      radius: { grow: stemGrowU, startScale: GROWTH_START_SCALE },
    }),
    [flowerUniforms, windSway, stemGrowU],
  );
  useEffect(() => () => stemMaterial.dispose(), [stemMaterial]);

  const curveRef = useRef(null);

  const geometry = useMemo(() => {
    const rng = seededRng(effSeed);
    const length = stemLength;

    // — Overall lean direction (seed-controlled azimuth) —
    const leanAzimuth = rng() * Math.PI * 2;
    const leanRad = leanAngle * (Math.PI / 180);
    const to = new THREE.Vector3(
      Math.sin(leanAzimuth) * Math.sin(leanRad) * length,
      Math.cos(leanRad) * length,
      Math.cos(leanAzimuth) * Math.sin(leanRad) * length,
    );

    // — Lateral bow: both interior control points pushed by the same
    //   perpendicular vector, producing a clean banana arc (unity approach) —
    const bendAzimuth = rng() * Math.PI * 2;
    const bendMag = bendDegree * length;
    const bend = new THREE.Vector3(
      Math.sin(bendAzimuth) * bendMag,
      0,
      Math.cos(bendAzimuth) * bendMag,
    );

    // Natural leaning curve (unchanged shape). The base is sunk BASE_BURY below
    // the ground so the open tube end is hidden by the ground occluder and the
    // stem reads as emerging from the surface rather than floating.
    const from = new THREE.Vector3(0, -BASE_BURY, 0);
    const c = new THREE.CatmullRomCurve3(
      [
        from.clone(),
        from.clone().lerp(to, 0.25).add(bend),
        from.clone().lerp(to, 0.75).add(bend),
        to.clone(),
      ],
      false,
      'centripetal',
    );
    curveRef.current = c;

    const geo = new THREE.TubeGeometry(c, stemSegments, stemRadius, radialSegs, false);

    // Taper = linear attenuation + base flare:
    // r(t) = (1 - (1 - radiusAttenuation) * t)  +  baseFlare * (1-t)^3
    // At t=0: 1 + baseFlare  (wider than nominal radius at base)
    // At t=1: radiusAttenuation  (thinner at tip)
    applyTubeRadiusTaper(geo, c, stemSegments, radialSegs, (t) => {
      const linearTaper = 1 - (1 - radiusAttenuation) * t;
      const flare = baseFlare * Math.pow(1 - t, 3);
      return linearTaper + flare;
    });

    // Bake each vertex's centerline point so the shader can grow the radius
    // (scale the radial offset by stemGrow) — see createFlowerStemMaterial.
    const vertsPerRing = radialSegs + 1;
    const centers = new Float32Array(geo.attributes.position.count * 3);
    const rc = new THREE.Vector3();
    for (let i = 0; i <= stemSegments; i++) {
      c.getPointAt(i / stemSegments, rc);
      for (let j = 0; j <= radialSegs; j++) {
        const k = (i * vertsPerRing + j) * 3;
        centers[k] = rc.x;
        centers[k + 1] = rc.y;
        centers[k + 2] = rc.z;
      }
    }
    geo.setAttribute('center', new THREE.BufferAttribute(centers, 3));

    geo.setDrawRange(0, 0); // start invisible — avoids 1-frame flash on mount
    return geo;
  }, [stemLength, leanAngle, bendDegree, effSeed,
      stemSegments, stemRadius, radialSegs, radiusAttenuation, baseFlare]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const meshRef = useRef(null);
  const tipGroupRef = useRef(null);
  const tipPos = useRef(new THREE.Vector3());
  const tipQuat = useRef(new THREE.Quaternion());

  // Lifecycle clock: age accumulates seconds and loops within [0, lifetime).
  // Initialised ONCE to a negative (seeded, hidden) staggered delay so the field
  // spawns continuously and every stem grows from zero. Regrowth just wraps back
  // to ~0 and runs the next cycle's delay as the rest — it must NOT re-stagger.
  const ageRef = useRef(null);
  const flowerFrameRef = useRef(0); // VAT frame ratio (0→1→0), fed to DahliaVAT
  if (ageRef.current === null) {
    const lifetime = durations.delay + durations.grow + durations.keep + durations.die;
    ageRef.current = -phaseFrac * lifetime * phaseSpread;
  }

  const directionalLightRef = useRef(null);
  const lightWorldPosition = useRef(new THREE.Vector3());
  const lightTargetPosition = useRef(new THREE.Vector3());

  useFrame(({ scene, clock }, delta) => {
    // Wind gust for this plant → shader uniform (drives the stem bend)
    const [swayX, swayZ] = computeWindSway(position[0], position[2], clock.elapsedTime, {
      windAngle, windStrength, windScale, windSpeed,
    });
    windSway.value.set(swayX, swayZ);

    // Light direction → this plant's shared lightDir (tube + flower both read it)
    if (!directionalLightRef.current) {
      scene.traverse((object) => {
        if (object.isDirectionalLight) directionalLightRef.current = object;
      });
    }
    const light = directionalLightRef.current;
    if (light) {
      light.updateWorldMatrix(true, false);
      light.target.updateWorldMatrix(true, false);
      light.getWorldPosition(lightWorldPosition.current);
      light.target.getWorldPosition(lightTargetPosition.current);
      flowerUniforms.lightDir.value
        .subVectors(lightWorldPosition.current, lightTargetPosition.current)
        .normalize();
    }

    // Advance the lifecycle clock (clamp dt so a tab refocus can't skip a cycle)
    const lifetime = durations.delay + durations.grow + durations.keep + durations.die;
    ageRef.current += Math.min(delta, 0.1);
    if (ageRef.current >= lifetime) {
      ageRef.current -= lifetime;
      setGeneration((g) => g + 1); // regrow a fresh flower (new direction + timing)
    }

    const { stemGrow, flowerFrame, flowerScale } = computeLifecycle(
      ageRef.current,
      durations,
      bloomFrac,
      bloomStart,
    );

    // Whole plant enlarges as it grows: thin sprout → full at maturity.
    // Stem radius: GPU (shader reads this raw progress). Flower: CPU group scale.
    stemGrowU.value = stemGrow;
    const growthSize = GROWTH_START_SCALE + (1 - GROWTH_START_SCALE) * stemGrow;

    const geo = meshRef.current?.geometry;
    if (geo) {
      // draw-range grows the tube during grow, retracts it during die
      geo.setDrawRange(0, Math.ceil(stemGrow * stemSegments) * radialSegs * 6);
    }

    const curve = curveRef.current;
    if (curve) {
      // Tip rides the current growth point — moves up as it grows, back down as
      // it retracts. Group's local Y aligns with the tangent so the flower faces
      // along the stem direction.
      const t = Math.max(stemGrow, 0.001);
      curve.getPointAt(t, tipPos.current);
      tipQuat.current.setFromUnitVectors(_up, curve.getTangentAt(t));
    }

    flowerFrameRef.current = flowerFrame; // reverse-capable ratio → DahliaVAT

    if (tipGroupRef.current) {
      // Follow the shader-bent tip: same sway × the mask at the current growth
      // front, so the flower stays welded to the swaying stem tip.
      const m = windMask(stemGrow);
      tipGroupRef.current.position.set(
        tipPos.current.x + swayX * m,
        tipPos.current.y,
        tipPos.current.z + swayZ * m,
      );
      tipGroupRef.current.quaternion.copy(tipQuat.current);
      tipGroupRef.current.scale.setScalar(flowerScale * growthSize);
      tipGroupRef.current.visible = flowerScale > 0.001;
    }
  }, 1);

  return (
    <group position={position}>
      {/* Camera + shadow pipelines are precompiled once at startup by
          StemArrangement (gl.compileAsync), so the first birth doesn't stall. */}
      <mesh ref={meshRef} geometry={geometry} material={stemMaterial}
            frustumCulled={false} castShadow />
      <group ref={tipGroupRef}>
        <DahliaVAT
          metaUrl={flowerMeta}
          scaleMul={stemRadius * flowerSize}
          frameRatio={flowerFrameRef}
          stemYMax={stemYMax}
          flowerUniforms={flowerUniforms}
          maskUniforms={maskUniforms}
          outlineUniforms={outlineUniforms}
        />
      </group>
    </group>
  );
}
