import * as THREE from 'three/webgpu';
import { seededRng } from '../stem/buildStemTube.js';

const TAU = Math.PI * 2;
const _point = new THREE.Vector3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

function rotateGroundDirection(direction, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return new THREE.Vector3(
    direction.x * cos - direction.z * sin,
    0,
    direction.x * sin + direction.z * cos,
  ).normalize();
}

function directionAngle(direction) {
  return Math.atan2(direction.z, direction.x);
}

function shortestAngle(from, to) {
  let delta = (to - from + Math.PI) % TAU - Math.PI;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

function footprintRoot(
  host,
  targetAngle,
  groundY,
  groundGap,
  contactBand,
  stemRadius,
) {
  const position = host.geometry?.getAttribute?.('position');
  if (!position?.count) return null;
  host.localBox.getCenter(_center);
  host.localBox.getSize(_size);
  const direction = new THREE.Vector3(Math.cos(targetAngle), 0, Math.sin(targetAngle));
  const stride = Math.max(1, Math.floor(position.count / 18000));
  const band = Math.max(contactBand, 0.001);
  let bestScore = -Infinity;
  let lowestY = Infinity;
  const rootSurfacePoint = new THREE.Vector3();

  // First find the actual lowest mesh surface. It becomes a safe fallback for
  // props that sit a few centimetres above the nominal ground plane.
  for (let i = 0; i < position.count; i += stride) {
    const y = position.getY(i);
    if (y < lowestY) lowestY = y;
  }

  const scoreCandidates = (useGroundBand) => {
    const referenceY = useGroundBand ? groundY : lowestY;
    for (let i = 0; i < position.count; i += stride) {
      _point.fromBufferAttribute(position, i);
      if (Math.abs(_point.y - referenceY) > band) continue;
      const dx = _point.x - _center.x;
      const dz = _point.z - _center.z;
      const radial = Math.hypot(dx, dz);
      if (radial < 1e-5) continue;
      const alignment = (dx * direction.x + dz * direction.z) / radial;
      const heightPenalty = Math.abs(_point.y - referenceY) / band;
      // Direction dominates distance: each angular sector must choose its own
      // real contact point instead of letting a long arm steal every root.
      const score = alignment * 5 + radial / Math.max(_size.x, _size.z, 0.1) * 0.25
        - heightPenalty * 0.15;
      if (score > bestScore) {
        bestScore = score;
        rootSurfacePoint.copy(_point);
      }
    }
  };

  scoreCandidates(true);
  if (!Number.isFinite(bestScore)) scoreCandidates(false);
  if (!Number.isFinite(bestScore)) return null;

  // Start on the real mesh contact itself. Subsequent curve controls settle to
  // the ground height, so a slightly elevated lowest surface bends down rather
  // than producing a detached projected root.
  const root = rootSurfacePoint.clone();
  root.y = Math.max(rootSurfacePoint.y, groundY) + groundGap + stemRadius;

  const outward = root.clone().sub(_center).setY(0);
  if (outward.lengthSq() < 1e-8) outward.copy(direction);
  outward.normalize();
  return { root, outward, rootSurfacePoint };
}

function makeGroundCurve({
  start,
  initialDirection,
  targetDirection,
  length,
  curvature,
  groundY,
  groundGap,
  stemRadius,
  radiusStartScale,
  radiusEndScale,
  rng,
}) {
  const initialAngle = directionAngle(initialDirection);
  const targetAngle = directionAngle(targetDirection);
  const turn = shortestAngle(initialAngle, targetAngle);
  const lateralSign = rng() < 0.5 ? -1 : 1;
  const lateralAmount = (0.45 + rng() * 0.55) * curvature * length * lateralSign;
  const points = [];
  for (let i = 0; i <= 5; i += 1) {
    const t = i / 5;
    const blend = t * t * (3 - 2 * t);
    const angle = initialAngle + turn * blend;
    const forward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new THREE.Vector3(-forward.z, 0, forward.x);
    const point = start.clone()
      .addScaledVector(forward, length * t)
      .addScaledVector(side, lateralAmount * Math.sin(Math.PI * t));
    const smoothRadiusT = t * t * (3 - 2 * t);
    const radiusScale = THREE.MathUtils.lerp(
      radiusStartScale,
      radiusEndScale,
      smoothRadiusT,
    );
    // The centreline follows the tube's changing radius. This keeps the lower
    // surface on y=0 even as child branches become thinner.
    point.y = groundY + groundGap + stemRadius * radiusScale;
    points.push(point);
  }
  points[0].copy(start);
  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}

function radiusAt(path, t) {
  const smooth = t * t * (3 - 2 * t);
  return THREE.MathUtils.lerp(path.radiusStartScale, path.radiusEndScale, smooth);
}

function addChildren(paths, parent, options, rng, depth) {
  if (depth >= options.branchDepth) return;
  const childCount = Math.max(1, Math.round(options.branchesPerLevel));
  for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
    const baseT = childCount === 1
      ? 0.62
      : THREE.MathUtils.lerp(0.42, 0.76, childIndex / (childCount - 1));
    const attachT = THREE.MathUtils.clamp(baseT + (rng() - 0.5) * 0.12, 0.34, 0.84);
    const start = parent.curve.getPointAt(attachT, new THREE.Vector3());
    const tangent = parent.curve.getTangentAt(attachT, new THREE.Vector3()).setY(0);
    if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
    tangent.normalize();

    const side = childIndex % 2 === 0 ? -1 : 1;
    const [angleMin, angleMax] = options.branchAngleRange;
    const branchAngle = THREE.MathUtils.degToRad(
      THREE.MathUtils.lerp(Math.min(angleMin, angleMax), Math.max(angleMin, angleMax), rng()),
    ) * side + THREE.MathUtils.degToRad((rng() - 0.5) * 10);
    // Re-anchor every generation to the host centre. This makes the complete
    // hierarchy read as a radial network instead of accumulating sideways
    // turns as depth increases. The curve still begins on the parent tangent,
    // so the junction remains smooth.
    const radialDirection = start.clone().sub(parent.radialOrigin).setY(0);
    if (radialDirection.lengthSq() < 1e-8) radialDirection.copy(tangent);
    radialDirection.normalize();
    const targetDirection = rotateGroundDirection(radialDirection, branchAngle);
    const lengthVariation = 1 + (rng() * 2 - 1) * options.lengthVariation;
    const length = Math.max(
      parent.curve.getLength() * options.branchLengthScale * lengthVariation,
      0.08,
    );
    const startRadius = radiusAt(parent, attachT);
    const endRadius = startRadius * options.radiusDecay;
    const curve = makeGroundCurve({
      start,
      initialDirection: tangent,
      targetDirection,
      length,
      curvature: options.curvature,
      groundY: options.groundY,
      groundGap: options.groundGap,
      stemRadius: options.tendrilRadius,
      radiusStartScale: startRadius,
      radiusEndScale: endRadius,
      rng,
    });
    const startDistance = parent.pathStartDistance
      + parent.curve.getLength() * attachT;
    // Match the parent's local width exactly at the junction. The child then
    // tapers from there, avoiding the pinched/discontinuous branch joint.
    const child = {
      curve,
      treeId: parent.treeId,
      hostId: parent.hostId,
      seed: parent.seed * 31 + depth * 7 + childIndex + 1,
      role: 'ground-branch',
      parentId: parent.id,
      id: `${parent.id}.${childIndex}`,
      depth: depth + 1,
      attachT,
      junction: start.clone(),
      radialOrigin: parent.radialOrigin,
      pathStartDistance: startDistance,
      pathEndDistance: startDistance + curve.getLength(),
      radiusStartScale: startRadius,
      radiusEndScale: endRadius,
      baseFlareScale: 0,
    };
    paths.push(child);
    addChildren(paths, child, options, rng, depth + 1);
  }
}

