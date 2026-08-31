import * as THREE from 'three';

const graphCache = new WeakMap();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _hit = {};

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(node, distance) {
    const item = { node, distance };
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (items[parent].distance <= distance) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }

  pop() {
    const items = this.items;
    if (!items.length) return null;
    const root = items[0];
    const last = items.pop();
    if (!items.length) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= items.length) break;
      const right = left + 1;
      const child = right < items.length && items[right].distance < items[left].distance
        ? right
        : left;
      if (items[child].distance >= last.distance) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return root;
  }
}

function vertexIndex(index, triangle, corner) {
  const offset = triangle * 3 + corner;
  return index ? index.getX(offset) : offset;
}

function positionKey(point, inverseTolerance) {
  return `${Math.round(point.x * inverseTolerance)},${Math.round(point.y * inverseTolerance)},${Math.round(point.z * inverseTolerance)}`;
}

function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function addEdge(adjacency, left, right) {
  if (left === right) return;
  adjacency[left].push(right);
  adjacency[right].push(left);
}

function createSurfaceGraph(geometry, seamDistance) {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.count < 3) return null;
  const index = geometry.getIndex();
  const triangleCount = Math.floor((index?.count ?? position.count) / 3);
  if (triangleCount < 1) return null;

  const weldTolerance = 1e-5;
  const inverseTolerance = 1 / weldTolerance;
  const canonicalByVertex = new Int32Array(position.count);
  const nodeByPosition = new Map();
  const nodes = [];

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    _a.fromBufferAttribute(position, vertex);
    const key = positionKey(_a, inverseTolerance);
    let canonical = nodeByPosition.get(key);
    if (canonical == null) {
      canonical = nodes.length;
      nodeByPosition.set(key, canonical);
      nodes.push(_a.clone());
    }
    canonicalByVertex[vertex] = canonical;
  }

  const adjacency = Array.from({ length: nodes.length }, () => []);
  const normals = Array.from({ length: nodes.length }, () => new THREE.Vector3());
  const triangleNodes = new Int32Array(triangleCount * 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = canonicalByVertex[vertexIndex(index, triangle, 0)];
    const ib = canonicalByVertex[vertexIndex(index, triangle, 1)];
    const ic = canonicalByVertex[vertexIndex(index, triangle, 2)];
    triangleNodes[triangle * 3] = ia;
    triangleNodes[triangle * 3 + 1] = ib;
    triangleNodes[triangle * 3 + 2] = ic;
    addEdge(adjacency, ia, ib);
    addEdge(adjacency, ib, ic);
    addEdge(adjacency, ic, ia);
    _ab.subVectors(nodes[ib], nodes[ia]);
    _ac.subVectors(nodes[ic], nodes[ia]);
    const normal = _ab.cross(_ac);
    normals[ia].add(normal);
    normals[ib].add(normal);
    normals[ic].add(normal);
  }
  for (let i = 0; i < normals.length; i += 1) {
    if (normals[i].lengthSq() > 1e-12) normals[i].normalize();
    else normals[i].set(0, 1, 0);
  }

  // Bridge only tiny export seams or touching mesh pieces. These are never
  // allowed to become general shortcuts through open space.
  const seamCellSize = Math.max(seamDistance, 1e-4);
  const inverseSeamCell = 1 / seamCellSize;
  const seamCells = new Map();
  const seamDistanceSq = seamDistance * seamDistance;
  for (let i = 0; i < nodes.length; i += 1) {
    const point = nodes[i];
    const ix = Math.floor(point.x * inverseSeamCell);
    const iy = Math.floor(point.y * inverseSeamCell);
    const iz = Math.floor(point.z * inverseSeamCell);
    const candidates = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const nearby = seamCells.get(cellKey(ix + dx, iy + dy, iz + dz));
          if (!nearby) continue;
          for (let n = 0; n < nearby.length; n += 1) {
            const other = nearby[n];
            const distanceSq = point.distanceToSquared(nodes[other]);
            if (distanceSq > weldTolerance * weldTolerance && distanceSq <= seamDistanceSq) {
              candidates.push({ other, distanceSq });
            }
          }
        }
      }
    }
    candidates.sort((left, right) => left.distanceSq - right.distanceSq);
    let added = 0;
    for (let c = 0; c < candidates.length && added < 2; c += 1) {
      const other = candidates[c].other;
      if (adjacency[i].includes(other)) continue;
      addEdge(adjacency, i, other);
      added += 1;
    }
    const key = cellKey(ix, iy, iz);
    const cell = seamCells.get(key);
    if (cell) cell.push(i);
    else seamCells.set(key, [i]);
  }

  // Preserve disconnected exported pieces (panels, pockets, suit parts). Each
  // required component can later establish its own ground root instead of
  // being silently rejected because another component touches the ground.
  const componentByNode = new Int32Array(nodes.length);
  componentByNode.fill(-1);
  const components = [];
  for (let start = 0; start < nodes.length; start += 1) {
    if (componentByNode[start] >= 0) continue;
    const componentId = components.length;
    const componentNodes = [];
    const stack = [start];
    componentByNode[start] = componentId;
    while (stack.length) {
      const node = stack.pop();
      componentNodes.push(node);
      const neighbors = adjacency[node];
      for (let i = 0; i < neighbors.length; i += 1) {
        const next = neighbors[i];
        if (componentByNode[next] >= 0) continue;
        componentByNode[next] = componentId;
        stack.push(next);
      }
    }
    components.push({ nodes: componentNodes });
  }

  // A larger lookup grid is used only to attach wrap contacts to graph nodes.
  const lookupCellSize = Math.max(seamDistance * 4, 0.04);
  const inverseLookupCell = 1 / lookupCellSize;
  const lookup = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    const point = nodes[i];
    const key = cellKey(
      Math.floor(point.x * inverseLookupCell),
      Math.floor(point.y * inverseLookupCell),
      Math.floor(point.z * inverseLookupCell),
    );
    const cell = lookup.get(key);
    if (cell) cell.push(i);
    else lookup.set(key, [i]);
  }

  return {
    nodes,
    normals,
    adjacency,
    lookup,
    lookupCellSize,
    inverseLookupCell,
    triangleNodes,
    componentByNode,
    components,
  };
}

