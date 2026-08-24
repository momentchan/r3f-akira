import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _vertex = new THREE.Vector3();
const _hit = {};
const _ray = new THREE.Ray();
const _rayOrigin = new THREE.Vector3();
const _rayDown = new THREE.Vector3(0, -1, 0);

/** Ground Y for a downward silhouette ray. */
const COLUMN_Y0 = 0.02;
/** Fallback top when a host has no localBox. */
const COLUMN_Y1 = 1.5;

/**
 * Bake posed suit meshes into one BufferGeometry in `parent` local space,
 * then build a MeshBVH for closest-point queries.
 * @param {THREE.Object3D} root character group
 * @param {THREE.Object3D} parent field parent (PlantField / scene group)
 * @returns {{ geometry: THREE.BufferGeometry, bvh: MeshBVH, localBox: THREE.Box3 } | null}
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

  return { geometry, bvh, localBox };
}

/** Stem-axis samples from just above ground to the host top. */
const HEIGHT_COUNT = 4;
const _heights = new Float32Array(HEIGHT_COUNT);

function fillHeights(localBox) {
  const y0 = 0.05;
  const y1 = Number.isFinite(localBox?.max?.y)
    ? Math.max(localBox.max.y, y0 + 0.1)
    : COLUMN_Y1;
  for (let i = 0; i < HEIGHT_COUNT; i += 1) {
    _heights[i] = y0 + (y1 - y0) * (i / (HEIGHT_COUNT - 1));
  }
}

/**
 * Min distance from a ground (x,z) sample to the posed mesh.
 * Samples along the host height instead of a hardcoded Y list.
 */
export function closestDistanceAtXZ(bvh, x, z, localBox = null) {
  fillHeights(localBox);
  let best = null;
  for (let i = 0; i < HEIGHT_COUNT; i += 1) {
    _vertex.set(x, _heights[i], z);
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
 * True when a vertical stem at (x,z) would grow through the mesh.
 *
 * Unsigned closest-point fails here: a sample inside a thick torso is far from
 * every surface, so 3D distance looks "clear". A downward ray from above the
 * host hits the silhouette instead.
 */
export function columnHitsBvh(bvh, x, z, localBox = null) {
  const top = Number.isFinite(localBox?.max?.y)
    ? localBox.max.y + 0.05
    : COLUMN_Y1;
  if (top <= COLUMN_Y0) return false;
  _rayOrigin.set(x, top, z);
  _ray.set(_rayOrigin, _rayDown);
  const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, top - COLUMN_Y0);
  return Boolean(hit?.point);
}

function hostColumnHits(host, x, z) {
  if (!host?.bvh) return false;
  if (host.localBox && !boxNearXZ(host.localBox, x, z, 0.05)) return false;
  return columnHitsBvh(host.bvh, x, z, host.localBox);
}

/** True when a stem at (x,z) would grow through any host. */
export function columnHitsHosts(hosts, x, z) {
  const list = hosts ?? [];
  for (let i = 0; i < list.length; i += 1) {
    if (hostColumnHits(list[i], x, z)) return true;
  }
  return false;
}

/**
 * Push (x,z) away from the mesh until closest distance >= margin.
 * Interior silhouette hits are rejected, not pushed: closest-point XZ from
 * inside a volume points toward the centre and walks deeper in.
 * @returns {[number, number, boolean]} [x, z, ok]
 */
export function clearPointFromBvh(x, z, bvh, margin, localBox = null) {
  if (columnHitsBvh(bvh, x, z, localBox)) return [x, z, false];

  let px = x;
  let pz = z;

  for (let iter = 0; iter < 8; iter += 1) {
    if (columnHitsBvh(bvh, px, pz, localBox)) return [px, pz, false];
    const hit = closestDistanceAtXZ(bvh, px, pz, localBox);
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

  if (columnHitsBvh(bvh, px, pz, localBox)) return [px, pz, false];
  const finalHit = closestDistanceAtXZ(bvh, px, pz, localBox);
  const ok = !finalHit || finalHit.distance >= margin;
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
 * surface, and skipping it avoids extra BVH queries. This keeps the common case
 * (nowhere near the backpack) at single-host cost.
 *
 * @returns {[number, number, boolean]} [x, z, ok]
 */
export function clearPointFromHosts(x, z, hosts, margin) {
  const list = (hosts ?? []).filter((host) => host?.bvh);
  if (!list.length) return [x, z, true];
  if (list.length === 1) {
    return clearPointFromBvh(x, z, list[0].bvh, margin, list[0].localBox);
  }

  const nearest = (px, pz) => {
    let best = null;
    for (const host of list) {
      if (host.localBox && !boxNearXZ(host.localBox, px, pz, margin)) continue;
      const candidate = closestDistanceAtXZ(host.bvh, px, pz, host.localBox);
      if (candidate && (!best || candidate.distance < best.distance)) best = candidate;
    }
    return best;
  };

  // Inside the silhouette: reject. Pushing unsigned-closest XZ from inside a
  // thick volume walks toward the centre, which is how flowers ended up in the
  // torso when warp granted density there.
  if (columnHitsHosts(list, x, z)) return [x, z, false];

  let px = x;
  let pz = z;
  // More iterations than the single-host case: a point can be handed back and
  // forth between two hosts a few times before it settles outside both.
  for (let iter = 0; iter < 12; iter += 1) {
    if (columnHitsHosts(list, px, pz)) return [px, pz, false];
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

  if (columnHitsHosts(list, px, pz)) return [px, pz, false];
  const finalHit = nearest(px, pz);
  const ok = !finalHit || finalHit.distance >= margin;
  return [px, pz, ok];
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

export function expandBoxXZ(localBox, margin) {
  const out = localBox.clone();
  out.min.x -= margin;
  out.max.x += margin;
  out.min.z -= margin;
  out.max.z += margin;
  return out;
}
