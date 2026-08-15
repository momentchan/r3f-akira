import * as THREE from 'three';
import { seededRng } from '../stem/buildStemTube.js';
import { getSurfaceComponentPointClouds } from './surfaceRoutes.js';

const samplerCache = new WeakMap();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _center = new THREE.Vector3();

function vertexAt(position, index, target) {
  return target.fromBufferAttribute(position, index);
}

function triangleVertexIndex(index, triangleIndex, corner) {
  const offset = triangleIndex * 3 + corner;
  return index ? index.getX(offset) : offset;
}

function createSamplerData(geometry) {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.count < 3) return null;
  const index = geometry.getIndex();
  const triangleCount = Math.floor((index?.count ?? position.count) / 3);
  if (triangleCount < 1) return null;

  const cumulativeArea = new Float64Array(triangleCount);
  let surfaceArea = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    vertexAt(position, triangleVertexIndex(index, triangle, 0), _a);
    vertexAt(position, triangleVertexIndex(index, triangle, 1), _b);
    vertexAt(position, triangleVertexIndex(index, triangle, 2), _c);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    surfaceArea += _ab.cross(_ac).length() * 0.5;
    cumulativeArea[triangle] = surfaceArea;
  }

  if (!(surfaceArea > 1e-8)) return null;
  return { position, index, triangleCount, cumulativeArea, surfaceArea };
}

function samplerData(geometry) {
  if (!geometry) return null;
  let data = samplerCache.get(geometry);
  if (!data) {
    data = createSamplerData(geometry);
    if (data) samplerCache.set(geometry, data);
  }
  return data ?? null;
}

function findTriangle(cumulativeArea, value) {
  let low = 0;
  let high = cumulativeArea.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (value <= cumulativeArea[mid]) high = mid;
    else low = mid + 1;
  }
  return low;
}

function sampleTriangle(data, rng, target) {
  const triangle = findTriangle(data.cumulativeArea, rng() * data.surfaceArea);
  vertexAt(data.position, triangleVertexIndex(data.index, triangle, 0), _a);
  vertexAt(data.position, triangleVertexIndex(data.index, triangle, 1), _b);
  vertexAt(data.position, triangleVertexIndex(data.index, triangle, 2), _c);

  const su = Math.sqrt(rng());
  const v = rng();
  const wa = 1 - su;
  const wb = su * (1 - v);
  const wc = su * v;
  return target.copy(_a).multiplyScalar(wa)
    .addScaledVector(_b, wb)
    .addScaledVector(_c, wc);
}

function cellKey(point, inverseCellSize) {
  return `${Math.floor(point.x * inverseCellSize)},${Math.floor(point.y * inverseCellSize)},${Math.floor(point.z * inverseCellSize)}`;
}

/** Approximate area-weighted blue-noise samples with a spatial hash. */
export function sampleSurfaceCoverage(geometry, targetCount, seed = 0) {
  const data = samplerData(geometry);
  const count = Math.max(0, Math.floor(targetCount));
  if (!data || count < 1) return { points: [], surfaceArea: 0 };

  const rng = seededRng(seed + 1709);
  const spacing = Math.max(Math.sqrt(data.surfaceArea / count) * 0.42, 1e-4);
  const spacingSq = spacing * spacing;
  const inverseCellSize = 1 / spacing;
  const cells = new Map();
  const points = [];
  const candidate = new THREE.Vector3();
  const maxAttempts = Math.max(count * 18, 128);

  for (let attempt = 0; attempt < maxAttempts && points.length < count; attempt += 1) {
    sampleTriangle(data, rng, candidate);
    const ix = Math.floor(candidate.x * inverseCellSize);
    const iy = Math.floor(candidate.y * inverseCellSize);
    const iz = Math.floor(candidate.z * inverseCellSize);
    let clear = true;
    for (let dx = -1; dx <= 1 && clear; dx += 1) {
      for (let dy = -1; dy <= 1 && clear; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const neighbors = cells.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!neighbors) continue;
          for (let i = 0; i < neighbors.length; i += 1) {
            if (candidate.distanceToSquared(neighbors[i]) < spacingSq) {
              clear = false;
              break;
            }
          }
          if (!clear) break;
        }
      }
    }
    if (!clear) continue;

    const accepted = candidate.clone();
    points.push(accepted);
    const key = cellKey(accepted, inverseCellSize);
    const bucket = cells.get(key);
    if (bucket) bucket.push(accepted);
    else cells.set(key, [accepted]);
  }

  // A highly fragmented mesh may not satisfy the spacing target. Preserve the
  // requested coverage count with deterministic area samples rather than holes.
  while (points.length < count) {
    points.push(sampleTriangle(data, rng, new THREE.Vector3()).clone());
  }

  return { points, surfaceArea: data.surfaceArea };
}