function surfaceGraph(geometry, seamDistance) {
  let entries = graphCache.get(geometry);
  if (!entries) {
    entries = new Map();
    graphCache.set(geometry, entries);
  }
  const key = seamDistance.toFixed(5);
  let graph = entries.get(key);
  if (!graph) {
    graph = createSurfaceGraph(geometry, seamDistance);
    if (graph) entries.set(key, graph);
  }
  return graph ?? null;
}

/** Point clouds for disconnected topology islands, used by bone-free guides. */
export function getSurfaceComponentPointClouds(geometry, seamDistance = 1e-5) {
  const graph = surfaceGraph(geometry, seamDistance);
  if (!graph) return [];
  return graph.components.map((component) => (
    component.nodes.map((node) => graph.nodes[node].clone())
  ));
}

function nearestNode(graph, point, maxDistance) {
  const radius = Math.ceil(maxDistance / graph.lookupCellSize);
  const ix = Math.floor(point.x * graph.inverseLookupCell);
  const iy = Math.floor(point.y * graph.inverseLookupCell);
  const iz = Math.floor(point.z * graph.inverseLookupCell);
  const maxDistanceSq = maxDistance * maxDistance;
  let best = -1;
  let bestDistanceSq = maxDistanceSq;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const cell = graph.lookup.get(cellKey(ix + dx, iy + dy, iz + dz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i += 1) {
          const node = cell[i];
          const distanceSq = point.distanceToSquared(graph.nodes[node]);
          if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            best = node;
          }
        }
      }
    }
  }
  return best;
}

