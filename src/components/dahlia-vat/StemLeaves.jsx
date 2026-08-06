import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import {
  clamp, instanceIndex, positionGeometry, positionLocal, pow, uniform, uniformArray, vec3,
} from 'three/tsl';
import { createFlowerStemMaterial } from '../flower/createFlowerMaterials';
import { WIND_MASK_POW } from './wind';

const LEAF_URL = '/models/leaf.glb';
useGLTF.preload(LEAF_URL);

// Same LCG as ProceduralStem so leaf jitter is reproducible per stem seed.
function seededRng(seed) {
  let s = ((seed + 1) * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// leaf.glb: node has a 180° Y flip + ~1.015 scale; baking matrixWorld into the
// geometry stands it up in the petal convention — length along +Z (root at ~0,
// tip at +Z), blade up-face normal ≈ +Y, width along X.
function useLeafGeometry() {
  const gltf = useGLTF(LEAF_URL);
  return useMemo(() => {
    let src = null;
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse((o) => { if (!src && o.isMesh) src = o; });
    const geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);
    geo.computeBoundingBox();
    return geo;
  }, [gltf]);
}

// Scatters `leafCount` leaves along the stem curve as one InstancedMesh. Placement
// + orientation live in the instanceMatrix; wind + grow run entirely on the GPU in
// the SAME stem-local/world space as the stem shader (the stem group is only
// translated), driven by the stem's existing `windSway` / `stemGrowU` uniforms.
//
// NB: three applies the InstancedMesh `instanceMatrix` to positionLocal BEFORE the
// material's positionNode runs (NodeMaterial.setupPosition), so inside positionNode
// `positionLocal` is already the leaf vertex placed in stem-local space. We use the
// raw `positionGeometry.z` for the along-leaf height mask, and per-instance attach
// data (point + curve param) via a uniformArray indexed by instanceIndex.
export function StemLeaves({
  curveRef,
  windSway, // uniform(Vector2) world XZ sway (constant dir, gusting magnitude)
  stemGrowU, // uniform(float) raw grow progress 0→1
  flowerUniforms,
  seed = 0,
  leafCount = 4,
  // stem geometry (drive rebuild + surface offset; must match ProceduralStem)
  stemLength = 0.55,
  leanAngle = 5,
  bendDegree = 0.12,
  stemRadius = 0.012,
  radiusAttenuation = 0.4,
  baseFlare = 0.25,
  // leaf tuning
  leafScale = 0.35, // leaf length as a fraction of stem length
  droop = 0.5, // tip droop about the width axis, radians
  bendStrength = 3, // extra downwind tip trail (× wind sway × height mask)
}) {
  const leafGeometry = useLeafGeometry();
  const meshRef = useRef(null);

  // Live-tunable tip-flex amount without recompiling the shader.
  const bendStrengthU = useMemo(() => uniform(bendStrength), []);
  useEffect(() => { bendStrengthU.value = bendStrength; }, [bendStrength, bendStrengthU]);

  // Built once per leafCount: per-instance attach data + the TSL material. `packArr`
  // holds [attach.xyz (stem-local), attach t] per leaf; the uniformArray re-uploads
  // it every render, so we just mutate it in place on regrow (below).
  const { material, packArr } = useMemo(() => {
    // Keep at least one element so the uniformArray can infer its layout even when
    // no leaves are drawn (count 0 renders nothing; the extra slot is unused).
    const packArr = Array.from({ length: Math.max(leafCount, 1) }, () => new THREE.Vector4());
    const packU = uniformArray(packArr, 'vec4');

    const bb = leafGeometry.boundingBox;
    const zMin = bb.min.z;
    const zSpan = Math.max(bb.max.z - bb.min.z, 1e-4);

    const pack = packU.element(instanceIndex);
    const attach = pack.xyz;
    const attachT = pack.w;

    // Height along the leaf (0 root → 1 tip) from the RAW geometry, unaffected by
    // the instance transform baked into positionLocal.
    const hmask = clamp(positionGeometry.z.sub(zMin).div(zSpan), 0, 1);
    // Grow: leaf unfurls from its attach point as the stem grow front passes it.
    const growFrac = clamp(stemGrowU.sub(attachT).div(0.05), 0, 1);
    const grown = attach.add(positionLocal.sub(attach).mul(growFrac));

    // Wind in world XZ, exactly like the stem: rigid follow (pow(t,POW), welds the
    // leaf to the bent stem) + per-vertex tip trail (hmask × bendStrength).
    const windVec = vec3(windSway.x, 0.0, windSway.y);
    const followMask = pow(attachT, WIND_MASK_POW);
    const disp = windVec.mul(followMask.add(hmask.mul(bendStrengthU)));

    const material = createFlowerStemMaterial(flowerUniforms); // toon/ink/grain fragment
    material.positionNode = grown.add(disp.mul(growFrac));

    return { material, packArr };
  }, [leafGeometry, leafCount, windSway, stemGrowU, flowerUniforms, bendStrengthU]);

  useEffect(() => () => material.dispose(), [material]);

  // Bake placement whenever the stem curve is regenerated (seed / geometry params).
  // curveRef.current is refreshed during the parent's render, before this runs.
  useEffect(() => {
    const mesh = meshRef.current;
    const curve = curveRef.current;
    if (!mesh || !curve) return;

    const rng = seededRng(seed);
    const azJitter = rng() * Math.PI * 2;

    const bb = leafGeometry.boundingBox;
    const leafLocalLen = Math.max(bb.max.z - bb.min.z, 1e-4);
    const scaleVal = (leafScale * stemLength) / leafLocalLen;

    const up = new THREE.Vector3(0, 1, 0);
    const altX = new THREE.Vector3(1, 0, 0);
    const T = new THREE.Vector3();
    const P = new THREE.Vector3();
    const side = new THREE.Vector3();
    const binorm = new THREE.Vector3();
    const outward = new THREE.Vector3();
    const xAxis = new THREE.Vector3();
    const yAxis = new THREE.Vector3();
    const zAxis = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const droopQ = new THREE.Quaternion().setFromAxisAngle(altX, droop);
    const scaleVec = new THREE.Vector3(scaleVal, scaleVal, scaleVal);
    const pos = new THREE.Vector3();
    const m = new THREE.Matrix4();

    for (let i = 0; i < leafCount; i++) {
      const t = leafCount === 1 ? 0.4 : THREE.MathUtils.lerp(0.14, 0.72, i / (leafCount - 1));
      curve.getPointAt(t, P);
      curve.getTangentAt(t, T).normalize();

      // Stable frame perpendicular to the stem tangent.
      side.crossVectors(T, up);
      if (side.lengthSq() < 1e-6) side.crossVectors(T, altX);
      side.normalize();
      binorm.crossVectors(side, T).normalize();

      // Alternate leaves to opposite sides, with a little seeded jitter.
      const az = i * Math.PI + azJitter + (rng() - 0.5) * 0.6;
      outward.copy(side).multiplyScalar(Math.cos(az))
        .addScaledVector(binorm, Math.sin(az)).normalize();

      // Right-angle basis: leaf +Z=outward, +Y=tangent, +X=Y×Z; then droop the tip.
      zAxis.copy(outward);
      yAxis.copy(T);
      xAxis.crossVectors(yAxis, zAxis).normalize();
      yAxis.crossVectors(zAxis, xAxis).normalize();
      basis.makeBasis(xAxis, yAxis, zAxis);
      q.setFromRotationMatrix(basis).multiply(droopQ);

      // Root sits on the tapered tube surface at t.
      const surf = ((1 - (1 - radiusAttenuation) * t) + baseFlare * Math.pow(1 - t, 3)) * stemRadius;
      pos.copy(P).addScaledVector(outward, surf);
      mesh.setMatrixAt(i, m.compose(pos, q, scaleVec));

      // Per-instance attach point (stem-local) + curve param for wind/grow.
      packArr[i].set(pos.x, pos.y, pos.z, t);
    }

    mesh.count = leafCount;
    mesh.instanceMatrix.needsUpdate = true;
  }, [curveRef, seed, leafCount, stemLength, leanAngle, bendDegree, stemRadius,
      radiusAttenuation, baseFlare, leafGeometry, leafScale, droop, packArr]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[leafGeometry, material, leafCount]}
      frustumCulled={false}
      castShadow
    />
  );
}
