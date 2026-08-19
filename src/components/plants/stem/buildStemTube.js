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
      pos.setXYZ(
        idx,
        ringCenter.x + dx * scale,
        ringCenter.y + dy * scale,
        ringCenter.z + dz * scale,
      );
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Build a Catmull-Rom stem curve in plant-local space (base at origin).
 */
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

/**
 * Arc-length-uniform samples of `curve`, for callers that look one up per frame.
 *
 * `getPointAt`/`getTangentAt` are not cheap: each is a binary search through the
 * arc-length table, and `getTangentAt` evaluates the curve twice more. Sampling
 * with the same segment count the tube uses makes interpolation land on the chord
 * between ring centres — which is exactly where the rendered tube surface is, so
 * a head placed from this table sits on the tube rather than on the ideal curve
 * the tube only approximates.
 */
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
    const k = i * 3;
    points[k] = point.x;
    points[k + 1] = point.y;
    points[k + 2] = point.z;
    tangents[k] = tangent.x;
    tangents[k + 1] = tangent.y;
    tangents[k + 2] = tangent.z;
  }
  return { points, tangents, count };
}

/** Interpolate a `buildCurveSampleTable` result. `u` is clamped to 0..1. */
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

/**
 * TubeGeometry along `curve` with taper + baked centerline attribute.
 * Optionally stamps `plantId` on every vertex for batched field shading.
 */
export function buildStemTubeGeometry(curve, {
  stemRadius,
  stemSegments,
  radialSegs,
  radiusAttenuation,
  baseFlare,
  plantId = null,
  offset = null,
}) {
  const geo = new THREE.TubeGeometry(curve, stemSegments, stemRadius, radialSegs, false);

  applyTubeRadiusTaper(geo, curve, stemSegments, radialSegs, (t) => {
    const linearTaper = 1 - (1 - radiusAttenuation) * t;
    const flare = baseFlare * Math.pow(1 - t, 3);
    return linearTaper + flare;
  });

  const vertsPerRing = radialSegs + 1;
  const centers = new Float32Array(geo.attributes.position.count * 3);
  const previousPositions = new Float32Array(geo.attributes.position.count * 3);
  const previousCenters = new Float32Array(geo.attributes.position.count * 3);
  const rc = new THREE.Vector3();
  const previousRc = new THREE.Vector3();
  const position = geo.attributes.position;
  for (let i = 0; i <= stemSegments; i++) {
    curve.getPointAt(i / stemSegments, rc);
    curve.getPointAt(Math.max(i - 1, 0) / stemSegments, previousRc);
    for (let j = 0; j <= radialSegs; j++) {
      const previousVertexIndex = Math.max(i - 1, 0) * vertsPerRing + j;
      const k = (i * vertsPerRing + j) * 3;
      centers[k] = rc.x;
      centers[k + 1] = rc.y;
      centers[k + 2] = rc.z;
      previousPositions[k] = position.getX(previousVertexIndex);
      previousPositions[k + 1] = position.getY(previousVertexIndex);
      previousPositions[k + 2] = position.getZ(previousVertexIndex);
      previousCenters[k] = previousRc.x;
      previousCenters[k + 1] = previousRc.y;
      previousCenters[k + 2] = previousRc.z;
    }
  }
  geo.setAttribute('center', new THREE.BufferAttribute(centers, 3));
  geo.setAttribute('previousPosition', new THREE.BufferAttribute(previousPositions, 3));
  geo.setAttribute('previousCenter', new THREE.BufferAttribute(previousCenters, 3));

  if (plantId != null) {
    const ids = new Float32Array(geo.attributes.position.count);
    ids.fill(plantId);
    geo.setAttribute('plantId', new THREE.BufferAttribute(ids, 1));
  }

  if (offset) {
    geo.translate(offset[0], offset[1], offset[2]);
    const c = geo.attributes.center;
    const pp = geo.attributes.previousPosition;
    const pc = geo.attributes.previousCenter;
    for (let i = 0; i < c.count; i++) {
      c.setXYZ(i, c.getX(i) + offset[0], c.getY(i) + offset[1], c.getZ(i) + offset[2]);
      pp.setXYZ(i, pp.getX(i) + offset[0], pp.getY(i) + offset[1], pp.getZ(i) + offset[2]);
      pc.setXYZ(i, pc.getX(i) + offset[0], pc.getY(i) + offset[1], pc.getZ(i) + offset[2]);
    }
    c.needsUpdate = true;
    pp.needsUpdate = true;
    pc.needsUpdate = true;
  }

  return geo;
}