function targetSurfaceNode(graph, bvh, point, maxDistance) {
  const nearby = nearestNode(graph, point, maxDistance);
  if (nearby >= 0) return nearby;

  // Large low-poly faces may have no vertex inside maxDistance. The BVH still
  // knows the exact hit triangle, so attach to its closest canonical corner
  // rather than discarding the target in the middle of an otherwise valid face.
  const closest = bvh.closestPointToPoint(
    point,
    _hit,
    0,
    Math.max(maxDistance, 0.08),
  );
  const faceIndex = closest?.faceIndex;
  if (!Number.isInteger(faceIndex) || faceIndex < 0) return -1;
  const offset = faceIndex * 3;
  let best = graph.triangleNodes[offset];
  let bestDistanceSq = point.distanceToSquared(graph.nodes[best]);
  for (let corner = 1; corner < 3; corner += 1) {
    const node = graph.triangleNodes[offset + corner];
    const distanceSq = point.distanceToSquared(graph.nodes[node]);
    if (distanceSq < bestDistanceSq) {
      best = node;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

function shortestSurfaceTree(graph, sources) {
  const distance = new Float64Array(graph.nodes.length);
  distance.fill(Infinity);
  const previous = new Int32Array(graph.nodes.length);
  previous.fill(-1);
  const heap = new MinHeap();
  for (let i = 0; i < sources.length; i += 1) {
    distance[sources[i]] = 0;
    heap.push(sources[i], 0);
  }

  while (heap.items.length) {
    const current = heap.pop();
    if (current.distance !== distance[current.node]) continue;
    const neighbors = graph.adjacency[current.node];
    for (let i = 0; i < neighbors.length; i += 1) {
      const next = neighbors[i];
      const candidate = current.distance
        + graph.nodes[current.node].distanceTo(graph.nodes[next]);
      if (candidate >= distance[next]) continue;
      distance[next] = candidate;
      previous[next] = current.node;
      heap.push(next, candidate);
    }
  }
  return { distance, previous };
}

function offsetNode(graph, node, surfaceOffset) {
  return graph.nodes[node].clone().addScaledVector(graph.normals[node], surfaceOffset);
}

/**
 * Begin a child inside its incoming parent edge. The shared approach gives
 * separately packed tubes the same direction/radius before the child turns,
 * hiding the otherwise open, independently-oriented tube wraps at the fork.
 */
function junctionOverlapPoint({
  graph,
  tree,
  node,
  surfaceOffset,
  groundY,
}) {
  const junction = offsetNode(graph, node, surfaceOffset);
  const parent = tree.previous[node];
  if (parent >= 0) {
    return offsetNode(graph, parent, surfaceOffset).lerp(junction, 0.45);
  }
  const ground = junction.clone();
  ground.y = groundY;
  return ground.lerp(junction, 0.45);
}

/** Rounded polyline whose line/bezier joins share tangents at every corner. */
export function roundedSurfacePolylineCurve(points, cornerFraction = 0.24) {
  if (points.length < 2) return null;
  const clean = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (clean[clean.length - 1].distanceToSquared(points[i]) >= 1e-12) {
      clean.push(points[i]);
    }
  }
  if (clean.length < 2) return null;

  const path = new THREE.CurvePath();
  if (clean.length === 2) {
    path.add(new THREE.LineCurve3(clean[0], clean[1]));
    return path;
  }

  const fraction = THREE.MathUtils.clamp(cornerFraction, 0.05, 0.45);
  let current = clean[0];
  for (let i = 1; i < clean.length - 1; i += 1) {
    const corner = clean[i];
    const entry = corner.clone().lerp(clean[i - 1], fraction);
    const exit = corner.clone().lerp(clean[i + 1], fraction);
    if (current.distanceToSquared(entry) >= 1e-12) {
      path.add(new THREE.LineCurve3(current, entry));
    }
    path.add(new THREE.QuadraticBezierCurve3(entry, corner, exit));
    current = exit;
  }
  const end = clean[clean.length - 1];
  if (current.distanceToSquared(end) >= 1e-12) {
    path.add(new THREE.LineCurve3(current, end));
  }
  return path.curves.length ? path : null;
}

// THREE.Tree tapers by branch generation. These routes do not have regular
// generations, so downstream target load is the more useful hierarchy signal:
// a shared parent carrying many tendrils is thicker than each child branch.
function radiusScaleForLoad(load) {
  return Math.min(1 + Math.log2(Math.max(load, 1)) * 0.28, 3.5);
}

function projectedAttachmentPoints(bvh, start, target, surfaceOffset) {
  const points = [start.clone()];
  const sample = new THREE.Vector3();
  for (let i = 1; i < 5; i += 1) {
    sample.lerpVectors(start, target, i / 5);
    const hit = bvh.closestPointToPoint(sample, _hit, 0, 0.08);
    if (!hit?.point) return null;
    const point = hit.point.clone();
    _a.subVectors(sample, hit.point);
    if (_a.lengthSq() > 1e-10) point.addScaledVector(_a.normalize(), surfaceOffset);
    points.push(point);
  }
  points.push(target.clone());
  return points;
}

/**
 * Multi-source surface routing from genuine ground-contact vertices.
 * Returns a merged forest of strict mesh-edge paths plus reachable target ids.
 */
export function buildGroundedSurfaceRoutes({
  host,
  targets,
  groundY = 0,
  groundBand = 0.025,
  seamDistance = 0.012,
  targetAttachDistance = 0.12,
  surfaceOffset = 0.007,
} = {}) {
  if (!host?.geometry || !host?.bvh || !targets?.length) {
    return {
      routes: [],
      reached: new Set(),
      targetDistances: new Map(),
      targetGraphPoints: new Map(),
      targetAttachments: new Map(),
      targetRadiusScales: new Map(),
      targetTreeIds: new Map(),
    };
  }
  const graph = surfaceGraph(host.geometry, seamDistance);
  if (!graph) return {
    routes: [],
    reached: new Set(),
    targetDistances: new Map(),
    targetGraphPoints: new Map(),
    targetAttachments: new Map(),
    targetRadiusScales: new Map(),
    targetTreeIds: new Map(),
  };

  const candidateTargets = [];
  const requiredComponents = new Set();
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const node = targetSurfaceNode(
      graph,
      host.bvh,
      target.point,
      targetAttachDistance,
    );
    if (node < 0) continue;
    candidateTargets.push({ target, node });
    requiredComponents.add(graph.componentByNode[node]);
  }
  if (!candidateTargets.length) {
    return {
      routes: [],
      reached: new Set(),
      targetDistances: new Map(),
      targetGraphPoints: new Map(),
      targetAttachments: new Map(),
      targetRadiusScales: new Map(),
      targetTreeIds: new Map(),
    };
  }

  const sources = [];
  for (const componentId of requiredComponents) {
    const component = graph.components[componentId];
    const groundNodes = component.nodes.filter((node) => {
      const y = graph.nodes[node].y;
      return y >= groundY - 0.1 && y <= groundY + groundBand;
    });
    if (groundNodes.length) {
      sources.push(...groundNodes);
      continue;
    }

    // A floating/disconnected exported part gets a local vertical ground path from
    // the ground below its closest vertex. This never bridges horizontally to
    // another body part and works for arbitrary static props without bones.
    let closestNode = component.nodes[0];
    let closestDistance = Math.abs(graph.nodes[closestNode].y - groundY);
    for (let i = 1; i < component.nodes.length; i += 1) {
      const node = component.nodes[i];
      const distance = Math.abs(graph.nodes[node].y - groundY);
      if (distance < closestDistance) {
        closestNode = node;
        closestDistance = distance;
      }
    }
    sources.push(closestNode);
  }

  const tree = shortestSurfaceTree(graph, sources);
  const reached = new Set();
  const targetDistances = new Map();
  const targetNodes = new Map();
  const targetsByNode = new Map();
  const activeNodes = new Set();
  const activeChildren = new Map();

  for (let i = 0; i < candidateTargets.length; i += 1) {
    const { target, node } = candidateTargets[i];
    if (!Number.isFinite(tree.distance[node])) continue;
    reached.add(target.id);
    targetNodes.set(target.id, node);
    const existing = targetsByNode.get(node);
    if (existing) existing.push(target);
    else targetsByNode.set(node, [target]);

    let current = node;
    activeNodes.add(current);
    while (tree.previous[current] >= 0) {
      const parent = tree.previous[current];
      activeNodes.add(parent);
      let children = activeChildren.get(parent);
      if (!children) {
        children = new Set();
        activeChildren.set(parent, children);
      }
      children.add(current);
      current = parent;
    }
  }

  const roots = [];
  for (const node of activeNodes) {
    const parent = tree.previous[node];
    if (parent < 0 || !activeNodes.has(parent)) roots.push(node);
  }
  const stopNodes = new Set(roots);
  for (const node of activeNodes) {
    const childCount = activeChildren.get(node)?.size ?? 0;
    if (childCount !== 1) stopNodes.add(node);
  }

  const downstreamLoadByNode = new Map();
  const downstreamLoad = (node) => {
    const cached = downstreamLoadByNode.get(node);
    if (cached != null) return cached;
    let load = targetsByNode.get(node)?.length ?? 0;
    const children = activeChildren.get(node);
    if (children) {
      for (const child of children) load += downstreamLoad(child);
    }
    load = Math.max(load, 1);
    downstreamLoadByNode.set(node, load);
    return load;
  };
  for (let i = 0; i < roots.length; i += 1) downstreamLoad(roots[i]);

  const rootByNode = new Map();
  const activeRoot = (node) => {
    const cached = rootByNode.get(node);
    if (cached != null) return cached;
    const lineage = [];
    let current = node;
    while (tree.previous[current] >= 0 && activeNodes.has(tree.previous[current])) {
      lineage.push(current);
      current = tree.previous[current];
    }
    for (let i = 0; i < lineage.length; i += 1) rootByNode.set(lineage[i], current);
    rootByNode.set(current, current);
    return current;
  };
  const rootEntryDistance = new Map();
  for (let i = 0; i < roots.length; i += 1) {
    const root = roots[i];
    const surfacePoint = offsetNode(graph, root, surfaceOffset);
    rootEntryDistance.set(root, Math.abs(surfacePoint.y - groundY));
  }
  const absoluteTreeDistance = (node) => (
    (rootEntryDistance.get(activeRoot(node)) ?? 0) + tree.distance[node]
  );
  const treeIdForNode = (node) => `${host.id}:root:${activeRoot(node)}`;
  const targetTreeIds = new Map();
  const targetGraphPoints = new Map();

  for (const [targetId, node] of targetNodes) {
    const distance = absoluteTreeDistance(node);
    targetDistances.set(targetId, distance);
    targetTreeIds.set(targetId, treeIdForNode(node));
    targetGraphPoints.set(targetId, offsetNode(graph, node, surfaceOffset));
  }

  const routes = [];
  let routeIndex = 0;
  const pushRoute = (
    points,
    startDistance,
    endDistance,
    kind,
    startNode,
    endNode,
  ) => {
    const curve = roundedSurfacePolylineCurve(points);
    if (!curve) return;
    const startLoad = downstreamLoadByNode.get(startNode) ?? 1;
    const endLoad = downstreamLoadByNode.get(endNode) ?? startLoad;
    routes.push({
      curve,
      points,
      startDistance,
      endDistance,
      startNode,
      endNode,
      kind,
      treeId: treeIdForNode(endNode),
      routeIndex: routeIndex++,
      startLoad,
      endLoad,
      radiusStartScale: radiusScaleForLoad(startLoad),
      radiusEndScale: radiusScaleForLoad(endLoad),
    });
  };

  for (let i = 0; i < roots.length; i += 1) {
    const node = roots[i];
    const surfacePoint = offsetNode(graph, node, surfaceOffset);
    const groundPoint = surfacePoint.clone();
    groundPoint.y = groundY;
    const middle = groundPoint.clone().lerp(surfacePoint, 0.5);
    pushRoute(
      [groundPoint, middle, surfacePoint],
      0,
      rootEntryDistance.get(node) ?? 0,
      'ground-entry',
      node,
      node,
    );
  }

  for (const start of stopNodes) {
    const children = activeChildren.get(start);
    if (!children) continue;
    for (const firstChild of children) {
      const chain = [start];
      let current = firstChild;
      while (true) {
        chain.push(current);
        if (stopNodes.has(current)) break;
        const nextChildren = activeChildren.get(current);
        if (!nextChildren?.size) break;
        current = nextChildren.values().next().value;
      }
      const points = chain.map((node) => offsetNode(graph, node, surfaceOffset));
      const overlap = junctionOverlapPoint({
        graph,
        tree,
        node: start,
        surfaceOffset,
        groundY,
      });
      if (overlap.distanceToSquared(points[0]) > 1e-12) points.unshift(overlap);
      pushRoute(
        points,
        absoluteTreeDistance(start),
        absoluteTreeDistance(chain[chain.length - 1]),
        'surface-trunk',
        chain[0],
        chain[chain.length - 1],
      );
    }
  }

  const targetAttachments = new Map();
  const targetRadiusScales = new Map();
  for (const [node, nodeTargets] of targetsByNode) {
    const start = offsetNode(graph, node, surfaceOffset);
    const overlap = junctionOverlapPoint({
      graph,
      tree,
      node,
      surfaceOffset,
      groundY,
    });
    const radiusScale = radiusScaleForLoad(downstreamLoadByNode.get(node) ?? 1);
    for (let i = 0; i < nodeTargets.length; i += 1) {
      const target = nodeTargets[i];
      const points = projectedAttachmentPoints(
        host.bvh,
        start,
        target.point,
        surfaceOffset,
      );
      if (points) {
        if (overlap.distanceToSquared(points[0]) > 1e-12) points.unshift(overlap.clone());
        targetAttachments.set(target.id, points);
        targetRadiusScales.set(target.id, radiusScale);
      }
      else {
        reached.delete(target.id);
        targetDistances.delete(target.id);
        targetGraphPoints.delete(target.id);
        targetTreeIds.delete(target.id);
      }
    }
  }

  return {
    routes,
    reached,
    targetDistances,
    targetGraphPoints,
    targetAttachments,
    targetRadiusScales,
    targetTreeIds,
  };
}
