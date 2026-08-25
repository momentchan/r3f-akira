import { stableRandomRange } from '@core';
import { buildAnchorClusterSlots } from './fieldClusterLayout';

const S_RADIUS = 1;
const S_LEAN = 2;
const S_BEND = 3;
const S_TAPER = 4;
const S_FLARE = 5;
const S_TYPE = 6;
const S_HUE = 7;
const S_LIGHT = 8;
const S_SIZE = 18;
const S_BLOOM = 19;
const S_HEIGHT = 22;

/** VAT frame 0 is a closed bud; floor so fringe flowers still read. */
const MIN_BLOOM = 0.32;
/** Lower = fringe closes faster as local density drops. */
const BLOOM_DENSITY_POW = 0.75;
/** Head scale follows the same field as bloom, not hop depth. */
const MIN_SIZE = 0.7;

/**
 * `sizeMul` scales the flower HEAD (via stemRadius). Stem length is passed in
 * already rolled, so tall does not imply large.
 */
function randomParams(i, seed, radMin, radMax, leanMin, leanMax,
  bendMin, bendMax, taperMin, taperMax, flareMin, flareMax, sizeMul, stemLength) {
  return {
    stemLength,
    stemRadius: stableRandomRange(i, S_RADIUS, seed, radMin, radMax) * sizeMul,
    leanAngle: stableRandomRange(i, S_LEAN, seed, leanMin, leanMax),
    bendDegree: stableRandomRange(i, S_BEND, seed, bendMin, bendMax),
    radiusAttenuation: stableRandomRange(i, S_TAPER, seed, taperMin, taperMax),
    baseFlare: stableRandomRange(i, S_FLARE, seed, flareMin, flareMax),
  };
}

function buildStem(slot, slotIndex, opts) {
  const {
    arrangementSeed, roseRatio, roseType, dahliaType,
    lenMin, lenMax, lengthExp,
    radMin, radMax, leanMin, leanMax,
    bendMin, bendMax, taperMin, taperMax, flareMin, flareMax,
  } = opts;
  const typeRoll = stableRandomRange(slotIndex, S_TYPE, arrangementSeed, 0, 1);
  const flowerType = typeRoll < roseRatio ? roseType : dahliaType;
  const sizeJit = stableRandomRange(slotIndex, S_SIZE, arrangementSeed, -0.08, 0.08);
  const density = slot.fieldValue ?? 0;
  const sizeMul = (MIN_SIZE + (1 - MIN_SIZE) * Math.pow(density, BLOOM_DENSITY_POW))
    * (1 + sizeJit);
  const heightU = stableRandomRange(slotIndex, S_HEIGHT, arrangementSeed, 0, 1);
  const stemLength = lenMin + (lenMax - lenMin) * Math.pow(heightU, lengthExp);
  const bloomJit = stableRandomRange(slotIndex, S_BLOOM, arrangementSeed, -0.05, 0.05);
  const bloomCeiling = Math.min(1, Math.max(
    MIN_BLOOM,
    MIN_BLOOM + (1 - MIN_BLOOM) * Math.pow(density, BLOOM_DENSITY_POW) + bloomJit,
  ));
  return {
    position: [slot.x, 0, slot.z],
    leanOutwardAngle: slot.leanOutwardAngle,
    slotIndex,
    anchorIndex: slot.anchorIndex,
    clumpId: slot.clumpId ?? slotIndex,
    bloomCeiling,
    seed: slotIndex * 13 + 1 + arrangementSeed * 17,
    flowerType,
    colorVariationUnit: {
      hue: stableRandomRange(slotIndex, S_HUE, arrangementSeed, -1, 1),
      light: stableRandomRange(slotIndex, S_LIGHT, arrangementSeed, -1, 1),
    },
    params: randomParams(
      slotIndex, arrangementSeed,
      radMin, radMax, leanMin, leanMax,
      bendMin, bendMax, taperMin, taperMax, flareMin, flareMax,
      sizeMul,
      stemLength,
    ),
  };
}

/**
 * Place hearts, then stems around them with the same hop death uses.
 * FieldRuntime owns geometry merge, lifecycle, and per-frame motion.
 */
export function buildFieldStems({
  anchors,
  flowerCount,
  clearanceHosts,
  meshClearDistance,
  bodyCenter,
  arrangementSeed,
  fieldOptions,
  hearts: heartFrac,
  hopMin,
  hopMax,
  roseRatio,
  dahliaType,
  roseType,
  lenMin,
  lenMax,
  lengthExp,
  radMin,
  radMax,
  leanMin,
  leanMax,
  bendMin,
  bendMax,
  taperMin,
  taperMax,
  flareMin,
  flareMax,
}) {
  if (!anchors.length) return { stems: [], hearts: [] };

  const { slots, liveIndices, hearts } = buildAnchorClusterSlots({
    anchors,
    count: flowerCount,
    clearanceHosts,
    clearMargin: meshClearDistance,
    bodyCenter,
    arrangementSeed,
    fieldOptions,
    hearts: heartFrac,
    hopMin,
    hopMax,
  });

  const stems = liveIndices.map((slotIndex) => (
    buildStem(slots[slotIndex], slotIndex, {
      arrangementSeed,
      roseRatio,
      roseType,
      dahliaType,
      lenMin,
      lenMax,
      lengthExp,
      radMin,
      radMax,
      leanMin,
      leanMax,
      bendMin,
      bendMax,
      taperMin,
      taperMax,
      flareMin,
      flareMax,
    })
  ));

  return { stems, hearts };
}