export function getGeometrySurfaceArea(geometry) {
  return samplerData(geometry)?.surfaceArea ?? 0;
}

function powerIteration(covariance) {
  const axis = new THREE.Vector3(0.61, 0.73, 0.31).normalize();
  for (let i = 0; i < 16; i += 1) {
    const x = covariance[0] * axis.x + covariance[1] * axis.y + covariance[2] * axis.z;
    const y = covariance[1] * axis.x + covariance[3] * axis.y + covariance[4] * axis.z;
    const z = covariance[2] * axis.x + covariance[4] * axis.y + covariance[5] * axis.z;
    axis.set(x, y, z);
    if (axis.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
    axis.normalize();
  }
  if (axis.y < -0.05 || (Math.abs(axis.y) <= 0.05 && axis.x < 0)) axis.negate();
  return axis;
}

function covarianceEigenvalue(covariance, axis) {
  const x = covariance[0] * axis.x + covariance[1] * axis.y + covariance[2] * axis.z;
  const y = covariance[1] * axis.x + covariance[3] * axis.y + covariance[4] * axis.z;
  const z = covariance[2] * axis.x + covariance[4] * axis.y + covariance[5] * axis.z;
  return axis.x * x + axis.y * y + axis.z * z;
}

function deflateCovariance(covariance, axis) {
  const eigenvalue = covarianceEigenvalue(covariance, axis);
  return [
    covariance[0] - eigenvalue * axis.x * axis.x,
    covariance[1] - eigenvalue * axis.x * axis.y,
    covariance[2] - eigenvalue * axis.x * axis.z,
    covariance[3] - eigenvalue * axis.y * axis.y,
    covariance[4] - eigenvalue * axis.y * axis.z,
    covariance[5] - eigenvalue * axis.z * axis.z,
  ];
}

function derivePrincipalGuide(pointCount, pointAt, id) {
  if (pointCount < 3) return null;
  const step = Math.max(1, Math.floor(pointCount / 4096));
  const mean = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < pointCount; i += step) {
    mean.add(pointAt(i, _a));
    count += 1;
  }
  mean.multiplyScalar(1 / Math.max(count, 1));

  const covariance = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < pointCount; i += step) {
    _a.copy(pointAt(i, _a)).sub(mean);
    covariance[0] += _a.x * _a.x;
    covariance[1] += _a.x * _a.y;
    covariance[2] += _a.x * _a.z;
    covariance[3] += _a.y * _a.y;
    covariance[4] += _a.y * _a.z;
    covariance[5] += _a.z * _a.z;
  }
  const axis = powerIteration(covariance);
  const planeAcross = powerIteration(deflateCovariance(covariance, axis));
  planeAcross.addScaledVector(axis, -planeAcross.dot(axis));
  if (planeAcross.lengthSq() < 1e-10) {
    planeAcross.crossVectors(
      axis,
      Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0),
    );
  }
  planeAcross.normalize();
  const planeNormal = new THREE.Vector3().crossVectors(axis, planeAcross).normalize();

  let minProjection = Infinity;
  let maxProjection = -Infinity;
  let minAcross = Infinity;
  let maxAcross = -Infinity;
  let minNormal = Infinity;
  let maxNormal = -Infinity;
  const radialDistances = [];
  for (let i = 0; i < pointCount; i += step) {
    _a.copy(pointAt(i, _a)).sub(mean);
    const projection = _a.dot(axis);
    minProjection = Math.min(minProjection, projection);
    maxProjection = Math.max(maxProjection, projection);
    const acrossProjection = _a.dot(planeAcross);
    const normalProjection = _a.dot(planeNormal);
    minAcross = Math.min(minAcross, acrossProjection);
    maxAcross = Math.max(maxAcross, acrossProjection);
    minNormal = Math.min(minNormal, normalProjection);
    maxNormal = Math.max(maxNormal, normalProjection);
    _center.copy(axis).multiplyScalar(projection);
    radialDistances.push(_a.distanceTo(_center));
  }
  const length = maxProjection - minProjection;
  if (!(length > 1e-4)) return null;
  radialDistances.sort((a, b) => a - b);
  const radius = Math.max(
    radialDistances[Math.floor((radialDistances.length - 1) * 0.9)] ?? 0,
    0.04,
  );
  const planeWidth = maxAcross - minAcross;
  const planeThickness = maxNormal - minNormal;
  const slabRatio = planeThickness / Math.max(planeWidth, 1e-4);

  return {
    id,
    a: mean.clone().addScaledVector(axis, minProjection),
    b: mean.clone().addScaledVector(axis, maxProjection),
    radius,
    weight: 1,
    length,
    uMin: 0.02,
    uMax: 0.98,
    coverageRadiusScale: 1.6,
    generatedFromSurface: true,
    surfaceMode: planeWidth > 0.08 && slabRatio < 0.65 ? 'planar' : 'radial',
    planeAcross,
    planeNormal,
    planeWidth,
    planeThickness,
  };
}

