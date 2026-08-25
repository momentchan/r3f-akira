import * as THREE from 'three/webgpu';

export const BASE_BURY = 0.06;
export const GROWTH_START_SCALE = 0.1;

export function seededRng(seed) {
  let s = ((seed + 1) * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function write3(arr, k, x, y, z) {
  arr[k] = x;
  arr[k + 1] = y;
  arr[k + 2] = z;
}

function radiusScale(t, radiusAttenuation, baseFlare, extra = 1) {
  return (1 - (1 - radiusAttenuation) * t) + baseFlare * extra * (1 - t) ** 3;
}

/** Catmull-Rom in plant-local space, base at origin. */
export function buildStemCurve({
  seed,
  stemLength,
  leanAngle,
  bendDegree,
  leanOutwardAngle = null,
  leanOut = 0,
}) {
  const rng = seededRng(seed);
  const az0 = rng() * Math.PI * 2;
  const leanAzimuth = leanOutwardAngle === null
    ? az0
    : leanOutwardAngle + (az0 - Math.PI) * (1 - leanOut);
  const leanRad = leanAngle * (Math.PI / 180);
  const to = new THREE.Vector3(
    Math.sin(leanAzimuth) * Math.sin(leanRad) * stemLength,
    Math.cos(leanRad) * stemLength,
    Math.cos(leanAzimuth) * Math.sin(leanRad) * stemLength,
  );
  const bendAzimuth = rng() * Math.PI * 2;
  const bendMag = bendDegree * stemLength;
  const bend = new THREE.Vector3(
    Math.sin(bendAzimuth) * bendMag,
    0,
    Math.cos(bendAzimuth) * bendMag,
  );
  const from = new THREE.Vector3(0, -BASE_BURY, 0);
  return new THREE.CatmullRomCurve3(
    [
      from.clone(),
      from.clone().lerp(to, 0.25).add(bend),
      from.clone().lerp(to, 0.75).add(bend),
      to.clone(),
    ],
    false,
    'centripetal',
  );
}

/** Positions + tangents along the stem, for placing a flower head each frame. */
export function buildCurveSampleTable(curve, segments) {
  const count = Math.max(2, Math.floor(segments) + 1);
  const points = new Float32Array(count * 3);
  const tangents = new Float32Array(count * 3);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const u = i / (count - 1);
    curve.getPointAt(u, point);
    curve.getTangentAt(u, tangent).normalize();
    write3(points, i * 3, point.x, point.y, point.z);
    write3(tangents, i * 3, tangent.x, tangent.y, tangent.z);
  }
  return { points, tangents, count };
}

/** Lerp a sample table. `u` is 0..1. */
export function sampleCurveTable(table, u, outPoint, outTangent) {
  const { points, tangents, count } = table;
  const f = Math.min(Math.max(u, 0), 1) * (count - 1);
  const i0 = Math.min(Math.floor(f), count - 2);
  const frac = f - i0;
  const a = i0 * 3;
  const b = a + 3;
  outPoint.set(
    points[a] + (points[b] - points[a]) * frac,
    points[a + 1] + (points[b + 1] - points[a + 1]) * frac,
    points[a + 2] + (points[b + 2] - points[a + 2]) * frac,
  );
  outTangent.set(
    tangents[a] + (tangents[b] - tangents[a]) * frac,
    tangents[a + 1] + (tangents[b + 1] - tangents[a + 1]) * frac,
    tangents[a + 2] + (tangents[b + 2] - tangents[a + 2]) * frac,
  ).normalize();
  return outPoint;
}

/** Tapered TubeGeometry + centerline attrs. `plantId` is for batched field shading. */
export function buildStemTubeGeometry(curve, {
  stemRadius,
  stemSegments,
  radialSegs,
  radiusAttenuation,
  baseFlare,
  plantId = null,
}) {
  const geo = new THREE.TubeGeometry(curve, stemSegments, stemRadius, radialSegs, false);
  const pos = geo.attributes.position;
  const vertsPerRing = radialSegs + 1;
  const vertCount = pos.count;
  const centers = new Float32Array(vertCount * 3);
  const previousPositions = new Float32Array(vertCount * 3);
  const previousCenters = new Float32Array(vertCount * 3);
  const rc = new THREE.Vector3();
  const previousRc = new THREE.Vector3();

  for (let i = 0; i <= stemSegments; i += 1) {
    const t = i / stemSegments;
    const scale = radiusScale(t, radiusAttenuation, baseFlare);
    curve.getPointAt(t, rc);
    curve.getPointAt(Math.max(i - 1, 0) / stemSegments, previousRc);
    for (let j = 0; j <= radialSegs; j += 1) {
      const idx = i * vertsPerRing + j;
      const prevIdx = Math.max(i - 1, 0) * vertsPerRing + j;
      pos.setXYZ(
        idx,
        rc.x + (pos.getX(idx) - rc.x) * scale,
        rc.y + (pos.getY(idx) - rc.y) * scale,
        rc.z + (pos.getZ(idx) - rc.z) * scale,
      );
      const k = idx * 3;
      write3(centers, k, rc.x, rc.y, rc.z);
      write3(previousPositions, k, pos.getX(prevIdx), pos.getY(prevIdx), pos.getZ(prevIdx));
      write3(previousCenters, k, previousRc.x, previousRc.y, previousRc.z);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.setAttribute('center', new THREE.BufferAttribute(centers, 3));
  geo.setAttribute('previousPosition', new THREE.BufferAttribute(previousPositions, 3));
  geo.setAttribute('previousCenter', new THREE.BufferAttribute(previousCenters, 3));
  if (plantId != null) {
    const ids = new Float32Array(vertCount);
    ids.fill(plantId);
    geo.setAttribute('plantId', new THREE.BufferAttribute(ids, 1));
  }
  return geo;
}

const _packP = new THREE.Vector3();
const _packN = new THREE.Vector3();
const _packB = new THREE.Vector3();
const _packNormal = new THREE.Vector3();
const _packVertex = new THREE.Vector3();

/** Many stems in one BufferGeometry. UV.x is path t. */
export function buildPackedStemTubes(curves, {
  stemRadius,
  stemSegments,
  radialSegs,
  radiusAttenuation,
  baseFlare,
}) {
  const n = curves.length;
  if (n < 1) return null;

  const rings = stemSegments + 1;
  const vertsPerRing = radialSegs + 1;
  const vertsPerStem = rings * vertsPerRing;
  const positions = new Float32Array(n * vertsPerStem * 3);
  const normals = new Float32Array(n * vertsPerStem * 3);
  const uvs = new Float32Array(n * vertsPerStem * 2);
  const centers = new Float32Array(n * vertsPerStem * 3);
  const previousPositions = new Float32Array(n * vertsPerStem * 3);
  const previousCenters = new Float32Array(n * vertsPerStem * 3);
  const plantIds = new Float32Array(n * vertsPerStem);
  const indices = new Uint32Array(n * stemSegments * radialSegs * 6);

  let iOffset = 0;
  let vOffset = 0;

  for (let s = 0; s < n; s += 1) {
    const {
      curve,
      plantId,
      radiusStartScale,
      radiusEndScale,
      baseFlareScale = 1,
    } = curves[s];
    const branchProfile = Number.isFinite(radiusStartScale)
      && Number.isFinite(radiusEndScale);
    const frames = curve.computeFrenetFrames(stemSegments, false);

    for (let i = 0; i <= stemSegments; i += 1) {
      const t = i / stemSegments;
      const smoothT = t * t * (3 - 2 * t);
      const scale = branchProfile
        ? radiusStartScale + (radiusEndScale - radiusStartScale) * smoothT
          + baseFlare * baseFlareScale * (1 - t) ** 3
        : radiusScale(t, radiusAttenuation, baseFlare);
      const r = stemRadius * scale;
      curve.getPointAt(t, _packP);
      _packN.copy(frames.normals[i]);
      _packB.copy(frames.binormals[i]);

      for (let j = 0; j <= radialSegs; j += 1) {
        const v = (j / radialSegs) * Math.PI * 2;
        _packNormal
          .copy(_packN)
          .multiplyScalar(-Math.cos(v))
          .addScaledVector(_packB, Math.sin(v))
          .normalize();
        _packVertex.copy(_packP).addScaledVector(_packNormal, r);

        const idx = vOffset + i * vertsPerRing + j;
        const i3 = idx * 3;
        write3(positions, i3, _packVertex.x, _packVertex.y, _packVertex.z);
        write3(normals, i3, _packNormal.x, _packNormal.y, _packNormal.z);
        write3(centers, i3, _packP.x, _packP.y, _packP.z);
        const prevI3 = (vOffset + Math.max(i - 1, 0) * vertsPerRing + j) * 3;
        write3(
          previousPositions, i3,
          positions[prevI3], positions[prevI3 + 1], positions[prevI3 + 2],
        );
        write3(
          previousCenters, i3,
          centers[prevI3], centers[prevI3 + 1], centers[prevI3 + 2],
        );
        uvs[idx * 2] = t;
        uvs[idx * 2 + 1] = j / radialSegs;
        plantIds[idx] = plantId;
      }
    }

    for (let i = 0; i < stemSegments; i += 1) {
      for (let j = 0; j < radialSegs; j += 1) {
        const a = vOffset + i * vertsPerRing + j;
        const b = vOffset + (i + 1) * vertsPerRing + j;
        indices[iOffset++] = a;
        indices[iOffset++] = b;
        indices[iOffset++] = a + 1;
        indices[iOffset++] = b;
        indices[iOffset++] = b + 1;
        indices[iOffset++] = a + 1;
      }
    }
    vOffset += vertsPerStem;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('center', new THREE.BufferAttribute(centers, 3));
  geo.setAttribute('previousPosition', new THREE.BufferAttribute(previousPositions, 3));
  geo.setAttribute('previousCenter', new THREE.BufferAttribute(previousCenters, 3));
  geo.setAttribute('plantId', new THREE.BufferAttribute(plantIds, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}
