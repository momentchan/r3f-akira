import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  createFlowerMaskUniforms,
  createFlowerStemMaterial,
  createFlowerUniforms,
} from '../look/createFlowerMaterials';
import { syncFlowerControls } from '../look/flowerControls';
import { DEFAULT_LIFECYCLE_RANGES, FIELD_DEFAULTS } from '../field/fieldDefaults';
import { STEM_Y_MAX } from '../field/paths';
import { FLOWER_TYPES } from '../vat/flowerTypes';
import { VatFlower } from '../vat/VatFlower';
import { computeDurations, computeLifecycle } from './flowerLifecycle';
import { computeWindSway, windMask, WIND_MASK_POW } from './wind';
import { StemLeaves } from './StemLeaves';
import { PLANT_WIND_DEFAULTS } from '../wind/plantWind';

const _up = new THREE.Vector3(0, 1, 0);
const GROWTH_START_SCALE = 0.1;
const BASE_BURY = 0.06;

function seededRng(seed) {
  let s = ((seed + 1) * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

export function ProceduralStem({
  position = [0, 0, 0],
  leanOutwardAngle = null,
  leanOut = 0,
  phaseSpread = 1,
  seed = 0,
  flowerType = FLOWER_TYPES[0],
  colorOverride = null,
  params = {},
  stemSegments = FIELD_DEFAULTS.stemGeometry.stemSegments,
  radialSegs = FIELD_DEFAULTS.stemGeometry.radialSegs,
  stemYMax = STEM_Y_MAX,
  bloomStart = FIELD_DEFAULTS.stemGeometry.bloomStart,
  bloomFrac = FIELD_DEFAULTS.stemGeometry.bloomFrac,
  lifecycleRanges = DEFAULT_LIFECYCLE_RANGES,
  lifecyclePausedRef = null, // { current: boolean } — when true, freeze age (Space toggle)
  flowerControls = null,
  windAngle = PLANT_WIND_DEFAULTS.windAngle,
  windStrength = PLANT_WIND_DEFAULTS.windStrength,
  windScale = PLANT_WIND_DEFAULTS.windScale,
  windSpeed = PLANT_WIND_DEFAULTS.windSpeed,
  leafCount = FIELD_DEFAULTS.leaves.leafCount,
  leafSpan = FIELD_DEFAULTS.leaves.leafSpan,
  leafScale = FIELD_DEFAULTS.leaves.leafScale,
  scaleVariance = FIELD_DEFAULTS.leaves.scaleVariance,
  droop = FIELD_DEFAULTS.leaves.droop,
  leafBend = FIELD_DEFAULTS.leaves.leafBend,
  curlStrength = [FIELD_DEFAULTS.leaves.curlStrengthStart, FIELD_DEFAULTS.leaves.curlStrengthEnd],
  curlPower = [FIELD_DEFAULTS.leaves.curlPowerStart, FIELD_DEFAULTS.leaves.curlPowerEnd],
  bendStrength = FIELD_DEFAULTS.leaves.bendStrength,
  bendVariance = FIELD_DEFAULTS.leaves.bendVariance,
  colorLevels = FIELD_DEFAULTS.leaves.colorLevels,
}) {
  const {
    stemLength = FIELD_DEFAULTS.stemGeometry.stemLength[0],
    stemRadius = FIELD_DEFAULTS.stemGeometry.stemRadius[0],
    leanAngle = FIELD_DEFAULTS.stemGeometry.leanAngle[0],
    bendDegree = FIELD_DEFAULTS.stemGeometry.bendDegree[0],
    radiusAttenuation = FIELD_DEFAULTS.stemGeometry.radiusAttenuation[0],
    baseFlare = FIELD_DEFAULTS.stemGeometry.baseFlare[0],
  } = params;

  const [generation, setGeneration] = useState(0);
  const effSeed = seed + generation * 131;

  const durations = useMemo(
    () => computeDurations(effSeed, lifecycleRanges),
    [effSeed, lifecycleRanges],
  );

  const phaseFrac = useMemo(() => {
    const s = Math.sin((seed + 1) * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }, [seed]);

  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);

  useEffect(() => {
    if (!flowerControls) return;
    syncFlowerControls(flowerControls, flowerUniforms, maskUniforms);
    if (colorOverride) {
      const { hueShift = 0, lightShift = 0 } = colorOverride;
      flowerUniforms.petal.baseColor.value.offsetHSL(hueShift, 0, lightShift);
      flowerUniforms.petal.midColor.value.offsetHSL(hueShift, 0, lightShift);
      flowerUniforms.petal.tipColor.value.offsetHSL(hueShift, 0, lightShift);
    }
  }, [flowerControls, flowerUniforms, maskUniforms, colorOverride]);

  const windSway = useMemo(() => uniform(new THREE.Vector2()), []);
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

    // — Overall lean direction — random azimuth, optionally biased to lean away from
    //   the field centre (leanOutwardAngle) by `leanOut` so canopies fan apart. az0 is
    //   always consumed so the rest of the seeded stream is unchanged by the bias.
    const az0 = rng() * Math.PI * 2;
    const leanAzimuth = leanOutwardAngle === null
      ? az0
      : leanOutwardAngle + (az0 - Math.PI) * (1 - leanOut);
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
  }, [stemLength, leanAngle, bendDegree, effSeed, leanOutwardAngle, leanOut,
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
  const flowerFrameRef = useRef(0); // VAT frame ratio (0→1→0), fed to FlowerVAT
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
      enabled: true,
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

    // Advance the lifecycle clock (clamp dt so a tab refocus can't skip a cycle).
    // Space toggles lifecyclePausedRef — freeze age so grow/keep/die stop in place.
    if (!lifecyclePausedRef?.current) {
      const lifetime = durations.delay + durations.grow + durations.keep + durations.die;
      ageRef.current += Math.min(delta, 0.1);
      if (ageRef.current >= lifetime) {
        ageRef.current -= lifetime;
        setGeneration((g) => g + 1); // regrow a fresh flower (new direction + timing)
      }
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

    if (meshRef.current) {
      // draw-range grows the tube during grow, retracts it during die. When there
      // is nothing to draw (delay / just-born / fully-wilted) hide the mesh: a
      // 0-index draw on a castShadow mesh throws "No pipeline set" in the shadow
      // pass and drops the stem from the shadow map, so its cast shadow vanishes.
      const drawCount = Math.ceil(stemGrow * stemSegments) * radialSegs * 6;
      meshRef.current.geometry.setDrawRange(0, drawCount);
      meshRef.current.visible = drawCount > 0;
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

    flowerFrameRef.current = flowerFrame; // reverse-capable ratio → FlowerVAT

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
      <mesh ref={meshRef} geometry={geometry} material={stemMaterial}
            frustumCulled={false} castShadow visible={false} />
      <StemLeaves
        curveRef={curveRef}
        windSway={windSway}
        stemGrowU={stemGrowU}
        flowerUniforms={flowerUniforms}
        seed={effSeed}
        leafCount={leafCount}
        leafSpan={leafSpan}
        leafScale={leafScale}
        scaleVariance={scaleVariance}
        droop={droop}
        leafBend={leafBend}
        curlStrength={curlStrength}
        curlPower={curlPower}
        bendStrength={bendStrength}
        bendVariance={bendVariance}
        colorLevels={colorLevels}
        stemLength={stemLength}
        leanAngle={leanAngle}
        bendDegree={bendDegree}
        stemRadius={stemRadius}
        radiusAttenuation={radiusAttenuation}
        baseFlare={baseFlare}
      />
      <group ref={tipGroupRef}>
        <VatFlower
          metaUrl={flowerType.metaUrl}
          scaleMul={stemRadius * (
            flowerControls?.flowerSize
            ?? flowerType.materialDefaults?.flowerSize
            ?? 4.2
          )}
          frameRatio={flowerFrameRef}
          stemYMax={stemYMax}
          partColorMode={flowerType.partColorMode}
          usePetalCutout={flowerType.usePetalCutout !== false}
          useMaskEdge={flowerType.useMaskEdge !== false}
          maskPath={flowerType.maskPath}
          flowerUniforms={flowerUniforms}
          maskUniforms={maskUniforms}
        />
      </group>
    </group>
  );
}
