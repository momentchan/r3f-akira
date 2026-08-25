export const PLANT_WIND_DEFAULTS = Object.freeze({
  enabled: true,
  windStrength: 0.05,
  windAngle: 30,
  windScale: 1.5,
  windSpeed: 0.6,
  colorShift: 0.14,
});

export const WIND_MASK_POW = 2;

export function windMask(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return Math.pow(clamped, WIND_MASK_POW);
}

export function windDirection(windAngle) {
  const angle = windAngle * (Math.PI / 180);
  return { dirX: Math.cos(angle), dirZ: Math.sin(angle) };
}

/** Shared two-frequency field: a broad travelling wave plus fine turbulence. */
export function computeWindGust(baseX, baseZ, time, params = PLANT_WIND_DEFAULTS) {
  if (!params.enabled || params.windStrength <= 0) return 0;
  const angle = params.windAngle * (Math.PI / 180);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const travel = time * params.windSpeed;
  const u = baseX * params.windScale + dirX * travel;
  const v = baseZ * params.windScale + dirZ * travel;
  const slowRaw = Math.sin(u)
    + Math.sin(u * 2.13 + v * 1.7) * 0.5
    + Math.sin(v * 1.31 - u * 0.7) * 0.25;
  const slow = (slowRaw / 1.75) * 0.5 + 0.5;
  const fast = Math.sin(u * 3.17 - v * 2.43 + travel * 3.7) * 0.5 + 0.5;
  return Math.min(1, Math.max(0, slow * 0.78 + fast * 0.22));
}

export function computeWindSway(
  baseX,
  baseZ,
  time,
  params = PLANT_WIND_DEFAULTS,
  response = 1,
  out,
) {
  const sway = out ?? [0, 0];
  if (!params.enabled || params.windStrength <= 0) {
    sway[0] = 0;
    sway[1] = 0;
    return sway;
  }
  const angle = params.windAngle * (Math.PI / 180);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const amount = computeWindGust(baseX, baseZ, time, params)
    * params.windStrength
    * response;
  sway[0] = dirX * amount;
  sway[1] = dirZ * amount;
  return sway;
}
