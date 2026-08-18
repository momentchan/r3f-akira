import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _vertex = new THREE.Vector3();
const _hit = {};

/**
 * Bake posed suit meshes into one BufferGeometry in `parent` local space,
 * then build a MeshBVH for closest-point queries.
 * @param {THREE.Object3D} root character group
 * @param {THREE.Object3D} parent field parent (PlantField / scene group)
 * @returns {{ geometry: THREE.BufferGeometry, bvh: MeshBVH, localBox: THREE.Box3, worldBox: THREE.Box3 } | null}
 */
export function buildCharacterMeshBVH(root, parent) {
  root.updateWorldMatrix(true, true);
  parent.updateWorldMatrix(true, false);

  const skeletons = new Set();
  root.traverse((obj) => {
    if (obj.isSkinnedMesh && obj.skeleton) skeletons.add(obj.skeleton);
  });
  for (const sk of skeletons) sk.update();

  const parts = [];
  const worldBox = new THREE.Box3();

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    if (obj.name.includes('Person') || obj.name.includes('Outline')) return;

    const src = obj.geometry;
    const position = src?.getAttribute?.('position');
    if (!position || position.count < 3) return;

    const count = position.count;
    const baked = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      if (obj.isSkinnedMesh) obj.getVertexPosition(i, _vertex);
      else _vertex.fromBufferAttribute(position, i);
      _vertex.applyMatrix4(obj.matrixWorld);
      worldBox.expandByPoint(_vertex);
      parent.worldToLocal(_vertex);
      baked[i * 3] = _vertex.x;
      baked[i * 3 + 1] = _vertex.y;
      baked[i * 3 + 2] = _vertex.z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(baked, 3));
    if (src.index) geo.setIndex(src.index.clone());
    else geo.computeVertexNormals();
    parts.push(geo);
  });

  if (parts.length === 0 || worldBox.isEmpty()) {
    for (const g of parts) g.dispose();
    return null;
  }

  const geometry = parts.length === 1
    ? parts[0]
    : mergeGeometries(parts, false);

  if (parts.length > 1) {
    for (const g of parts) g.dispose();
  }

  if (!geometry) return null;

  geometry.computeBoundingBox();
  const bvh = new MeshBVH(geometry, { lazyGeneration: false });
  geometry.boundsTree = bvh;

  const localBox = worldBoxToLocal(worldBox, parent);

  return { geometry, bvh, localBox, worldBox: worldBox.clone() };
}

/**
 * Min distance from a ground (x,z) sample to the posed mesh (checks several heights).
 * @returns {{ distance: number, point: THREE.Vector3 } | null}
 */
export function closestDistanceAtXZ(bvh, x, z, heights) {
  let best = null;
  for (let i = 0; i < heights.length; i += 1) {
    _vertex.set(x, heights[i], z);
    const res = bvh.closestPointToPoint(_vertex, _hit, 0, Infinity);
    if (!res) continue;
    if (!best || res.distance < best.distance) {
      best = {
        distance: res.distance,
        point: res.point.clone(),
      };
    }
  }
  return best;
}

/**
 * Push (x,z) away from the mesh until closest distance >= margin.
 * @returns {[number, number, boolean]} [x, z, ok]
 */
export function clearPointFromBvh(x, z, bvh, margin, heights) {
  let px = x;
  let pz = z;

  for (let iter = 0; iter < 8; iter += 1) {
    const hit = closestDistanceAtXZ(bvh, px, pz, heights);
    if (!hit || hit.distance >= margin) return [px, pz, true];

    let dx = px - hit.point.x;
    let dz = pz - hit.point.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      const a = iter * 2.399; // golden-ish
      dx = Math.cos(a);
      dz = Math.sin(a);
      len = 1;
    }
    const push = (margin - hit.distance) + 0.01;
    px += (dx / len) * push;
    pz += (dz / len) * push;
  }

  const finalHit = closestDistanceAtXZ(bvh, px, pz, heights);
  const ok = !finalHit || finalHit.distance >= margin * 0.85;
  return [px, pz, ok];
}

/** True when (x,z) is close enough to a box's XZ footprint to possibly be inside `margin` of its mesh. */
function boxNearXZ(box, x, z, margin) {
  const slack = margin + 0.02;
  return x >= box.min.x - slack
    && x <= box.max.x + slack
    && z >= box.min.z - slack
    && z <= box.max.z + slack;
}

/**
 * Push (x,z) away from SEVERAL meshes at once until it clears all of them.
 *
 * Not equivalent to calling `clearPointFromBvh` once per host: pushing a point
 * clear of the body can shove it straight into the backpack. Each iteration
 * re-picks the nearest surface across every host, so the point walks out of
 * whichever one it currently sits inside.
 *
 * `hosts` is `{ bvh, localBox }[]`. The box is an optional cheap reject — a point
 * further than `margin` from a host's footprint cannot be that host's nearest
 * surface, and skipping it avoids six BVH queries. This keeps the common case
 * (nowhere near the backpack) at single-host cost.
 *
 * @returns {[number, number, boolean]} [x, z, ok]
 */
