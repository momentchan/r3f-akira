import * as THREE from 'three';

function hash3D(x, y, z, seed) {
  const value = Math.sin(
    x * 127.1
    + y * 269.5
    + z * 311.7
    + seed * 74.7
  ) * 43758.5453;
  return value - Math.floor(value);
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Continuous seeded value noise in [-1, 1].
 *
 * Exported because the flower-field anchor mask needs a *spatially coherent*
 * field: `stableRandomRange` is index-hashed, so neighbouring candidate positions
 * get unrelated values and a cluster edge ends up looking like a circle with
 * static on it rather than a ragged boundary.
 */
export function valueNoise3D(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);
  const x00 = lerp(hash3D(x0, y0, z0, seed), hash3D(x0 + 1, y0, z0, seed), tx);
  const x10 = lerp(hash3D(x0, y0 + 1, z0, seed), hash3D(x0 + 1, y0 + 1, z0, seed), tx);
  const x01 = lerp(hash3D(x0, y0, z0 + 1, seed), hash3D(x0 + 1, y0, z0 + 1, seed), tx);
  const x11 = lerp(
    hash3D(x0, y0 + 1, z0 + 1, seed),
    hash3D(x0 + 1, y0 + 1, z0 + 1, seed),
    tx,
  );
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz) * 2 - 1;
}

/** Sample one coherent X/Z displacement from a shared spatial noise field. */
export function sampleSpatialNoiseOffset(x, y, z, {
  amount = 0,
  frequency = 3,
  seed = 0,
} = {}) {
  if (amount <= 0) return [0, 0];
  const px = x * frequency;
  const py = y * frequency;
  const pz = z * frequency;
  const offsetX = valueNoise3D(px + 17.3, py + 3.7, pz - 9.1, seed) * amount;
  const offsetZ = valueNoise3D(px - 5.7, py - 13.1, pz + 23.9, seed + 101) * amount;
  return [offsetX, offsetZ];
}

/**
 * Resample a curve through the field so every small path segment receives its
 * own smooth offset. The root is blended to zero to keep it on the ground.
 */
export function distortCurveWithSpatialNoise(curve, {
  amount = 0,
  frequency = 3,
  seed = 0,
  samples = 48,
} = {}) {
  if (!curve || amount <= 0) return { curve, points: null };

  const count = Math.max(18, Math.floor(samples));
  const point = new THREE.Vector3();
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    curve.getPointAt(t, point);
    const [offsetX, offsetZ] = sampleSpatialNoiseOffset(
      point.x,
      point.y,
      point.z,
      { amount, frequency, seed },
    );
    // Smoothly release the planted root over the first 12% of path length.
    const rootMask = smooth(Math.min(t / 0.12, 1));
    points.push(point.clone().add(new THREE.Vector3(
      offsetX * rootMask,
      0,
      offsetZ * rootMask,
    )));
  }

  return {
    curve: new THREE.CatmullRomCurve3(points, false, 'centripetal'),
    points,
  };
}
