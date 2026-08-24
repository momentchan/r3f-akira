import { useEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';
import { sampleAnchorField } from './fieldAnchors';

/** Skip cells below this so the overlay does not paint bare ground. */
const EMPTY_CELL = 0.06;

function CircleRing({
  radius,
  y = 0.02,
  color = '#ff4d6d',
  opacity = 0.85,
  segments = 64,
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * radius;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(a) * radius;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [radius, segments]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (radius <= 0) return null;

  // `line`, not `lineLoop`: the WebGPU renderer rejects THREE.LineLoop outright
  // ("Objects of type THREE.LineLoop are not supported"), so every ring in this
  // overlay silently drew nothing and spammed one error per ring per frame. The
  // geometry already repeats its first point at i === segments, so a plain line
  // strip closes the circle identically.
  return (
    <line geometry={geometry} position={[0, y, 0]} frustumCulled={false}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
      />
    </line>
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
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const inst = new THREE.InstancedMesh(geo, mat, cells.length);
    inst.frustumCulled = false;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      m.makeScale(1, 1, 1);
      m.setPosition(cell.x, 0.008 + cell.v * 0.004, cell.z);
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
 * Anchor itself: the cause. Outer reach and inner keep-out.
 *
 * There is no separate field-centre marker any more. The static `centre drift`
 * that offset a mass from its anchor is gone, so the mass wanders around this
 * point under migration alone — the ring IS the cause and the centre.
 */
function AnchorMarker({ anchor }) {
  const { x, z, radius, inner, color, weight } = anchor;
  return (
    <group position={[x, 0, z]}>
      <CircleRing radius={radius} y={0.03} color={color} opacity={0.9} />
      <CircleRing radius={inner} y={0.028} color={color} opacity={0.4} />
      <CircleRing
        radius={Math.max(0.02, weight * 0.06)}
        y={0.034}
        color={color}
        opacity={0.6}
      />
      <mesh position={[0, 0.06, 0]} frustumCulled={false}>
        <sphereGeometry args={[0.03, 10, 10]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * Composition overlay. Two independently toggled layers:
 *
 * `showAnchors`        — each anchor: reach ring, inner keep-out, and a weight
 *                        dot. Under migration the mass wanders around this
 *                        centre, so the ring shows the cause and the bound,
 *                        not the current mass.
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