export function clearPointFromHosts(x, z, hosts, margin, heights) {
  const list = (hosts ?? []).filter((host) => host?.bvh);
  if (!list.length) return [x, z, true];
  if (list.length === 1) {
    return clearPointFromBvh(x, z, list[0].bvh, margin, heights);
  }

  const nearest = (px, pz) => {
    let best = null;
    for (const host of list) {
      if (host.localBox && !boxNearXZ(host.localBox, px, pz, margin)) continue;
      const candidate = closestDistanceAtXZ(host.bvh, px, pz, heights);
      if (candidate && (!best || candidate.distance < best.distance)) best = candidate;
    }
    return best;
  };

  let px = x;
  let pz = z;
  // More iterations than the single-host case: a point can be handed back and
  // forth between two hosts a few times before it settles outside both.
  for (let iter = 0; iter < 12; iter += 1) {
    const hit = nearest(px, pz);
    if (!hit || hit.distance >= margin) return [px, pz, true];

    let dx = px - hit.point.x;
    let dz = pz - hit.point.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      const a = iter * 2.399; // golden-ish
      dx = Math.cos(a);
      dz = Math.sin(a);
      len = 1;
    }
    const push = (margin - hit.distance) + 0.01;
    px += (dx / len) * push;
    pz += (dz / len) * push;
  }

  const finalHit = nearest(px, pz);
  const ok = !finalHit || finalHit.distance >= margin * 0.85;
  return [px, pz, ok];
}

/** Push XZ away from a soft circular keep-out (helmet pocket). */
export function clearPointFromDisc(x, z, cx, cz, radius) {
  if (radius <= 1e-5) return [x, z, true];
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= radius) return [x, z, true];
  if (d < 1e-5) {
    return [cx + radius, cz, true];
  }
  const s = radius / d;
  return [cx + dx * s, cz + dz * s, true];
}
export function worldBoxToLocal(worldBox, parent) {
  const local = new THREE.Box3();
  const corner = new THREE.Vector3();
  const { min, max } = worldBox;
  for (let ix = 0; ix < 2; ix += 1) {
    for (let iy = 0; iy < 2; iy += 1) {
      for (let iz = 0; iz < 2; iz += 1) {
        corner.set(
          ix ? max.x : min.x,
          iy ? max.y : min.y,
          iz ? max.z : min.z,
        );
        parent.worldToLocal(corner);
        local.expandByPoint(corner);
      }
    }
  }
  return local;
}

const HEAD_BONE_RE = /\bhead\b|c_head|head\.x/i;
const NECK_BONE_RE = /\bneck\b|c_neck|neck\.x/i;
const HELMET_MESH_RE = /helmet/i;

function scoreHeadBone(name) {
  if (/^c_head(\.|$)/i.test(name) || name.toLowerCase() === 'c_head.x') return 10;
  if (/^head(\.|$)/i.test(name) || /^head\.x$/i.test(name)) return 9;
  if (HEAD_BONE_RE.test(name) && !/ref|scale_fix|twist/i.test(name)) return 7;
  if (HEAD_BONE_RE.test(name)) return 4;
  if (NECK_BONE_RE.test(name) && !/ref|twist/i.test(name)) return 2;
  return -1;
}

function considerBone(obj, parent, world, state) {
  if (!obj?.isBone) return;
  const score = scoreHeadBone(obj.name || '');
  if (score < state.bestScore) return;
  obj.getWorldPosition(world);
  parent.worldToLocal(world);
  state.bestScore = score;
  state.best = world.clone();
}

/**
 * Posed helmet mesh AABB center — object.origin is bind-root, so bake vertices.
 * Prefer the main helmet shell over glass/detail pieces.
 */
function findHelmetMeshLocalPoint(root, parent) {
  const world = new THREE.Vector3();
  const candidates = [];

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    const name = obj.name || '';
    if (!HELMET_MESH_RE.test(name)) return;
    const position = obj.geometry?.getAttribute?.('position');
    if (!position || position.count < 3) return;

    const box = new THREE.Box3();
    const step = Math.max(1, Math.floor(position.count / 64));
    for (let i = 0; i < position.count; i += step) {
      // getVertexPosition is mesh-local after skinning; object.origin is bind-root.
      if (obj.isSkinnedMesh) obj.getVertexPosition(i, world);
      else world.fromBufferAttribute(position, i);
      world.applyMatrix4(obj.matrixWorld);
      box.expandByPoint(world);
    }
    if (box.isEmpty()) return;

    let score = 1;
    if (/Helmet_Mesh$/i.test(name) && !/Details|Glass/i.test(name)) score = 10;
    else if (/Helmet_Mesh/i.test(name) && !/Details|Glass/i.test(name)) score = 8;
    else if (/Glass/i.test(name)) score = 3;
    candidates.push({ score, box });
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  candidates[0].box.getCenter(world);
  parent.worldToLocal(world);
  return world.clone();
}

/**
 * Best-effort head point in `parent` local space (for face breathing pocket).
 * Prefers posed helmet mesh AABB (skinned vertices), then head bones.
 * Skinned mesh *object* origins are ignored — they sit at the bind root.
 */
export function findHeadLocalPoint(root, parent) {
  root.updateWorldMatrix(true, true);
  parent.updateWorldMatrix(true, false);

  const skeletons = new Set();
  root.traverse((obj) => {
    if (obj.isSkinnedMesh && obj.skeleton) skeletons.add(obj.skeleton);
  });
  for (const sk of skeletons) sk.update();
  root.updateWorldMatrix(true, true);

  const fromHelmet = findHelmetMeshLocalPoint(root, parent);
  if (fromHelmet) return fromHelmet;

  const world = new THREE.Vector3();
  const state = { best: null, bestScore: -1 };

  root.traverse((obj) => considerBone(obj, parent, world, state));
  for (const sk of skeletons) {
    for (const bone of sk.bones) considerBone(bone, parent, world, state);
  }

  return state.best;
}

export function expandBoxXZ(localBox, margin) {
  const out = localBox.clone();
  out.min.x -= margin;
  out.max.x += margin;
  out.min.z -= margin;
  out.max.z += margin;
  return out;
}
