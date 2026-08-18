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
const S_CLUSTER_OFFSET_A = 16;
const S_CLUSTER_OFFSET_B = 17;
const S_CLUSTER_PATH = 18;
const S_CLUSTER_T = 19;
const S_CLUSTER_SPAN = 20;
const S_BUDGET_ORDER = 21;
const S_POSTURE = 22;
const S_LEAN_STYLE = 23;
const SPECIES_SEQUENCE_STEP = (Math.sqrt(5) - 1) * 0.5;

const ROLE_FLOWER_PROFILE = Object.freeze({
  hero: Object.freeze({
    min: 7, max: 9, sizeScale: 1, gapScale: 0.78, span: [0.38, 0.62],
  }),
  nearby: Object.freeze({
    min: 3, max: 4, sizeScale: 0.82, gapScale: 0.88, span: [0.2, 0.38],
  }),
  guide: Object.freeze({
    min: 1, max: 2, sizeScale: 0.72, gapScale: 1, span: [0.16, 0.3],
  }),
});

const ROLE_POSTURE_WEIGHTS = Object.freeze({
  hero: Object.freeze({ short: 0.12, medium: 0.57 }),
  nearby: Object.freeze({ short: 0.42, medium: 0.48 }),
  guide: Object.freeze({ short: 0.5, medium: 0.43 }),
});

const LEAN_STYLE = Object.freeze({
  upright: Object.freeze({ fanScale: 0.25, leanScale: 0.55, bendScale: 0.65 }),
  soft: Object.freeze({ fanScale: 0.65, leanScale: 0.9, bendScale: 1 }),
  expressive: Object.freeze({ fanScale: 1, leanScale: 1.2, bendScale: 1.4 }),
});

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

function profileForRole(role) {
  return ROLE_FLOWER_PROFILE[role] ?? ROLE_FLOWER_PROFILE.guide;
}

function pickPosture(role, unit) {
  const weights = ROLE_POSTURE_WEIGHTS[role] ?? ROLE_POSTURE_WEIGHTS.guide;
  if (unit < weights.short) return 'short';
  if (unit < weights.short + weights.medium) return 'medium';
  return 'tall';
}

function pickLeanStyle(unit) {
  if (unit < 0.65) return 'upright';
  if (unit < 0.9) return 'soft';
  return 'expressive';
}

function postureLengthRange(range, posture) {
  const min = Math.min(range[0], range[1]);
  const max = Math.max(range[0], range[1]);
  const span = max - min;
  if (posture === 'short') return [min, min + span * 0.38];
  if (posture === 'tall') return [min + span * 0.68, max];
  return [min + span * 0.3, min + span * 0.78];
}

function distributeToTarget(plans, role, target, remaining) {
  const candidates = plans.filter((plan) => plan.groundRole === role);
  let left = remaining;
  let changed = true;
  while (left > 0 && changed) {
    changed = false;
    for (const plan of candidates) {
      if (left <= 0) break;
      if (plan.budget >= target) continue;
      plan.budget += 1;
      left -= 1;
      changed = true;
    }
  }
  return left;
}

