import { stableRandomRange } from '@core';
import { STEM_DEFAULTS } from '../stem/stemDefaults';
import { GROUND_TENDRIL_INTERNALS } from './groundTendrilDefaults';

const S_PATH = 0;
const S_T = 1;
const S_TYPE = 2;
const S_LENGTH = 3;
const S_RADIUS = 4;
const S_LEAN = 5;
const S_BEND = 6;
const S_TAPER = 7;
const S_FLARE = 8;
const S_HUE = 9;
const S_LIGHT = 10;
const S_SIZE = 11;
const S_FAN_SIDE = 12;
const S_FAN_ANGLE = 13;
const S_CLUSTER_MODE = 14;
const S_CLUSTER_PICK = 15;
const S_CLUSTER_OFFSET_A = 16;
const S_CLUSTER_OFFSET_B = 17;
const S_CLUSTER_PATH = 18;
const S_CLUSTER_T = 19;
const S_CLUSTER_SPAN = 20;

function rangeValue(attempt, salt, seed, range) {
  return stableRandomRange(attempt, salt, seed, range[0], range[1]);
}

function hashIdentity(identity) {
  let hash = 2166136261;
  const value = String(identity);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function farEnough(point, accepted, minSpacingSq) {
  if (minSpacingSq <= 0) return true;
  return accepted.every((stem) => {
    const dx = point.x - stem.position[0];
    const dz = point.z - stem.position[2];
    return dx * dx + dz * dz >= minSpacingSq;
  });
}

function pickWeighted(entries, sampleIndex, salt, seed) {
  const total = entries.reduce((sum, entry) => sum + entry.length, 0);
  let pick = stableRandomRange(sampleIndex, salt, seed, 0, total);
  for (const entry of entries) {
    pick -= entry.length;
    if (pick <= 0) return entry;
  }
  return entries[entries.length - 1];
}

function buildBloomClusters(weighted, count, pathMin, pathMax, layoutSeed) {
  if (count < 1) return [];

  const trunks = weighted.filter(({ path }) => (path.depth ?? 0) === 0);
  const candidates = trunks.length ? [...trunks] : [...weighted];
  const selected = [];

  // Guarantee that body and backpack can each contribute a cluster before
  // filling the remaining slots by route weight.
  const hostIds = [...new Set(candidates.map(({ path }) => path.hostId))];
  for (let i = 0; i < hostIds.length && selected.length < count; i += 1) {
    const hostEntries = candidates.filter(({ path }) => path.hostId === hostIds[i]);
    if (!hostEntries.length) continue;
    const entry = pickWeighted(hostEntries, i, S_CLUSTER_PATH, layoutSeed);
    selected.push(entry);
    candidates.splice(candidates.indexOf(entry), 1);
  }

  while (selected.length < count && candidates.length) {
    const entry = pickWeighted(
      candidates,
      selected.length,
      S_CLUSTER_PATH,
      layoutSeed,
    );
    selected.push(entry);
    candidates.splice(candidates.indexOf(entry), 1);
  }

  // More requested clusters than distinct trunks: reuse the weighted pool.
  while (selected.length < count && weighted.length) {
    selected.push(pickWeighted(
      weighted,
      selected.length,
      S_CLUSTER_PATH,
      layoutSeed,
    ));
  }

  return selected.map((entry, index) => ({
    entry,
    t: stableRandomRange(index, S_CLUSTER_T, layoutSeed, pathMin, pathMax),
    // World-space half-span along the route. Variation prevents equal bouquets.
    halfSpan: stableRandomRange(index, S_CLUSTER_SPAN, layoutSeed, 0.32, 0.56),
  }));
}

/** Deterministically sample upright flower stems only from ground-vine curves. */
export function buildGroundFlowerStems({
  paths,
  count,
  minSpacing,
  pathRange,
  roseRatio,
  layoutSeed,
  roseType,
  dahliaType,
  maxPathDepth = Infinity,
  flowerBandSpread = 0.78,
  bloomClusterCount = 8,
  clusterShare = 0.75,
  stemGeometry = STEM_DEFAULTS.geometry,
}) {
  if (!paths.length || count < 1) return [];

  const eligiblePaths = paths.filter((path) => (
    (path.depth ?? 0) <= maxPathDepth && path.flowerEligible !== false
  ));
  if (!eligiblePaths.length) return [];

  const weighted = eligiblePaths.map((path) => ({
    path,
    // Major trunks carry the visual rhythm; first-generation branches fill
    // locally without turning every fine twig into another flower lane.
    length: Math.max(path.curve.getLength(), 1e-6)
      * ((path.depth ?? 0) === 0 ? 1.6 : 1)
      * (path.routePersonality?.stemDensity ?? 1),
  }));
  const totalLength = weighted.reduce((sum, entry) => sum + entry.length, 0);
  const [pathMin, pathMax] = [
    Math.min(pathRange[0], pathRange[1]),
    Math.max(pathRange[0], pathRange[1]),
  ];
  const clusters = buildBloomClusters(
    weighted,
    Math.max(1, Math.round(bloomClusterCount)),
    pathMin,
    pathMax,
    layoutSeed,
  );
  const clusteredShare = Math.min(1, Math.max(0, clusterShare));
  const minSpacingSq = Math.max(minSpacing, 0) ** 2;
  const stems = [];
  const maxAttempts = Math.max(count * 80, 160);

  for (let attempt = 0; attempt < maxAttempts && stems.length < count; attempt += 1) {
    const useCluster = clusters.length > 0 && stableRandomRange(
      attempt,
      S_CLUSTER_MODE,
      layoutSeed,
      0,
      1,
    ) < clusteredShare;
    let selected;
    let t;
    let bloomClusterId = -1;

    if (useCluster) {
      bloomClusterId = Math.min(
        clusters.length - 1,
        Math.floor(stableRandomRange(
          attempt,
          S_CLUSTER_PICK,
          layoutSeed,
          0,
          clusters.length,
        )),
      );
      const cluster = clusters[bloomClusterId];
      selected = cluster.entry;
      const offsetNoise = stableRandomRange(
        attempt,
        S_CLUSTER_OFFSET_A,
        layoutSeed,
        0,
        1,
      ) + stableRandomRange(
        attempt,
        S_CLUSTER_OFFSET_B,
        layoutSeed,
        0,
        1,
      ) - 1;
      const curveLength = Math.max(selected.path.curve.getLength(), 1e-6);
      t = Math.min(
        pathMax,
        Math.max(pathMin, cluster.t + offsetNoise * cluster.halfSpan / curveLength),
      );
    } else {
      selected = pickWeighted(weighted, attempt, S_PATH, layoutSeed);
      t = stableRandomRange(attempt, S_T, layoutSeed, pathMin, pathMax);
    }
    const point = selected.path.curve.getPointAt(t);
    if (!farEnough(point, stems, minSpacingSq)) continue;

    const tangent = selected.path.curve.getTangentAt(t);
    tangent.y = 0;
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
    tangent.normalize();

    // Roots remain attached to the ground route, but the stems open to both
    // sides of it. This turns a one-dimensional row of blooms into a loose
    // flower band without inventing disconnected spawn points.
    const fanStrength = Math.min(1, Math.max(0, flowerBandSpread));
    const fanSide = stableRandomRange(attempt, S_FAN_SIDE, layoutSeed, 0, 1) < 0.5
      ? -1
      : 1;
    const fanAngle = stableRandomRange(
      attempt,
      S_FAN_ANGLE,
      layoutSeed,
      Math.PI * 0.32,
      Math.PI * 0.68,
    );
    const routeFanOffset = fanSide * fanAngle * fanStrength;
    const routeAngle = Math.atan2(tangent.x, tangent.z);

    const acceptedIndex = stems.length;
    const personality = selected.path.routePersonality;
    const typeRoll = stableRandomRange(attempt, S_TYPE, layoutSeed, 0, 1);
    const flowerType = typeRoll < roseRatio ? roseType : dahliaType;
    const sizeMul = stableRandomRange(attempt, S_SIZE, layoutSeed, 0.78, 1.18);
    const seed = layoutSeed * 1009
      + hashIdentity(selected.path.logicalTreeId ?? selected.path.treeId)
      + attempt * 37
      + acceptedIndex;
    const motionPoint = selected.path.curve.getPointAt(0.5);
    const logicalPathId = selected.path.logicalPathId ?? selected.path.id;
    const smoothT = t * t * (3 - 2 * t);
    const radiusStartScale = selected.path.radiusStartScale ?? 1;
    const radiusEndScale = selected.path.radiusEndScale ?? radiusStartScale;
    const attachmentRadius = (selected.path.stemRadius ?? 0.009)
      * (radiusStartScale + (radiusEndScale - radiusStartScale) * smoothT);
    const baseFlare = rangeValue(attempt, S_FLARE, layoutSeed, stemGeometry.baseFlare);
    const authoredRadius = rangeValue(
      attempt,
      S_RADIUS,
      layoutSeed,
      stemGeometry.stemRadius,
    );
    const defaultRadiusMid = (
      STEM_DEFAULTS.geometry.stemRadius[0] + STEM_DEFAULTS.geometry.stemRadius[1]
    ) * 0.5;
    // The Stem panel remains useful in ground mode, but acts as a restrained
    // variation around the inherited branch width instead of overriding it.
    const inheritedRadiusVariation = Math.min(
      1.35,
      Math.max(0.7, 1 + (authoredRadius / defaultRadiusMid - 1) * 0.35),
    );
    // Match the flower stem's flared base to the local ground-branch width.
    // The nominal tube radius is smaller because buildStemTube applies flare
    // again at t=0; its own attenuation still controls the upper stem.
    const inheritedStemRadius = Math.max(
      attachmentRadius * inheritedRadiusVariation / (1 + baseFlare),
      (selected.path.stemRadius ?? 0.009) * 0.3,
    );
    stems.push({
      position: [point.x, point.y, point.z],
      leanOutwardAngle: routeAngle + routeFanOffset,
      routeFanOffset,
      slotIndex: -1,
      rimT: Math.min(1, selected.path.pathEndDistance / Math.max(totalLength, 1e-6)),
      seed,
      sourceTreeId: selected.path.logicalTreeId ?? selected.path.treeId,
      sourceTreeGeneration: 0,
      sourcePathId: logicalPathId,
      sourcePathT: t,
      bloomClusterId,
      routePersonalityId: personality?.id ?? 'default',
      flowerSizeScale: (personality?.flowerSizeScale ?? 1)
        * GROUND_TENDRIL_INTERNALS.groundFlowerScale,
      attachmentWind: {
        motionPosition: [motionPoint.x, motionPoint.y, motionPoint.z],
        pathT: t,
        response: GROUND_TENDRIL_INTERNALS.windResponse,
      },
      flowerType,
      colorVariationUnit: {
        hue: stableRandomRange(attempt, S_HUE, layoutSeed, -1, 1),
        light: stableRandomRange(attempt, S_LIGHT, layoutSeed, -1, 1),
      },
      params: {
        stemLength: rangeValue(attempt, S_LENGTH, layoutSeed, stemGeometry.stemLength)
          * sizeMul,
        stemRadius: inheritedStemRadius,
        leanAngle: Math.min(
          45,
          rangeValue(attempt, S_LEAN, layoutSeed, stemGeometry.leanAngle)
            * (1 + fanStrength * 0.65),
        ),
        bendDegree: Math.min(
          0.35,
          rangeValue(attempt, S_BEND, layoutSeed, stemGeometry.bendDegree)
            * (1 + fanStrength * 0.6),
        ),
        radiusAttenuation: rangeValue(
          attempt,
          S_TAPER,
          layoutSeed,
          stemGeometry.radiusAttenuation,
        ),
        baseFlare,
      },
    });
  }

  return stems;
}