/** Bone-free dominant-axis guide for a static arbitrary mesh. */
export function derivePrincipalSurfaceGuide(geometry, id = 'surface') {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.count < 3) return null;
  return derivePrincipalGuide(
    position.count,
    (index, target) => vertexAt(position, index, target),
    id,
  );
}

/**
 * Multiple local guides for a disconnected, bone-free prop. A global fallback
 * remains available when topology has no meaningful islands.
 */
export function derivePrincipalSurfaceGuides(
  geometry,
  idPrefix = 'surface',
  { maxGuides = 12, minComponentFraction = 0.003 } = {},
) {
  const components = getSurfaceComponentPointClouds(geometry);
  if (!components.length) {
    const fallback = derivePrincipalSurfaceGuide(geometry, idPrefix);
    return fallback ? [fallback] : [];
  }

  const totalPoints = components.reduce((sum, points) => sum + points.length, 0);
  const minimumPoints = Math.max(12, Math.floor(totalPoints * minComponentFraction));
  const selected = components
    .filter((points) => points.length >= minimumPoints)
    .sort((left, right) => right.length - left.length)
    .slice(0, maxGuides);
  const guides = selected.map((points, index) => derivePrincipalGuide(
    points.length,
    (pointIndex, target) => target.copy(points[pointIndex]),
    `${idPrefix}.${index}`,
  )).filter(Boolean);

  if (guides.length) return guides;
  const fallback = derivePrincipalSurfaceGuide(geometry, idPrefix);
  return fallback ? [fallback] : [];
}

function coverageGuide(capsule) {
  const isTorso = capsule.id === 'torso';
  return {
    ...capsule,
    a: capsule.a.clone(),
    b: capsule.b.clone(),
    uMin: capsule.uMin ?? (isTorso ? -0.3 : -0.1),
    uMax: capsule.uMax ?? (isTorso ? 1.22 : 1.1),
    coverageRadiusScale:
      capsule.coverageRadiusScale ?? (isTorso ? 3.8 : 2.8),
    // Surface samples may widen a guide enough to cover loose clothing, but
    // should never turn a limb guide into a whole-character ray caster.
    radiusExpansionLimit:
      capsule.radiusExpansionLimit ?? (isTorso ? 2.4 : 2),
  };
}

function assignPointToGuide(point, guides) {
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < guides.length; i += 1) {
    const guide = guides[i];
    _axis.subVectors(guide.b, guide.a);
    const length = _axis.length();
    if (length < 1e-6) continue;
    _axis.multiplyScalar(1 / length);
    const rawU = _a.subVectors(point, guide.a).dot(_axis) / length;
    const u = THREE.MathUtils.clamp(rawU, guide.uMin, guide.uMax);
    _center.copy(guide.a).addScaledVector(_axis, u * length);
    const radialDistance = point.distanceTo(_center);
    const score = radialDistance / Math.max(guide.radius, 0.025);
    if (score < bestScore && score <= guide.coverageRadiusScale) {
      bestScore = score;
      best = { guide, point, u, radialDistance };
    }
  }
  return best;
}

function allocateCounts(buckets, total) {
  const counts = new Array(buckets.length).fill(0);
  if (!buckets.length || total < 1) return counts;
  let remaining = total;
  if (total >= buckets.length) {
    counts.fill(1);
    remaining -= buckets.length;
  }
  const totalWeight = buckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  const shares = buckets.map((bucket, index) => {
    const exact = totalWeight > 1e-8
      ? (bucket.weight / totalWeight) * remaining
      : remaining / buckets.length;
    const whole = Math.floor(exact);
    counts[index] += whole;
    return { index, fraction: exact - whole };
  });
  let assigned = counts.reduce((sum, value) => sum + value, 0);
  shares.sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; assigned < total; i += 1, assigned += 1) {
    counts[shares[i % shares.length].index] += 1;
  }
  return counts;
}

/**
 * Allocate ring stations from actual surface coverage rather than guide length.
 * Guides provide semantic direction; the mesh decides coverage and density.
 */