function buildTreePlans(weighted, count, pathMin, pathMax, layoutSeed) {
  const grouped = new Map();
  for (const entry of weighted) {
    const treeId = entry.path.logicalTreeId ?? entry.path.treeId;
    let group = grouped.get(treeId);
    if (!group) {
      group = { treeId, entries: [] };
      grouped.set(treeId, group);
    }
    group.entries.push(entry);
  }

  const plans = [...grouped.values()].map((group, index) => {
    const groundRole = group.entries[0]?.path.groundRole ?? 'guide';
    const profile = profileForRole(groundRole);
    const trunks = group.entries.filter(({ path }) => (path.depth ?? 0) === 0);
    const clusterEntries = trunks.length ? trunks : group.entries;
    const treeSeed = layoutSeed + hashIdentity(group.treeId);
    return {
      ...group,
      groundRole,
      profile,
      treeSeed,
      clusterId: index,
      clusterEntry: pickWeighted(clusterEntries, index, S_CLUSTER_PATH, treeSeed),
      clusterT: stableRandomRange(index, S_CLUSTER_T, treeSeed, pathMin, pathMax),
      clusterHalfSpan: stableRandomRange(
        index,
        S_CLUSTER_SPAN,
        treeSeed,
        profile.span[0],
        profile.span[1],
      ),
      allocationRank: stableRandomRange(index, S_BUDGET_ORDER, layoutSeed, 0, 1),
      budget: 0,
      accepted: 0,
      attempts: 0,
    };
  });

  const roleOrder = { hero: 0, nearby: 1, guide: 2 };
  plans.sort((a, b) => (
    (roleOrder[a.groundRole] ?? 2) - (roleOrder[b.groundRole] ?? 2)
    || a.allocationRank - b.allocationRank
  ));

  let remaining = Math.max(0, Math.round(count));
  // First guarantee one bloom source per logical tree whenever count permits.
  for (const plan of plans) {
    if (remaining <= 0) break;
    plan.budget = 1;
    remaining -= 1;
  }

  // Build the intended hierarchy before distributing unusually high counts.
  for (const role of ['hero', 'nearby', 'guide']) {
    remaining = distributeToTarget(
      plans,
      role,
      profileForRole(role).min,
      remaining,
    );
  }
  for (const role of ['hero', 'nearby', 'guide']) {
    remaining = distributeToTarget(
      plans,
      role,
      profileForRole(role).max,
      remaining,
    );
  }

  // Counts above the role caps remain biased toward hero trees without making
  // the allocation depend on path iteration order.
  const overflowCycle = [
    ...plans.filter((plan) => plan.groundRole === 'hero'),
    ...plans.filter((plan) => plan.groundRole === 'hero'),
    ...plans.filter((plan) => plan.groundRole === 'nearby'),
    ...plans.filter((plan) => plan.groundRole === 'guide'),
  ];
  let overflowIndex = 0;
  while (remaining > 0 && overflowCycle.length) {
    overflowCycle[overflowIndex % overflowCycle.length].budget += 1;
    overflowIndex += 1;
    remaining -= 1;
  }

  return plans.filter((plan) => plan.budget > 0);
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
      * ((path.depth ?? 0) === 0 ? 1.6 : 1),
  }));
  const totalLength = weighted.reduce((sum, entry) => sum + entry.length, 0);
  const [pathMin, pathMax] = [
    Math.min(pathRange[0], pathRange[1]),
    Math.max(pathRange[0], pathRange[1]),
  ];
  const treePlans = buildTreePlans(
    weighted,
    count,
    pathMin,
    pathMax,
    layoutSeed,
  );
  const clusteredShare = Math.min(1, Math.max(0, clusterShare));
  const minSpacingSq = Math.max(minSpacing, 0) ** 2;
  const speciesOffset = stableRandomRange(0, S_TYPE, layoutSeed, 0, 1);
  const stems = [];
  const maxAttempts = Math.max(count * 160, treePlans.length * 100);

  for (let attempt = 0; attempt < maxAttempts && stems.length < count; attempt += 1) {
    const plan = treePlans[attempt % treePlans.length];
    if (!plan || plan.accepted >= plan.budget) continue;
    const localAttempt = plan.attempts;
    plan.attempts += 1;
    const useCluster = stableRandomRange(
      localAttempt,
      S_CLUSTER_MODE,
      plan.treeSeed,
      0,
      1,
    ) < clusteredShare;
    let selected;
    let t;

    if (useCluster) {
      selected = plan.clusterEntry;
      const offsetNoise = stableRandomRange(
        localAttempt,
        S_CLUSTER_OFFSET_A,
        plan.treeSeed,
        0,
        1,
      ) + stableRandomRange(
        localAttempt,
        S_CLUSTER_OFFSET_B,
        plan.treeSeed,
        0,
        1,
      ) - 1;
      const curveLength = Math.max(selected.path.curve.getLength(), 1e-6);
      t = Math.min(
        pathMax,
        Math.max(
          pathMin,
          plan.clusterT + offsetNoise * plan.clusterHalfSpan / curveLength,
        ),
      );
    } else {
      selected = pickWeighted(plan.entries, localAttempt, S_PATH, plan.treeSeed);
      t = stableRandomRange(localAttempt, S_T, plan.treeSeed, pathMin, pathMax);
    }
    const point = selected.path.curve.getPointAt(t);
    const forceFirstBloom = plan.accepted === 0 && plan.attempts >= 64;
    const roleSpacingSq = minSpacingSq * plan.profile.gapScale ** 2;
    if (!forceFirstBloom && !farEnough(point, stems, roleSpacingSq)) continue;

    const tangent = selected.path.curve.getTangentAt(t);
    tangent.y = 0;
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
    tangent.normalize();

    // Roots remain attached to the ground route, but the stems open to both
    // sides of it. This turns a one-dimensional row of blooms into a loose
    // flower band without inventing disconnected spawn points.
    const posture = pickPosture(
      plan.groundRole,
      stableRandomRange(plan.accepted, S_POSTURE, plan.treeSeed, 0, 1),
    );
    const leanStyleId = pickLeanStyle(
      stableRandomRange(plan.accepted, S_LEAN_STYLE, plan.treeSeed, 0, 1),
    );
    const leanStyle = LEAN_STYLE[leanStyleId];
    const fanStrength = Math.min(1, Math.max(0, flowerBandSpread))
      * leanStyle.fanScale;
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
    // A low-discrepancy sequence keeps the global species ratio predictable;
    // rejected spatial candidates can no longer bias the accepted flower mix.
    const typeRoll = (speciesOffset + acceptedIndex * SPECIES_SEQUENCE_STEP) % 1;
    const flowerType = typeRoll < roseRatio ? roseType : dahliaType;
    const lengthVariation = stableRandomRange(attempt, S_SIZE, layoutSeed, 0.94, 1.06);
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
      bloomClusterId: plan.clusterId,
      groundRole: plan.groundRole,
      stemPosture: posture,
      leanStyle: leanStyleId,
      flowerSizeScale: plan.profile.sizeScale
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
        stemLength: rangeValue(
          attempt,
          S_LENGTH,
          layoutSeed,
          postureLengthRange(stemGeometry.stemLength, posture),
        ) * lengthVariation,
        stemRadius: inheritedStemRadius,
        leanAngle: Math.min(
          45,
          rangeValue(attempt, S_LEAN, layoutSeed, stemGeometry.leanAngle)
            * leanStyle.leanScale,
        ),
        bendDegree: Math.min(
          0.35,
          rangeValue(attempt, S_BEND, layoutSeed, stemGeometry.bendDegree)
            * leanStyle.bendScale,
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
    plan.accepted += 1;
  }

  return stems;
}
