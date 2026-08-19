import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { enablePlantShadowLayer } from '../../scene/plantShadowLayer';
import {
  attribute,
  clamp,
  cos,
  faceDirection,
  float,
  mix,
  normalGeometry,
  positionGeometry,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { createFlowerStemMaterial, rotateYNode } from '../look/createFlowerMaterials';
import { STEM_DEFAULTS } from './stemDefaults';
import { WIND_MASK_POW } from './wind';

const GROW_WINDOW = 0.28;
const LEAF_URL = '/models/leaf.glb';
useGLTF.preload(LEAF_URL);

const rotateX = (v, angle) => {
  const c = cos(angle);
  const s = sin(angle);
  return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
};

function seededRng(seed) {
  let s = ((seed + 1) * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function useLeafGeometry() {
  const gltf = useGLTF(LEAF_URL);
  return useMemo(() => {
    let src = null;
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse((o) => { if (!src && o.isMesh) src = o; });
    let geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
  }, [gltf]);
}

/**
 * One InstancedMesh for every leaf in the field. Per-leaf placement is baked;
 * grow + wind come from the shared plant DataTexture via plantId (aVar.z).
 */
export function FieldLeaves({
  plants = [],
  plantData = null, // { tex, width }
  flowerUniforms,
  leafCount = STEM_DEFAULTS.leaves.leafCount,
  leafSpan = STEM_DEFAULTS.leaves.leafSpan,
  leafScale = STEM_DEFAULTS.leaves.leafScale,
  scaleVariance = STEM_DEFAULTS.leaves.scaleVariance,
  droop = STEM_DEFAULTS.leaves.droop,
  leafBend = STEM_DEFAULTS.leaves.leafBend,
  curlStrength = [
    STEM_DEFAULTS.leaves.curlStrengthStart,
    STEM_DEFAULTS.leaves.curlStrengthEnd,
  ],
  curlPower = [
    STEM_DEFAULTS.leaves.curlPowerStart,
    STEM_DEFAULTS.leaves.curlPowerEnd,
  ],
  bendStrength = STEM_DEFAULTS.leaves.bendStrength,
  bendVariance = STEM_DEFAULTS.leaves.bendVariance,
  colorLevels = STEM_DEFAULTS.leaves.colorLevels,
}) {
  const leafGeometry = useLeafGeometry();
  const meshRef = useRef(null);
  // Leaves are the largest shadow caster on the character, so they need the
  // plant shadow layer alongside the stems and flower heads.
  const attachMesh = useCallback((mesh) => {
    meshRef.current = mesh;
    enablePlantShadowLayer(mesh);
  }, []);
  const total = Math.max(plants.length * Math.max(leafCount, 0), 0);

  const bendStrengthU = useMemo(() => uniform(bendStrength), []);
  useEffect(() => { bendStrengthU.value = bendStrength; }, [bendStrength, bendStrengthU]);
  const colorLevelsU = useMemo(() => uniform(colorLevels), []);
  useEffect(() => { colorLevelsU.value = colorLevels; }, [colorLevels, colorLevelsU]);
  const leafBendU = useMemo(() => uniform(leafBend), []);
  useEffect(() => { leafBendU.value = leafBend; }, [leafBend, leafBendU]);
  const curlStrengthU = useMemo(() => uniform(new THREE.Vector2(3, 1)), []);
  useEffect(() => {
    curlStrengthU.value.set(curlStrength[0], curlStrength[1]);
  }, [curlStrength, curlStrengthU]);
  const curlPowerU = useMemo(() => uniform(new THREE.Vector2(1, 1)), []);
  useEffect(() => {
    curlPowerU.value.set(curlPower[0], curlPower[1]);
  }, [curlPower, curlPowerU]);

  const { geometry, material, attrs } = useMemo(() => {
    if (!plantData || total < 1) {
      return { geometry: null, material: null, attrs: null };
    }

    const n = total;
    const geometry = leafGeometry.clone();
    const aPack = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const aBx = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const aBy = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const aBz = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    // x = size scale, y = curl mul, z = plantId
    const aVar = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    geometry.setAttribute('aPack', aPack);
    geometry.setAttribute('aBx', aBx);
    geometry.setAttribute('aBy', aBy);
    geometry.setAttribute('aBz', aBz);
    geometry.setAttribute('aVar', aVar);

    const bb = leafGeometry.boundingBox;
    const zMin = bb.min.z;
    const zSpan = Math.max(bb.max.z - bb.min.z, 1e-4);
    const uTexWidth = uniform(plantData.width);
    const rows = Math.max(1, plantData.rows ?? 1);
    // Row 1 (when present) carries the plant's runtime world offset + yaw, so a
    // respawned plant can move/turn without rebaking leaf attach points.
    const hasTransformRow = rows >= 2;
    const dataUVAt = (plantId, row) => vec2(
      plantId.add(0.5).div(uTexWidth),
      float((row + 0.5) / rows),
    );

    const p = positionGeometry;
    const pack = attribute('aPack', 'vec4');
    const attachT = pack.w;
    const vary = attribute('aVar', 'vec3');

    const data = texture(plantData.tex, dataUVAt(vary.z, 0));
    const stemGrow = data.r;
    const windSway = vec2(data.g, data.b);

    // Turn the baked attach point + orientation basis with the plant.
    let attach = pack.xyz;
    let bx = attribute('aBx', 'vec3');
    let by = attribute('aBy', 'vec3');
    let bz = attribute('aBz', 'vec3');
    if (hasTransformRow) {
      const xform = texture(plantData.tex, dataUVAt(vary.z, 1));
      const yaw = xform.a;
      attach = rotateYNode(attach, yaw).add(xform.xyz);
      bx = rotateYNode(bx, yaw);
      by = rotateYNode(by, yaw);
      bz = rotateYNode(bz, yaw);
    }
    const applyBasis = (v) => bx.mul(v.x).add(by.mul(v.y)).add(bz.mul(v.z));

    const growFrac = smoothstep(attachT, attachT.add(GROW_WINDOW), stemGrow);
    const hmask = clamp(p.z.sub(zMin).div(zSpan), 0, 1);

    const strength = mix(curlStrengthU.x, curlStrengthU.y, growFrac);
    const power = mix(curlPowerU.x, curlPowerU.y, growFrac);
    const shape = pow(hmask, power).mul(zSpan);
    const theta = shape.mul(leafBendU).mul(vary.y).mul(strength);
    const bentP = rotateX(p, theta);

    // vary.x already includes leafScale * stemLength / localLen * sizeMul
    const leafPos = applyBasis(bentP.mul(vary.x));
    const placed = attach.add(leafPos.mul(growFrac));

    const windVec = vec3(windSway.x, 0.0, windSway.y);
    const followMask = pow(attachT, float(WIND_MASK_POW));
    const disp = windVec.mul(followMask.add(hmask.mul(bendStrengthU)));
    const worldN = applyBasis(rotateX(normalGeometry, theta));

    const leafUniforms = {
      ...flowerUniforms,
      stem: {
        ...flowerUniforms.stem,
        colorLevels: colorLevelsU,
      },
    };
    const material = createFlowerStemMaterial(leafUniforms, {
      normalSource: worldN.mul(faceDirection),
    });
    material.positionNode = placed.add(disp.mul(growFrac));

    return {
      geometry,
      material,
      attrs: { aPack, aBx, aBy, aBz, aVar },
    };
  }, [
    leafGeometry, total, plantData, flowerUniforms,
    bendStrengthU, colorLevelsU, leafBendU, curlStrengthU, curlPowerU,
  ]);

  useEffect(() => () => {
    material?.dispose();
    geometry?.dispose();
  }, [material, geometry]);

  // Bake leaf placement in field space whenever stems / leaf params change.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !attrs || !plants.length || leafCount < 1) return;

    const { aPack, aBx, aBy, aBz, aVar } = attrs;
    const bb = leafGeometry.boundingBox;
    const leafLocalLen = Math.max(bb.max.z - bb.min.z, 1e-4);
    // With a transform row the shader places the plant, so bake attach points in
    // plant-local space; otherwise fold the (static) world offset in here.
    const useTransformRow = (plantData?.rows ?? 1) >= 2;

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
    const col = new THREE.Vector3();
    const identity = new THREE.Matrix4();
    const spanLo = THREE.MathUtils.clamp(Math.min(leafSpan[0], leafSpan[1]), 0, 1);
    const spanHi = THREE.MathUtils.clamp(Math.max(leafSpan[0], leafSpan[1]), 0, 1);

    let leafIndex = 0;
    for (let p = 0; p < plants.length; p++) {
      const plant = plants[p];
      const curve = plant.curve;
      const rng = seededRng(plant.seed + 91);
      // Give every leaf its own stable random attachment point. Keep this on a
      // separate stream so changing placement does not reshuffle orientation,
      // scale, or bend variation.
      const positionRng = seededRng(plant.seed + 193);
      const attachTs = Array.from(
        { length: leafCount },
        () => THREE.MathUtils.lerp(spanLo, spanHi, positionRng()),
      ).sort((a, b) => a - b);
      const azJitter = rng() * Math.PI * 2;
      const {
        stemLength,
        stemRadius,
        radiusAttenuation,
        baseFlare,
        radiusStartScale,
        radiusEndScale,
        baseFlareScale = 1,
      } = plant.params;
      const baseScale = (leafScale * stemLength) / leafLocalLen;
      const [ox, oy, oz] = useTransformRow ? [0, 0, 0] : plant.position;

      for (let i = 0; i < leafCount; i++) {
        const t = attachTs[i];
        curve.getPointAt(t, P);
        curve.getTangentAt(t, T).normalize();

        side.crossVectors(T, up);
        if (side.lengthSq() < 1e-6) side.crossVectors(T, altX);
        side.normalize();
        binorm.crossVectors(side, T).normalize();

        const az = i * Math.PI + azJitter + (rng() - 0.5) * 0.6;
        outward.copy(side).multiplyScalar(Math.cos(az))
          .addScaledVector(binorm, Math.sin(az)).normalize();

        const scaleMul = Math.max(1 + (rng() - 0.5) * 2 * scaleVariance, 0.1);
        const bendMul = Math.max(1 + (rng() - 0.5) * 2 * bendVariance, 0);
        aVar.array[leafIndex * 3] = baseScale * scaleMul;
        aVar.array[leafIndex * 3 + 1] = bendMul;
        aVar.array[leafIndex * 3 + 2] = plant.plantId;

        zAxis.copy(outward);
        yAxis.copy(T);
        xAxis.crossVectors(yAxis, zAxis).normalize();
        yAxis.crossVectors(zAxis, xAxis).normalize();
        basis.makeBasis(xAxis, yAxis, zAxis);
        q.setFromRotationMatrix(basis).multiply(droopQ);
        basis.makeRotationFromQuaternion(q);
        col.setFromMatrixColumn(basis, 0);
        aBx.array[leafIndex * 3] = col.x;
        aBx.array[leafIndex * 3 + 1] = col.y;
        aBx.array[leafIndex * 3 + 2] = col.z;
        col.setFromMatrixColumn(basis, 1);
        aBy.array[leafIndex * 3] = col.x;
        aBy.array[leafIndex * 3 + 1] = col.y;
        aBy.array[leafIndex * 3 + 2] = col.z;
        col.setFromMatrixColumn(basis, 2);
        aBz.array[leafIndex * 3] = col.x;
        aBz.array[leafIndex * 3 + 1] = col.y;
        aBz.array[leafIndex * 3 + 2] = col.z;

        const hasBranchRadiusProfile = Number.isFinite(radiusStartScale)
          && Number.isFinite(radiusEndScale);
        const smoothT = t * t * (3 - 2 * t);
        const radiusScale = hasBranchRadiusProfile
          ? radiusStartScale
            + (radiusEndScale - radiusStartScale) * smoothT
            + baseFlare * baseFlareScale * Math.pow(1 - t, 3)
          : (1 - (1 - radiusAttenuation) * t) + baseFlare * Math.pow(1 - t, 3);
        const surf = radiusScale * stemRadius;
        pos.copy(P).addScaledVector(outward, surf);
        aPack.array[leafIndex * 4] = pos.x + ox;
        aPack.array[leafIndex * 4 + 1] = pos.y + oy;
        aPack.array[leafIndex * 4 + 2] = pos.z + oz;
        aPack.array[leafIndex * 4 + 3] = t;

        mesh.setMatrixAt(leafIndex, identity);
        leafIndex += 1;
      }
    }

    mesh.count = leafIndex;
    mesh.instanceMatrix.needsUpdate = true;
    aPack.needsUpdate = true;
    aBx.needsUpdate = true;
    aBy.needsUpdate = true;
    aBz.needsUpdate = true;
    aVar.needsUpdate = true;
  }, [
    plants, attrs, plantData, leafGeometry, leafCount, leafSpan, leafScale, droop,
    scaleVariance, bendVariance,
  ]);

  if (!geometry || !material || total < 1) return null;

  return (
    <instancedMesh
      ref={attachMesh}
      args={[geometry, material, total]}
      frustumCulled={false}
      castShadow
      receiveShadow
    />
  );
}
