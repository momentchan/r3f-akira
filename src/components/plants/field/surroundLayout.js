// Body-aware stem placement for a resting character.
// Stems gather in a ring around an elliptical clear zone (never inside).

const S_ANG = 20;
const S_BAND = 21;

/**
 * Ellipse test / project in a yaw-rotated body frame.
 * Local +X = body length (head↔feet for Lay), local +Z = body width.
 */
function toBodyLocal(x, z, cx, cz, yaw) {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    lx: dx * c + dz * s,
    lz: -dx * s + dz * c,
  };
}

function fromBodyLocal(lx, lz, cx, cz, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: cx + lx * c - lz * s,
    z: cz + lx * s + lz * c,
  };
}

/**
 * Keep stems off the astronaut footprint; bias density to a surround ring.
 *
 * @returns {[number, number]} [x, z]
 */
export function applySurroundPlacement(
  posX,
  posZ,
  i,
  seed,
  {
    enabled,
    bodyHalfWidth: hw, // local Z — shoulder↔shoulder
    bodyHalfLength: hl, // local X — head↔feet
    bodyCenterX: cx,
    bodyCenterZ: cz,
    /** Radians; 0 = length along world +X (matches top-down Lay: head/feet left-right). */
    bodyYaw = 0,
    densityBias,
    clearMargin = 0.2,
    ringWidth = 0.55,
  },
  stableRandomRange,
) {
  if (!enabled || hw <= 0 || hl <= 0) return [posX, posZ];

  const clearR = 1 + Math.max(0, clearMargin);
  const outerR = clearR + Math.max(0.05, ringWidth);

  let x = posX;
  let z = posZ;

  let { lx, lz } = toBodyLocal(x, z, cx, cz, bodyYaw);
  let len = Math.hypot(lx / hl, lz / hw);

  // Center sample — pick a surround angle in body space
  if (len < 1e-5) {
    const ang = stableRandomRange(i, S_ANG, seed, 0, Math.PI * 2);
    const bandT = stableRandomRange(i, S_BAND, seed, 0, 1);
    const r = clearR + bandT * (outerR - clearR);
    const out = fromBodyLocal(
      Math.cos(ang) * hl * r,
      Math.sin(ang) * hw * r,
      cx,
      cz,
      bodyYaw,
    );
    return [out.x, out.z];
  }

  const ux = (lx / hl) / len;
  const uz = (lz / hw) / len;

  // Soft pull toward the surrounding band (outside the body).
  if (densityBias > 0) {
    const bandT = stableRandomRange(i, S_BAND, seed, 0, 1);
    const targetR = clearR + bandT * (outerR - clearR);
    const target = fromBodyLocal(ux * hl * targetR, uz * hw * targetR, cx, cz, bodyYaw);
    x += (target.x - x) * densityBias;
    z += (target.z - z) * densityBias;
  }

  // Hard clear: nothing inside the body ellipse (+ margin).
  ({ lx, lz } = toBodyLocal(x, z, cx, cz, bodyYaw));
  len = Math.hypot(lx / hl, lz / hw) || 1;
  if (len < clearR) {
    const ux2 = (lx / hl) / len;
    const uz2 = (lz / hw) / len;
    const out = fromBodyLocal(ux2 * hl * clearR, uz2 * hw * clearR, cx, cz, bodyYaw);
    x = out.x;
    z = out.z;
  }

  return [x, z];
}
