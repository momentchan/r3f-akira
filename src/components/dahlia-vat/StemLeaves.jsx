import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  clamp, cos, faceDirection, instanceIndex, mix, normalGeometry, positionGeometry,
  pow, sin, smoothstep, uniform, uniformArray, vec3,
} from 'three/tsl';
import { createFlowerStemMaterial } from '../flower/createFlowerMaterials';
import { WIND_MASK_POW } from './wind';

// How much of the stem's grow progress a leaf takes to unfurl once the grow front
// reaches its attach point (larger = slower/gentler; kept < the gap to the tip so
// the top leaf still finishes before the stem is fully grown).
const GROW_WINDOW = 0.28;

// Rotate a vector about the leaf's local X axis by `angle` (the Blender bend axis).
const rotateX = (v, angle) => {
  const c = cos(angle);
  const s = sin(angle);
  return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
};

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
    let geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);
    // leaf.glb ships flat/faceted normals, so the toon shade reads as hard triangle
    // facets. Drop normal + uv (we don't sample uv), weld split vertices by position,
    // then rebuild smooth vertex normals so the leaf shades as one continuous surface.
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
  }, [gltf]);
}

// Scatters `leafCount` leaves along the stem curve as one InstancedMesh. Everything
// runs on the GPU from per-instance uniforms (indexed by instanceIndex): the leaf is
// placed, oriented, BENT (Blender-style curl), grown and wind-swayed in the vertex
// shader. We work from the raw `positionGeometry`/`normalGeometry` (instance-matrix-
// independent) and build the full transform ourselves, so the built-in instanceMatrix
// is left identity. All motion is driven by the stem's existing windSway/stemGrowU.
export function StemLeaves({
  curveRef,
  windSway, // uniform(Vector2) world XZ sway (constant dir, gusting magnitude)
  stemGrowU, // uniform(float) raw grow progress 0→1
  flowerUniforms,
  seed = 0,
  leafCount = 4,
  leafSpan = [0.2, 0.8], // [lo, hi] fraction of stem length the leaves spawn along
  // stem geometry (drive rebuild + surface offset; must match ProceduralStem)
  stemLength = 0.55,
  leanAngle = 5,
  bendDegree = 0.12,
  stemRadius = 0.012,
  radiusAttenuation = 0.4,
  baseFlare = 0.25,
  // leaf tuning
  leafScale = 0.35, // leaf length as a fraction of stem length
  scaleVariance = 0.3, // per-leaf random size spread (±fraction)
  droop = 0.5, // whole-leaf tip droop about the width axis, radians (orientation)
  leafBend = 0.6, // Blender-style progressive curl: rotate about X by z·leafBend
  // Unfurl animation, lerped start→end across the grow:
  curlStrength = [3, 1], // curl magnitude × (start, end) — born 3× curled → 1× (target)
  curlPower = [1, 1], // curl distribution along length (start, end): <1 = curl toward
  //   the base (tighter coil), 1 = linear, >1 = concentrated at the tip
  bendStrength = 3, // extra downwind tip trail (× wind sway × height mask)
  bendVariance = 0.3, // per-leaf random curl (bend) spread (±fraction)
  colorLevels = 6, // toon quantization steps on the leaf (higher = smoother)
}) {
  const leafGeometry = useLeafGeometry();
  const meshRef = useRef(null);
  const { gl, scene, camera } = useThree();

  // Live-tunable without recompiling the shader.
  const bendStrengthU = useMemo(() => uniform(bendStrength), []);
  useEffect(() => { bendStrengthU.value = bendStrength; }, [bendStrength, bendStrengthU]);
  const colorLevelsU = useMemo(() => uniform(colorLevels), []);
  useEffect(() => { colorLevelsU.value = colorLevels; }, [colorLevels, colorLevelsU]);
  const leafBendU = useMemo(() => uniform(leafBend), []);
  useEffect(() => { leafBendU.value = leafBend; }, [leafBend, leafBendU]);
  const curlStrengthU = useMemo(() => uniform(new THREE.Vector2(3, 1)), []);
  useEffect(() => { curlStrengthU.value.set(curlStrength[0], curlStrength[1]); },
    [curlStrength, curlStrengthU]);
  const curlPowerU = useMemo(() => uniform(new THREE.Vector2(1, 1)), []);
  useEffect(() => { curlPowerU.value.set(curlPower[0], curlPower[1]); },
    [curlPower, curlPowerU]);
  const scaleU = useMemo(() => uniform(1), []); // leaf scale (per stem), set on placement

  // Built once per leafCount: per-instance uniform arrays + the TSL material. `packArr`
  // holds [attach.xyz (stem-local), attach t]; `basisArr` holds each leaf's orientation
  // (rotation incl. droop). Both re-upload every render, so we mutate them in place on
  // regrow (below) rather than rebuilding the material.
  const { material, packArr, basisArr, varArr } = useMemo(() => {
    // Keep ≥1 element so the uniform arrays can infer layout even with 0 leaves drawn.
    const n = Math.max(leafCount, 1);
    const packArr = Array.from({ length: n }, () => new THREE.Vector4());
    const basisArr = Array.from({ length: n }, () => new THREE.Matrix3());
    const varArr = Array.from({ length: n }, () => new THREE.Vector2(1, 1));
    const packU = uniformArray(packArr, 'vec4');
    const basisU = uniformArray(basisArr, 'mat3');
    const varU = uniformArray(varArr, 'vec2'); // per-leaf [size mul, wind-flex mul]

    const bb = leafGeometry.boundingBox;
    const zMin = bb.min.z;
    const zSpan = Math.max(bb.max.z - bb.min.z, 1e-4);

    const pack = packU.element(instanceIndex);
    const attach = pack.xyz; // leaf root on the tube surface (stem-local)
    const attachT = pack.w; // curve param at the attach point
    const basis = basisU.element(instanceIndex); // leaf-local → stem-local rotation
    const vary = varU.element(instanceIndex); // [size mul, curl mul]
    const p = positionGeometry;

    // Grow progress for this leaf: 0 when the stem grow front reaches its attach point,
    // eased up to 1 over GROW_WINDOW of stem-grow progress for a slow, natural reveal.
    const growFrac = smoothstep(attachT, attachT.add(GROW_WINDOW), stemGrowU);
    // Normalized position along the leaf (0 root → 1 tip).
    const hmask = clamp(p.z.sub(zMin).div(zSpan), 0, 1);

    // Blender bend: curl about the leaf's X axis. The unfurl animates start→end over
    // the grow, from TWO vectors: `curlStrength` = curl magnitude (× leafBend) and
    // `curlPower` = how the curl distributes along the length (pow on hmask: <1 curls
    // toward the base → tighter overall coil, >1 concentrates at the tip). × per-leaf
    // curl variance (vary.y). Born curled (start), relaxing to the target (end).
    const strength = mix(curlStrengthU.x, curlStrengthU.y, growFrac);
    const power = mix(curlPowerU.x, curlPowerU.y, growFrac);
    const shape = pow(hmask, power).mul(zSpan); // = p.z when power = 1
    const theta = shape.mul(leafBendU).mul(vary.y).mul(strength);
    const bentP = rotateX(p, theta);

    // Orient + scale the bent leaf, then grow it. Per-leaf size variance rides the
    // SAME grow multiply (varies the max size each leaf grows toward) — scaling about
    // the attach point, so the root stays welded at any size.
    const leafPos = basis.mul(bentP.mul(scaleU));
    const placed = attach.add(leafPos.mul(growFrac.mul(vary.x)));

    // Wind in world XZ, exactly like the stem: rigid follow (pow(t,POW), welds the
    // leaf to the bent stem) + per-vertex tip trail (hmask × bendStrength).
    const windVec = vec3(windSway.x, 0.0, windSway.y);
    const followMask = pow(attachT, WIND_MASK_POW);
    const disp = windVec.mul(followMask.add(hmask.mul(bendStrengthU)));

    // Normal follows the same bend + orientation so the curl shades correctly.
    const worldN = basis.mul(rotateX(normalGeometry, theta));

    // Reuse the stem's toon look, but override two things for leaves (the stem itself
    // is untouched — shared uniforms stay Leva-synced):
    //  • colorLevels: the leaf's own step count.
    //  • edgeThreshold = -1: DISABLE the grazing ink-edge. It's meant for the thin
    //    stem silhouette, but on a broad/curling leaf large grazing areas (e.g. the
    //    bent tip) would get inked near-black. faceDirection still gives two-sided
    //    lighting (undersides lit, not black).
    const leafUniforms = {
      ...flowerUniforms,
      stem: {
        ...flowerUniforms.stem,
        colorLevels: colorLevelsU,
        edgeThreshold: uniform(-1),
      },
    };
    const material = createFlowerStemMaterial(leafUniforms, {
      normalSource: worldN.mul(faceDirection),
    });
    material.positionNode = placed.add(disp.mul(growFrac));

    return { material, packArr, basisArr, varArr };
  }, [leafGeometry, leafCount, windSway, stemGrowU, flowerUniforms,
      bendStrengthU, colorLevelsU, leafBendU, curlStrengthU, curlPowerU, scaleU]);

  useEffect(() => () => material.dispose(), [material]);

  // Warm the leaf pipelines once the material is ready. useGLTF suspends this
  // component until leaf.glb loads, so the mesh mounts AFTER StemArrangement's
  // startup precompile — without this, the first draw logs "No pipeline set"
  // until the pipeline finishes compiling async.
  useEffect(() => {
    if (typeof gl.compileAsync !== 'function') return;
    const raf = requestAnimationFrame(() => { gl.compileAsync(scene, camera).catch(() => {}); });
    return () => cancelAnimationFrame(raf);
  }, [gl, scene, camera, material]);

  // Bake placement whenever the stem curve is regenerated (seed / geometry params).
  // curveRef.current is refreshed during the parent's render, before this runs. We
  // fill the uniform arrays (attach point + orientation) that the shader reads; the
  // instanceMatrix is left identity since the shader builds the full transform.
  useEffect(() => {
    const mesh = meshRef.current;
    const curve = curveRef.current;
    if (!mesh || !curve) return;

    const rng = seededRng(seed);
    const azJitter = rng() * Math.PI * 2;

    const bb = leafGeometry.boundingBox;
    const leafLocalLen = Math.max(bb.max.z - bb.min.z, 1e-4);
    scaleU.value = (leafScale * stemLength) / leafLocalLen;

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
    const pos = new THREE.Vector3();
    const identity = new THREE.Matrix4();

    const [spanLo, spanHi] = leafSpan; // fraction of stem length leaves spawn between
    for (let i = 0; i < leafCount; i++) {
      const t = leafCount === 1
        ? (spanLo + spanHi) * 0.5
        : THREE.MathUtils.lerp(spanLo, spanHi, i / (leafCount - 1));
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

      // Per-leaf random size + curl (bend) multipliers (±variance around 1).
      const scaleMul = Math.max(1 + (rng() - 0.5) * 2 * scaleVariance, 0.1);
      const bendMul = Math.max(1 + (rng() - 0.5) * 2 * bendVariance, 0);
      varArr[i].set(scaleMul, bendMul);

      // Right-angle basis: leaf +Z=outward, +Y=tangent, +X=Y×Z; then droop the tip.
      zAxis.copy(outward);
      yAxis.copy(T);
      xAxis.crossVectors(yAxis, zAxis).normalize();
      yAxis.crossVectors(zAxis, xAxis).normalize();
      basis.makeBasis(xAxis, yAxis, zAxis);
      q.setFromRotationMatrix(basis).multiply(droopQ);
      basis.makeRotationFromQuaternion(q);
      basisArr[i].setFromMatrix4(basis); // orientation (incl. droop) → shader

      // Root sits on the tapered tube surface at t.
      const surf = ((1 - (1 - radiusAttenuation) * t) + baseFlare * Math.pow(1 - t, 3)) * stemRadius;
      pos.copy(P).addScaledVector(outward, surf);
      packArr[i].set(pos.x, pos.y, pos.z, t); // attach point + curve param
      mesh.setMatrixAt(i, identity); // shader does the transform; keep matrix identity
    }

    mesh.count = leafCount;
    mesh.instanceMatrix.needsUpdate = true;
  }, [curveRef, seed, leafCount, leafSpan, stemLength, leanAngle, bendDegree, stemRadius,
      radiusAttenuation, baseFlare, leafGeometry, leafScale, droop,
      scaleVariance, bendVariance, packArr, basisArr, varArr, scaleU]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[leafGeometry, material, leafCount]}
      frustumCulled={false}
    />
  );
}