function buildHostTrees(host, count, options) {
  if (!host?.geometry || !host?.localBox || count < 1) return [];
  const paths = [];
  const radialOrigin = host.localBox.getCenter(new THREE.Vector3()).setY(options.groundY);
  const phaseRng = seededRng(options.layoutSeed + options.seedOffset);
  const phase = phaseRng() * TAU;
  for (let treeIndex = 0; treeIndex < count; treeIndex += 1) {
    const seed = options.layoutSeed + options.seedOffset + treeIndex * 101;
    const rng = seededRng(seed);
    const angle = phase + TAU * (treeIndex + 0.5) / count
      + (rng() - 0.5) * (TAU / count) * 0.45;
    const contact = footprintRoot(
      host,
      angle,
      options.groundY,
      options.groundGap,
      options.contactBand,
      options.tendrilRadius,
    );
    if (!contact) continue;
    const { root, outward, rootSurfacePoint } = contact;
    const targetDirection = rotateGroundDirection(
      outward,
      (rng() - 0.5) * THREE.MathUtils.degToRad(24),
    );
    const lengthVariation = 1 + (rng() * 2 - 1) * options.lengthVariation;
    const length = options.trunkLength * options.lengthScale * lengthVariation;
    const curve = makeGroundCurve({
      start: root,
      initialDirection: outward,
      targetDirection,
      length,
      curvature: options.curvature,
      groundY: options.groundY,
      groundGap: options.groundGap,
      stemRadius: options.tendrilRadius,
      radiusStartScale: 1,
      radiusEndScale: options.tipRadiusScale,
      rng,
    });
    const treeId = `ground:${host.id}:${treeIndex}`;
    const trunk = {
      curve,
      treeId,
      hostId: host.id,
      seed,
      role: 'ground-trunk',
      parentId: null,
      id: `${treeId}:trunk`,
      depth: 0,
      root: root.clone(),
      rootSurfacePoint: rootSurfacePoint.clone(),
      radialOrigin,
      pathStartDistance: 0,
      pathEndDistance: curve.getLength(),
      radiusStartScale: 1,
      radiusEndScale: options.tipRadiusScale,
      baseFlareScale: 1,
    };
    paths.push(trunk);
    addChildren(paths, trunk, options, rng, 0);
  }
  return paths;
}

export function buildGroundTrees({ hosts, profiles, ...options }) {
  return hosts.flatMap((host) => {
    const profile = profiles[host.id];
    if (!profile) return [];
    const count = host.id === 'body'
      ? options.bodyTreeCount
      : options.backpackTreeCount;
    return buildHostTrees(host, count, {
      ...options,
      seedOffset: profile.seedOffset,
      lengthScale: profile.lengthScale,
    });
  });
}
