import { useEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';
import { sampleAnchorField } from './fieldAnchors';

/** Skip cells below this so the overlay does not paint bare ground. */
const EMPTY_CELL = 0.06;
/** World-space stroke of every pin rim, so elong / reach do not thicken it. */
const RIM_WIDTH = 0.018;
const RIM_SEGMENTS = 64;

function ellipseXZ(t, radius, elong, ax, az) {
  const along = Math.cos(t) * radius * elong;
  const across = Math.sin(t) * radius;
  return {
    x: along * ax - across * az,
    z: along * az + across * ax,
  };
}

/**
 * Closed XZ strip of constant world width. Scaling a RingGeometry would stretch
 * the stroke with `elong` and `reach`, so bigger pins looked like thicker rims.
 */
function createEllipseRimGeometry(radius, elong, axis, width = RIM_WIDTH, segments = RIM_SEGMENTS) {
  const ax = axis.ax ?? 1;
  const az = axis.az ?? 0;
  const e = Math.max(elong, 1e-3);
  const half = width * 0.5;
  const pts = [];
  for (let i = 0; i < segments; i += 1) {
    pts.push(ellipseXZ((i / segments) * Math.PI * 2, radius, e, ax, az));
  }
  const positions = new Float32Array(segments * 2 * 3);
  const indices = [];
  for (let i = 0; i < segments; i += 1) {
    const prev = pts[(i + segments - 1) % segments];
    const next = pts[(i + 1) % segments];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = (-tz / len) * half;
    const nz = (tx / len) * half;
    const p = pts[i];
    positions[i * 6] = p.x + nx;
    positions[i * 6 + 1] = 0;
    positions[i * 6 + 2] = p.z + nz;
    positions[i * 6 + 3] = p.x - nx;
    positions[i * 6 + 4] = 0;
    positions[i * 6 + 5] = p.z - nz;
    const a = i * 2;
    const b = i * 2 + 1;
    const c = ((i + 1) % segments) * 2;
    const d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

function EllipseRing({
  radius,
  elong = 1,
  axis = { ax: 1, az: 0 },
  y = 0.02,
  color,
  opacity,
}) {
  const ax = axis.ax ?? 1;
  const az = axis.az ?? 0;
  const geometry = useMemo(
    () => (radius > 0 ? createEllipseRimGeometry(radius, elong, { ax, az }) : null),
    [radius, elong, ax, az],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={[0, y, 0]} frustumCulled={false}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Half-side of the debug sampling square, from the body centre.
 *
 * Spawn lives on the anchors. Each mass is an elongated disc of
 * radius `reach * reachScale`, plus domain-warp padding, so the window has to
 * cover those discs or a high reach scale silently clips off the overlay while
 * flowers still plant outside it.
 */
function fieldGridExtent(anchors, center, shapeWarp = 0) {
  const pad = Math.max(0, shapeWarp);
  const [cx, cz] = center;
  let half = 1;
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i];
    const rAlong = (a.radius + pad) * Math.max(a.elong ?? 1, 1e-3);
    const rAcross = a.radius + pad;
    const ax = a.axis?.ax ?? 1;
    const az = a.axis?.az ?? 0;
    for (const s1 of [-1, 1]) {
      for (const s2 of [-1, 1]) {
        const px = a.x + s1 * rAlong * ax + s2 * rAcross * -az;
        const pz = a.z + s1 * rAlong * az + s2 * rAcross * ax;
        half = Math.max(half, Math.abs(px - cx), Math.abs(pz - cz));
      }
    }
  }
  return half * 1.05;
}

/**
 * The anchor probability field, as a coarse grid of shaded discs.
 *
 * Rings alone are not enough to review this. Cluster centres drift off their
 * anchors on purpose, so when a cluster lands badly the ring tells you nothing
 * about whether the field or the sampler is at fault. This draws what the
 * sampler will actually see.
 *
 * Painted on the grow plane, not as a HUD: the field is ground probability,
 * so the body occludes it and flowers read as growing out of it.
 * One InstancedMesh, built once per anchor/knob change — never per frame.
 * Empty cells are skipped so bare ground stays visible.
 */
function AnchorFieldGrid({
  anchors,
  center,
  extent,
  resolution,
  fieldOptions,
}) {
  const mesh = useMemo(() => {
    if (!anchors?.length) return null;
    const step = (extent * 2) / resolution;
    const cells = [];
    for (let ix = 0; ix < resolution; ix += 1) {
      for (let iz = 0; iz < resolution; iz += 1) {
        const x = center[0] - extent + (ix + 0.5) * step;
        const z = center[1] - extent + (iz + 0.5) * step;
        const v = sampleAnchorField(x, z, anchors, fieldOptions);
        if (v > EMPTY_CELL) cells.push({ x, z, v });
      }
    }
    if (!cells.length) return null;

    const cellSize = step * 0.86;
    const geo = new THREE.PlaneGeometry(cellSize, cellSize);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.7,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    });
    const inst = new THREE.InstancedMesh(geo, mat, cells.length);
    inst.frustumCulled = false;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      m.makeScale(1, 1, 1);
      m.setPosition(cell.x, 0.004, cell.z);
      inst.setMatrixAt(i, m);
      // Cool = sparse, warm = dense. Reads as a heat map at a glance.
      color.setHSL(0.58 - 0.58 * cell.v, 0.75, 0.28 + 0.34 * cell.v);
      inst.setColorAt(i, color);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    return inst;
  }, [anchors, center, extent, resolution, fieldOptions]);

  useEffect(() => () => {
    if (!mesh) return;
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
  }, [mesh]);

  return mesh ? <primitive object={mesh} /> : null;
}

/**
 * Pin reach in the elongated field frame. Hearts hop around this centre;
 * the ring is the bound, not the current clump location.
 */
function AnchorMarker({ anchor }) {
  const { x, z, radius, inner, color, elong, axis } = anchor;
  return (
    <group position={[x, 0, z]}>
      <EllipseRing
        radius={radius}
        elong={elong}
        axis={axis}
        y={0.03}
        color={color}
        opacity={0.9}
      />
      {inner > 1e-3 ? (
        <EllipseRing
          radius={inner}
          elong={elong}
          axis={axis}
          y={0.028}
          color={color}
          opacity={0.4}
        />
      ) : null}
    </group>
  );
}

/**
 * Composition overlay. Two independently toggled layers:
 *
 * `showAnchors`        — each pin: elongated reach ring (same frame as the
 *                        field). Under migration the mass wanders around this
 *                        centre, so the ring shows the cause and the bound,
 *                        not the current mass. The centre is not dotted — that
 *                        mark is reserved for hearts.
 * `densityField`       — a heat grid sampled through the same `sampleAnchorField`
 *                        the sampler uses, so it shows what the sampler sees.
 */
export function CompositionDebug({
  visible = false,
  center = [0, 0],
  anchors = null,
  showAnchors = false,
  densityField = false,
  fieldOptions = null,
  gridResolution = 56,
}) {
  if (!visible) return null;

  return (
    <group>
      {densityField && anchors?.length ? (
        <AnchorFieldGrid
          anchors={anchors}
          center={center}
          extent={fieldGridExtent(anchors, center, fieldOptions?.shapeWarp ?? 0)}
          resolution={gridResolution}
          fieldOptions={fieldOptions ?? {}}
        />
      ) : null}
      {showAnchors && anchors?.length ? (
        <group>
          {anchors.map((anchor) => (
            <AnchorMarker key={anchor.id} anchor={anchor} />
          ))}
        </group>
      ) : null}
    </group>
  );
}
