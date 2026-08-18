import { useEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';
import { sampleAnchorField } from './fieldAnchors';

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

function DiscFill({
  radius,
  y = 0.015,
  color = '#ff4d6d',
  opacity = 0.12,
}) {
  if (radius <= 0) return null;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y, 0]}
      frustumCulled={false}
    >
      <circleGeometry args={[radius, 48]} />
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
 * The anchor probability field, as a coarse grid of shaded discs.
 *
 * Rings alone are not enough to review this. Cluster centres drift off their
 * anchors on purpose, so when a cluster lands badly the ring tells you nothing
 * about whether the field or the sampler is at fault. This draws what the
 * sampler will actually see.
 *
 * One InstancedMesh, built once per anchor/knob change — never per frame.
 *
 * `flat` is what makes the Mass Shape knobs reviewable. As a heat map, a warped
 * mass and a merely noisy one look alike: brightness variation reads as shape
 * variation. Drawn as a solid mask at one threshold, the outline is the only thing
 * on screen, and the three shape knobs separate cleanly —
 *
 *   `shape warp`   deforms the outline itself (the mass stops being an ellipse)
 *   `edge ragged`  roughens that outline but leaves its gross form alone
 *   `bare patches` punches holes through the interior
 *
 * Sweeping `threshold` in flat mode walks the iso-contours, which is how you see
 * how steeply a mass falls off rather than just where it ends.
 */
function AnchorFieldGrid({
  anchors,
  center,
  extent,
  resolution,
  fieldOptions,
  threshold = 0.06,
  flat = false,
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
        // Skipping empty cells is the point of the view: what is NOT drawn is
        // the bare ground the composition depends on.
        if (v > threshold) cells.push({ x, z, v });
      }
    }
    if (!cells.length) return null;

    // Flat cells tile edge to edge so the mask reads as one silhouette; heat-map
    // cells keep a gap so individual sample values stay separable.
    const cellSize = step * (flat ? 1 : 0.86);
    const geo = new THREE.PlaneGeometry(cellSize, cellSize);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: flat ? 0.8 : 0.55,
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
      // Flat mode holds every cell at one height: a value-driven height offset is
      // itself an intensity cue, which is what this mode exists to suppress.
      m.setPosition(cell.x, flat ? 0.01 : 0.008 + cell.v * 0.004, cell.z);
      inst.setMatrixAt(i, m);
      if (flat) {
        color.setRGB(0.16, 0.62, 0.55);
      } else {
        // Cool = sparse, warm = dense. Reads as a heat map at a glance.
        color.setHSL(0.58 - 0.58 * cell.v, 0.75, 0.28 + 0.34 * cell.v);
      }
      inst.setColorAt(i, color);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    return inst;
  }, [anchors, center, extent, resolution, fieldOptions, threshold, flat]);

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
 * Composition overlay. Three independently toggled layers:
 *
 * `showAnchors`   — each anchor: reach ring, inner keep-out, and a weight dot.
 *                   Under migration the mass wanders around this centre, so the
 *                   ring shows the cause and the bound, not the current mass.
 * `showAnchorField` — a heat grid sampled through the same `sampleAnchorField`
 *                   the sampler uses, so it shows what the sampler sees.
 * `showGuides`    — magenta disc = the hard face pocket; orange/teal rings =
 *                   the near/far band that normalises `rimT`; and three discs
 *                   on +X that are a ROLE size legend (echo / secondary /
 *                   primary), passed in via `sizeLegend` rather than derived.
 */
export function CompositionDebug({
  visible = false,
  center = [0, 0],
  headLocal = null,
  faceClearRadius = 0,
  nearR = 0,
  farR = 0,
  nearSizeMin = 0.5,
  clearMargin = 0.12,
  // { echo, secondary, primary } relative sizes, computed by the caller.
  sizeLegend = null,
  // Anchor layer. The rings describe the radial band that still normalises rimT;
  // the anchor + field layers describe what actually drives the layout now.
  anchors = null,
  showGuides = true,
  showAnchors = false,
  showAnchorField = false,
  fieldOptions = null,
  fieldResolution = 56,
  fieldThreshold = 0.06,
  fieldFlat = false,
}) {
  if (!visible) return null;

  const [cx, cz] = center;
  const headX = headLocal?.x ?? cx;
  const headZ = headLocal?.z ?? cz;
  const headFound = Boolean(headLocal?.found ?? headLocal);

  const midT = 0.5;
  const midR = nearR + (farR - nearR) * midT;
  // Size is no longer a function of radius alone — depth decay and the primary
  // boost dominate it — so these read as a ROLE legend rather than a radial ramp.
  const legend = sizeLegend ?? { echo: nearSizeMin, secondary: 1, primary: 1 };
  const nearBloomR = 0.08 * legend.echo;
  const midBloomR = 0.08 * legend.secondary;
  const farBloomR = 0.08 * legend.primary;

  return (
    <group>
      {showAnchorField && anchors?.length ? (
        <AnchorFieldGrid
          anchors={anchors}
          center={center}
          extent={Math.max(farR, 1) * 1.05}
          resolution={fieldResolution}
          fieldOptions={fieldOptions ?? {}}
          threshold={fieldThreshold}
          flat={fieldFlat}
        />
      ) : null}
      {showAnchors && anchors?.length ? (
        <group>
          {anchors.map((anchor) => (
            <AnchorMarker key={anchor.id} anchor={anchor} />
          ))}
        </group>
      ) : null}

      {/* The face pocket is drawn with the anchors too: it is the hard floor the
          helmet negative anchor layers on top of, so the two only make sense
          together. */}
      {(showGuides || showAnchors) && (
        <group position={[headX, 0, headZ]}>
          <DiscFill radius={faceClearRadius} color="#ff4d6d" opacity={0.16} />
          <CircleRing radius={faceClearRadius} color="#ff4d6d" y={0.03} />
          <mesh position={[0, 0.06, 0]} frustumCulled={false}>
            <sphereGeometry args={[0.035, 12, 12]} />
            <meshBasicMaterial
              color={headFound ? '#ff4d6d' : '#888888'}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {showGuides && (
      <group position={[cx, 0, cz]}>
        <CircleRing radius={nearR} color="#ff9f1c" y={0.025} opacity={0.9} />
        <CircleRing radius={farR} color="#2ec4b6" y={0.025} opacity={0.75} />
        <CircleRing
          radius={Math.max(nearR * 0.55, clearMargin)}
          color="#ffffff"
          y={0.02}
          opacity={0.35}
        />

        <group position={[nearR, 0, 0]}>
          <DiscFill radius={nearBloomR} y={0.04} color="#ff9f1c" opacity={0.35} />
          <CircleRing radius={nearBloomR} y={0.045} color="#ff9f1c" />
        </group>
        <group position={[midR, 0, 0]}>
          <DiscFill radius={midBloomR} y={0.04} color="#ffd166" opacity={0.3} />
          <CircleRing radius={midBloomR} y={0.045} color="#ffd166" />
        </group>
        <group position={[farR, 0, 0]}>
          <DiscFill radius={farBloomR} y={0.04} color="#2ec4b6" opacity={0.3} />
          <CircleRing radius={farBloomR} y={0.045} color="#2ec4b6" />
        </group>
      </group>
      )}
    </group>
  );
}
