import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import {
  createFlowerMaskUniforms,
  createFlowerOutlineUniforms,
  createFlowerStemMaterial,
  createFlowerUniforms,
} from '../flower/createFlowerMaterials';
import { syncFlowerControls } from '../flower/flowerControls';
import { computeDurations, computeLifecycle } from './flowerLifecycle';
import { DahliaVAT } from './DahliaVAT';
import { DEFAULT_LIFECYCLE_RANGES, FLOWER_META, STEM_Y_MAX } from './config';

const _up = new THREE.Vector3(0, 1, 0);

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
  timeOffset = 0,
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
}) {
  const {
    stemLength = 0.55,
    stemRadius = 0.012,
    leanAngle = 5,
    bendDegree = 0.12,
    radiusAttenuation = 0.4,
    baseFlare = 0.25,
  } = params;

  // Per-stem phase durations, seeded so each plant cycles on its own schedule
  const durations = useMemo(
    () => computeDurations(seed, lifecycleRanges),
    [seed, lifecycleRanges],
  );

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

  const stemMaterial = useMemo(
    () => createFlowerStemMaterial(flowerUniforms),
    [flowerUniforms],
  );
  useEffect(() => () => stemMaterial.dispose(), [stemMaterial]);

  const curveRef = useRef(null);

  const geometry = useMemo(() => {
    const rng = seededRng(seed);
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

    const from = new THREE.Vector3(0, 0, 0);
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

    geo.setDrawRange(0, 0); // start invisible — avoids 1-frame flash on mount
    return geo;
  }, [stemLength, leanAngle, bendDegree, seed,
      stemSegments, stemRadius, radialSegs, radiusAttenuation, baseFlare]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const meshRef = useRef(null);
  const tipGroupRef = useRef(null);
  const tipPos = useRef(new THREE.Vector3());
  const tipQuat = useRef(new THREE.Quaternion());

  // Lifecycle clock: age accumulates seconds and loops within [0, lifetime).
  // Starts at -timeOffset so stems stagger in on first load, then cycle.
  const ageRef = useRef(-timeOffset);
  const flowerFrameRef = useRef(0); // VAT frame ratio (0→1→0), fed to DahliaVAT
  useEffect(() => {
    ageRef.current = -timeOffset;
    flowerFrameRef.current = 0;
  }, [geometry, timeOffset]);

  const directionalLightRef = useRef(null);
  const lightWorldPosition = useRef(new THREE.Vector3());
  const lightTargetPosition = useRef(new THREE.Vector3());

  useFrame(({ scene }, delta) => {
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
    if (ageRef.current >= lifetime) ageRef.current -= lifetime;

    const { stemGrow, flowerFrame, flowerScale } = computeLifecycle(
      ageRef.current,
      durations,
      bloomFrac,
      bloomStart,
    );

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
      tipGroupRef.current.position.copy(tipPos.current);
      tipGroupRef.current.quaternion.copy(tipQuat.current);
      tipGroupRef.current.scale.setScalar(flowerScale);
      tipGroupRef.current.visible = flowerScale > 0.001;
    }
  }, 1);

  return (
    <group position={position}>
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
