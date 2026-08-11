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
  const rc = new THREE.Vector3();
  for (let i = 0; i <= stemSegments; i++) {
    curve.getPointAt(i / stemSegments, rc);
    for (let j = 0; j <= radialSegs; j++) {
      const k = (i * vertsPerRing + j) * 3;
      centers[k] = rc.x;
      centers[k + 1] = rc.y;
      centers[k + 2] = rc.z;
    }
  }
  geo.setAttribute('center', new THREE.BufferAttribute(centers, 3));

  if (plantId != null) {
    const ids = new Float32Array(geo.attributes.position.count);
    ids.fill(plantId);
    geo.setAttribute('plantId', new THREE.BufferAttribute(ids, 1));
  }

  if (offset) {
    geo.translate(offset[0], offset[1], offset[2]);
    const c = geo.attributes.center;
    for (let i = 0; i < c.count; i++) {
      c.setXYZ(i, c.getX(i) + offset[0], c.getY(i) + offset[1], c.getZ(i) + offset[2]);
    }
    c.needsUpdate = true;
  }

  return geo;
}
