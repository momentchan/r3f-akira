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

function rangeValue(attempt, salt, seed, range) {
  return stableRandomRange(attempt, salt, seed, range[0], range[1]);
}

function farEnough(point, accepted, minSpacingSq) {
  if (minSpacingSq <= 0) return true;
  return accepted.every((stem) => {
    const dx = point.x - stem.position[0];
    const dz = point.z - stem.position[2];
    return dx * dx + dz * dz >= minSpacingSq;
  });
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
  stemGeometry = STEM_DEFAULTS.geometry,
}) {
  if (!paths.length || count < 1) return [];

  const weighted = paths.map((path) => ({
    path,
    length: Math.max(path.curve.getLength(), 1e-6),
  }));
  const totalLength = weighted.reduce((sum, entry) => sum + entry.length, 0);
  const [pathMin, pathMax] = [
    Math.min(pathRange[0], pathRange[1]),
    Math.max(pathRange[0], pathRange[1]),
  ];
  const minSpacingSq = Math.max(minSpacing, 0) ** 2;
  const stems = [];
  const maxAttempts = Math.max(count * 40, 80);

  for (let attempt = 0; attempt < maxAttempts && stems.length < count; attempt += 1) {
    let pick = stableRandomRange(attempt, S_PATH, layoutSeed, 0, totalLength);
    let selected = weighted[weighted.length - 1];
    for (const entry of weighted) {
      pick -= entry.length;
      if (pick <= 0) {
        selected = entry;
        break;
      }
    }

    const t = stableRandomRange(attempt, S_T, layoutSeed, pathMin, pathMax);
    const point = selected.path.curve.getPointAt(t);
    if (!farEnough(point, stems, minSpacingSq)) continue;

    const tangent = selected.path.curve.getTangentAt(t);
    tangent.y = 0;
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
    tangent.normalize();

    const acceptedIndex = stems.length;
    const typeRoll = stableRandomRange(attempt, S_TYPE, layoutSeed, 0, 1);
    const flowerType = typeRoll < roseRatio ? roseType : dahliaType;
    const sizeMul = stableRandomRange(attempt, S_SIZE, layoutSeed, 0.72, 1.05);
    const seed = layoutSeed * 1009 + attempt * 37 + acceptedIndex;
    const motionPoint = selected.path.curve.getPointAt(0.5);
    stems.push({
      position: [point.x, point.y, point.z],
      leanOutwardAngle: Math.atan2(tangent.x, tangent.z),
      slotIndex: -1,
      rimT: Math.min(1, selected.path.pathEndDistance / Math.max(totalLength, 1e-6)),
      seed,
      sourceTreeId: selected.path.treeId,
      sourcePathId: selected.path.id,
      sourcePathT: t,
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
        stemRadius: rangeValue(attempt, S_RADIUS, layoutSeed, stemGeometry.stemRadius)
          * sizeMul,
        leanAngle: rangeValue(attempt, S_LEAN, layoutSeed, stemGeometry.leanAngle),
        bendDegree: rangeValue(attempt, S_BEND, layoutSeed, stemGeometry.bendDegree),
        radiusAttenuation: rangeValue(
          attempt,
          S_TAPER,
          layoutSeed,
          stemGeometry.radiusAttenuation,
        ),
        baseFlare: rangeValue(attempt, S_FLARE, layoutSeed, stemGeometry.baseFlare),
      },
    });
  }

  return stems;
}
