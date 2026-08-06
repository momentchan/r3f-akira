// CPU-side wind. One gust value per plant per frame is computed here and pushed
// to the stem material as a uniform; the SHADER does the height-masked vertex
// displacement. This module only decides how much each plant leans right now,
// and provides the matching CPU mask so the flower stays glued to the bent tip.

// Base-anchored mask exponent: 0 at the base, 1 at the tip. MUST match the shader
// mask (uv.x ** WIND_MASK_POW) so the flower and the swaying stem tip agree.
export const WIND_MASK_POW = 2.0;

export function windMask(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.pow(c, WIND_MASK_POW);
}

// Fractal-ish gust in [0, 1] from layered sines — organic enough, cheap, and
// stateless so it can be evaluated per plant every frame.
function gust01(u, v) {
  const n =
    Math.sin(u) +
    Math.sin(u * 2.13 + v * 1.7) * 0.5 +
    Math.sin(v * 1.31 - u * 0.7) * 0.25;
  return (n / 1.75) * 0.5 + 0.5;
}

// Unit downwind direction on the ground plane (XZ) for a given wind angle. The
// gust only scales this vector, so the wind direction is CONSTANT — leaves bake
// their per-vertex wind response from this and drive it with the gust scalar.
export function windDirection(windAngle) {
  const a = windAngle * (Math.PI / 180);
  return { dirX: Math.cos(a), dirZ: Math.sin(a) };
}

// Horizontal sway vector [x, z] for a plant based at (baseX, baseZ). Wind always
// pushes downwind (like the reference), gusting between 0 and windStrength. The
// plant's base position offsets the noise phase, so plants gust out of sync.
export function computeWindSway(baseX, baseZ, time, params) {
  const { windAngle, windStrength, windScale, windSpeed } = params;
  const { dirX, dirZ } = windDirection(windAngle);
  const u = baseX * windScale + dirX * time * windSpeed;
  const v = baseZ * windScale + dirZ * time * windSpeed;
  const g = gust01(u, v) * windStrength;
  return [dirX * g, dirZ * g];
}