const _packP = new THREE.Vector3();
const _packN = new THREE.Vector3();
const _packB = new THREE.Vector3();
const _packNormal = new THREE.Vector3();
const _packVertex = new THREE.Vector3();

/**
 * Pack many stem tubes into one BufferGeometry (no mergeGeometries / no temp TubeGeometry).
 * `curves` items: `{ curve: THREE.Curve, plantId: number }`.
 * UV.x = path t (used by batched grow discard); `center` + `plantId` match field stems.
 */
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
  const totalVerts = n * vertsPerStem;
  const totalIndices = n * stemSegments * radialSegs * 6;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const centers = new Float32Array(totalVerts * 3);
  const previousPositions = new Float32Array(totalVerts * 3);
  const previousCenters = new Float32Array(totalVerts * 3);
  const plantIds = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIndices);

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
    const hasBranchRadiusProfile = Number.isFinite(radiusStartScale)
      && Number.isFinite(radiusEndScale);
    const frames = curve.computeFrenetFrames(stemSegments, false);

    for (let i = 0; i <= stemSegments; i += 1) {
      const t = i / stemSegments;
      const smoothT = t * t * (3 - 2 * t);
      const radiusScale = hasBranchRadiusProfile
        ? radiusStartScale
          + (radiusEndScale - radiusStartScale) * smoothT
          + baseFlare * baseFlareScale * (1 - t) ** 3
        : (1 - (1 - radiusAttenuation) * t) + baseFlare * (1 - t) ** 3;
      const r = stemRadius * radiusScale;
      curve.getPointAt(t, _packP);
      _packN.copy(frames.normals[i]);
      _packB.copy(frames.binormals[i]);

      for (let j = 0; j <= radialSegs; j += 1) {
        const v = (j / radialSegs) * Math.PI * 2;
        const sin = Math.sin(v);
        const cos = -Math.cos(v);
        _packNormal
          .copy(_packN)
          .multiplyScalar(cos)
          .addScaledVector(_packB, sin)
          .normalize();
        _packVertex.copy(_packP).addScaledVector(_packNormal, r);

        const idx = vOffset + i * vertsPerRing + j;
        const i3 = idx * 3;
        positions[i3] = _packVertex.x;
        positions[i3 + 1] = _packVertex.y;
        positions[i3 + 2] = _packVertex.z;
        normals[i3] = _packNormal.x;
        normals[i3 + 1] = _packNormal.y;
        normals[i3 + 2] = _packNormal.z;
        centers[i3] = _packP.x;
        centers[i3 + 1] = _packP.y;
        centers[i3 + 2] = _packP.z;
        const previousIdx = vOffset + Math.max(i - 1, 0) * vertsPerRing + j;
        const previousI3 = previousIdx * 3;
        previousPositions[i3] = positions[previousI3];
        previousPositions[i3 + 1] = positions[previousI3 + 1];
        previousPositions[i3 + 2] = positions[previousI3 + 2];
        previousCenters[i3] = centers[previousI3];
        previousCenters[i3 + 1] = centers[previousI3 + 1];
        previousCenters[i3 + 2] = centers[previousI3 + 2];
        uvs[idx * 2] = t;
        uvs[idx * 2 + 1] = j / radialSegs;
        plantIds[idx] = plantId;
      }
    }

    for (let i = 0; i < stemSegments; i += 1) {
      for (let j = 0; j < radialSegs; j += 1) {
        const a = vOffset + i * vertsPerRing + j;
        const b = vOffset + (i + 1) * vertsPerRing + j;
        const c = b + 1;
        const d = a + 1;
        indices[iOffset++] = a;
        indices[iOffset++] = b;
        indices[iOffset++] = d;
        indices[iOffset++] = b;
        indices[iOffset++] = c;
        indices[iOffset++] = d;
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