export function allocateSurfaceCoverageStations(hosts, tendrilCount, {
  layoutSeed = 0,
  spacingVariation = 1,
  enabledCapsuleIds = null,
  totalBudget = 512,
} = {}) {
  const target = Math.min(Math.max(Math.floor(tendrilCount), 0), totalBudget);
  if (target < 1) return [];
  const enabled = enabledCapsuleIds ? new Set(enabledCapsuleIds) : null;
  const eligible = hosts.map((host) => {
    if (!host?.geometry || !host?.bvh) return null;
    if (enabled && host.id !== 'body') return null;
    const guides = (host.capsules ?? [])
      .filter((capsule) => !enabled || enabled.has(capsule.id))
      .map(coverageGuide);
    if (!guides.length) return null;
    const surfaceArea = getGeometrySurfaceArea(host.geometry);
    const countShare = host.profile?.countShare;
    if (Number.isFinite(countShare) && countShare <= 0) return null;
    return surfaceArea > 1e-8
      ? {
          host,
          guides,
          surfaceArea,
          weight: Number.isFinite(countShare) ? countShare : surfaceArea,
        }
      : null;
  }).filter(Boolean);
  if (!eligible.length) return [];

  const hostCounts = allocateCounts(eligible, target);
  const sampleBudget = Math.min(Math.max(target * 6, 768), 4096);
  const bucketsByHost = eligible.map(() => []);

  for (let hostIndex = 0; hostIndex < eligible.length; hostIndex += 1) {
    const item = eligible[hostIndex];
    const hostSampleCount = Math.max(
      item.guides.length * 16,
      Math.round(sampleBudget * hostCounts[hostIndex] / target),
    );
    const sampled = sampleSurfaceCoverage(
      item.host.geometry,
      hostSampleCount,
      layoutSeed * 101 + hostIndex * 7919,
    );
    const byGuide = new Map(item.guides.map((guide) => [guide.id, []]));
    for (let i = 0; i < sampled.points.length; i += 1) {
      const assigned = assignPointToGuide(sampled.points[i], item.guides);
      if (assigned) byGuide.get(assigned.guide.id).push(assigned);
    }

    for (const guide of item.guides) {
      const assignments = byGuide.get(guide.id);
      if (!assignments?.length) continue;
      assignments.sort((left, right) => left.u - right.u);
      const radial = assignments.map((entry) => entry.radialDistance).sort((a, b) => a - b);
      const surfaceRadius = radial[Math.floor((radial.length - 1) * 0.85)] ?? guide.radius;
      const radiusExpansionLimit = guide.generatedFromSurface
        ? 1.15
        : guide.radiusExpansionLimit;
      const maximumSweepRadius = guide.radius * radiusExpansionLimit;
      const sweepGuide = {
        ...guide,
        radius: Math.min(
          Math.max(guide.radius, surfaceRadius * 0.9),
          maximumSweepRadius,
        ),
      };
      bucketsByHost[hostIndex].push({
        host: item.host,
        guide: sweepGuide,
        assignments,
        weight: item.surfaceArea
          * assignments.length / sampled.points.length
          * Math.max(guide.densityScale ?? 1, 0),
      });
    }
  }

  const variation = THREE.MathUtils.clamp(spacingVariation, 0, 1);
  const stations = [];
  let globalBucketIndex = 0;
  for (let hostIndex = 0; hostIndex < bucketsByHost.length; hostIndex += 1) {
    const buckets = bucketsByHost[hostIndex];
    const counts = allocateCounts(buckets, hostCounts[hostIndex]);
    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
      const bucket = buckets[bucketIndex];
      const ringsOnRegion = counts[bucketIndex];
      if (ringsOnRegion < 1) {
        globalBucketIndex += 1;
        continue;
      }
      const rng = seededRng(layoutSeed * 977 + globalBucketIndex * 131 + 17);
      for (let ringIndex = 0; ringIndex < ringsOnRegion; ringIndex += 1) {
        const centerQ = (ringIndex + 0.5) / ringsOnRegion;
        const jitter = (rng() - 0.5) * variation * 0.86 / ringsOnRegion;
        const q = THREE.MathUtils.clamp(centerQ + jitter, 0, 1);
        const assignment = bucket.assignments[Math.min(
          Math.floor(q * bucket.assignments.length),
          bucket.assignments.length - 1,
        )];
        stations.push({
          host: bucket.host,
          capsule: bucket.guide,
          targetPoint: assignment.point.clone(),
          ringIndex,
          ringsOnRegion,
          station: assignment.u,
        });
      }
      globalBucketIndex += 1;
    }
  }
  return stations;
}
