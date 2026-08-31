export const CAMERA_DEFAULTS = {
  // Look-at for FLOW orbit (world space). Field group sits at y = -1.
  target: [0.0, -0.12, -0.2],
  // Camera sits toward -X so a top-down view reads head-up / feet-down.
  startAngle: 0,

  // Near-nadir still. Small XZ radius so startAngle can hold 頭上腳下.
  overheadHeight: 18,
  overheadRadius: 0.35,

  radius: 3,
  radiusAmp: 0.7,
  radiusCycles: 1.5,
  radiusMin: 1.5,
  radiusMax: 10,

  height: 1.1,
  heightAmp: 1,
  heightCycles: 1.8,

  orbitSpeed: (Math.PI * 2) / 80,

  minDistance: 0.55,
  maxDistance: 15,
  maxPolarAngle: Math.PI / 2.08,
  exploreSmoothTime: 0.45,
};

// Visitor-facing Explore keeps the authored scene framed. The developer
// profile continues to use the wider Leva-controlled limits above.
export const PUBLIC_EXPLORE_DEFAULTS = {
  minDistance: 1.5,
  maxDistance: 7,
  minPolarAngle: 0.35,
  maxPolarAngle: Math.PI / 2.18,
};
