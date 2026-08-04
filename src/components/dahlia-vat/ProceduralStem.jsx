import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  createFlowerMaskUniforms,
  createFlowerOutlineUniforms,
  createFlowerStemMaterial,
  createFlowerUniforms,
} from '../flower/createFlowerMaterials';
import {
  createFlowerControlsSchema,
  syncFlowerControls,
} from '../flower/flowerControls';

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

export function ProceduralStem({
  position = [0, 0, 0],
  scaleMul = 1,
  timeOffset = 0,
}) {
  const {
    stemLength, stemRadius, stemSegments, radialSegs,
    radiusAttenuation, baseFlare,
    leanAngle, bendDegree,
    growthSpeed, seed,
  } = useControls('Stem', {
    stemLength:        { value: 0.55,  min: 0.05, max: 2,    step: 0.01 },
    stemRadius:        { value: 0.012, min: 0.002, max: 0.06, step: 0.001 },
    stemSegments:      { value: 32,   min: 4,    max: 128,  step: 1 },
    radialSegs:        { value: 8,    min: 3,    max: 16,   step: 1 },
    radiusAttenuation: { value: 0.4,  min: 0,    max: 1,    step: 0.01, label: 'taper' },
    baseFlare:         { value: 0.25, min: 0,    max: 1,    step: 0.01 },
    leanAngle:         { value: 5,    min: 0,    max: 45,   step: 0.5,  label: 'lean °' },
    bendDegree:        { value: 0.12, min: 0,    max: 0.35, step: 0.005 },
    growthSpeed:       { value: 0.6,  min: 0.05, max: 4,    step: 0.05 },
    seed:              { value: 42,   min: 0,    max: 999,  step: 1 },
  }, { collapsed: true });

  const flowerControlsSchema = useMemo(
    () => createFlowerControlsSchema({ mask: { edgeWidth: 0.001 } }),
    [],
  );
  const flowerControls = useControls('Flower', flowerControlsSchema, { collapsed: true });

  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);
  const outlineUniforms = useMemo(() => createFlowerOutlineUniforms(), []);

  useEffect(() => {
    syncFlowerControls(flowerControls, flowerUniforms, maskUniforms, outlineUniforms);
  }, [flowerControls, flowerUniforms, maskUniforms, outlineUniforms]);

  const stemMaterial = useMemo(
    () => createFlowerStemMaterial(flowerUniforms),
    [flowerUniforms],
  );
  useEffect(() => () => stemMaterial.dispose(), [stemMaterial]);

  const curveRef = useRef(null);

  const geometry = useMemo(() => {
    const rng = seededRng(seed);
    const length = stemLength * scaleMul;

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
  }, [stemLength, scaleMul, leanAngle, bendDegree, seed,
      stemSegments, stemRadius, radialSegs, radiusAttenuation, baseFlare]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const meshRef = useRef(null);
  const tipGroupRef = useRef(null);
  const tipPos = useRef(new THREE.Vector3());
  const tipQuat = useRef(new THREE.Quaternion());

  // Reset growth when geometry is rebuilt so growth always starts from 0
  const startTimeRef = useRef(null);
  useEffect(() => { startTimeRef.current = null; }, [geometry]);

  const directionalLightRef = useRef(null);
  const lightWorldPosition = useRef(new THREE.Vector3());
  const lightTargetPosition = useRef(new THREE.Vector3());

  useFrame(({ clock, scene }) => {
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

    if (startTimeRef.current === null) startTimeRef.current = clock.elapsedTime;

    const elapsed = clock.elapsedTime - startTimeRef.current - timeOffset;
    const raw = Math.min(Math.max(elapsed * growthSpeed, 0), 1);
    const progress = 1 - Math.pow(1 - raw, 3); // easeOutCubic

    const geo = meshRef.current?.geometry;
    if (geo) {
      geo.setDrawRange(0, Math.ceil(progress * stemSegments) * radialSegs * 6);
    }

    const curve = curveRef.current;
    if (curve) {
      const t = Math.max(progress, 0.001);
      curve.getPointAt(t, tipPos.current);
      // Rotate group so its local Y aligns with the curve tangent —
      // any child placed inside will automatically face along the stem direction
      tipQuat.current.setFromUnitVectors(_up, curve.getTangentAt(t));
    }

    if (tipGroupRef.current) {
      tipGroupRef.current.position.copy(tipPos.current);
      tipGroupRef.current.quaternion.copy(tipQuat.current);
    }
  }, 1);

  return (
    <group position={position}>
      <mesh ref={meshRef} geometry={geometry} material={stemMaterial}
            frustumCulled={false} castShadow />
      <group ref={tipGroupRef}>
        <mesh>
          <boxGeometry args={[0.05, 0.05, 0.05]} />
          <meshBasicMaterial color="hotpink" />
        </mesh>
      </group>
    </group>
  );
}
