import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  cos,
  Fn,
  normalGeometry,
  normalLocal,
  positionGeometry,
  sin,
  uniform,
  vec3,
} from 'three/tsl';
import {
  buildSpawnCurve,
  createDahliaGeoControlsSchema,
  createInstanceScratch,
  PETAL_PATH,
  preparePetalGeometry,
  updateDahliaInstances,
} from './dahliaGeoDefaults';

const MAX_PETALS = 400;

function findFirstMesh(scene) {
  let found = null;
  scene.traverse((object) => {
    if (!found && object.isMesh) found = object;
  });
  return found;
}

export function DahliaGeoNodes({ position = [0, 0, 0], visible = true }) {
  const { scene } = useGLTF(PETAL_PATH);
  const meshRef = useRef(null);
  const scratch = useMemo(() => createInstanceScratch(), []);

  const controls = useControls('Dahlia (Geo Nodes)', createDahliaGeoControlsSchema());

  const sourceMesh = useMemo(() => findFirstMesh(scene), [scene]);
  // Straight petal geometry — the bend runs in the vertex shader (animatable).
  const geometry = useMemo(
    () => (sourceMesh ? preparePetalGeometry(sourceMesh) : null),
    [sourceMesh],
  );

  // Live bend uniform (drive from a control now, animate it later).
  const bendUniform = useMemo(() => uniform(0), []);
  // Blender's Vector Rotate "Center" Z, in BLENDER local coords (Center X/Y = 0),
  // so the control matches the node's number 1:1.
  const bendCenterZUniform = useMemo(() => uniform(-9.86), []);

  // Clay-grey node material. The BEND runs in the vertex shader: rotate each
  // vertex (and its normal) about X by angle = positionGeometry.y * bend.
  // positionGeometry is the RAW attribute (pre-instance) so the bend is in
  // petal-local space and matches the CPU-baked result.
  const material = useMemo(() => {
    const m = new THREE.MeshStandardNodeMaterial({
      color: '#cfcfcf',
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const k = bendUniform;      // bend multiplier (Blender's Math node constant)
    const cz = bendCenterZUniform; // Blender Center.Z (Center X/Y = 0)
    const x = positionGeometry.x;
    const y = positionGeometry.y;
    const z = positionGeometry.z;

    // LITERAL port of the Blender bend: Set Position [Offset], where
    //   Offset = VectorRotate(Position, Center, axis=X, angle = Y * bend)
    //          = Center + Rx(angle)(Position - Center)   (Blender's node adds Center back)
    //   new_position = Position + Offset
    // Done in BLENDER local coords (our X = -Blender X, our Y = -Blender Y,
    // our Z = Blender Z), so cz is Blender's Center.Z directly (Center X/Y = 0).
    const xb = x.mul(-1);
    const yb = y.mul(-1);
    const zb = z;
    const nxB = normalGeometry.x.mul(-1);
    const nyB = normalGeometry.y.mul(-1);
    const nzB = normalGeometry.z;

    const angle = yb.mul(k);
    const c = cos(angle);
    const s = sin(angle);
    const dY = yb;             // Center.Y = 0
    const dZ = zb.sub(cz);
    // Offset = Center + Rx(angle)(P - Center); new = P + Offset.
    // X: rotation about X leaves x, Center.x = 0 → offset.x = xb → new.x = 2*xb.
    const nxb = xb.add(xb);
    const nyb = yb.add(dY.mul(c).sub(dZ.mul(s)));
    const nzb = zb.add(cz).add(dY.mul(s).add(dZ.mul(c)));
    // Back to our coords (undo the sign flips).
    const bentPosition = vec3(nxb.mul(-1), nyb.mul(-1), nzb);

    // Normal via the analytic Jacobian of the above map (Blender coords):
    //   dnx/dx = 2
    //   A = dny/dy = 1 + c - k(dY*s + dZ*c),  Dn = dny/dz = -s
    //   E = dnz/dy = s + k(dY*c - dZ*s),      G = dnz/dz = 1 + c
    // normal' = (J^-1)^T n: x -> nx/2, (y,z) -> (1/detM)[[G,-E],[-Dn,A]]·(ny,nz).
    const A = c.add(1).sub(k.mul(dY.mul(s).add(dZ.mul(c))));
    const Dn = s.mul(-1);
    const E = s.add(k.mul(dY.mul(c).sub(dZ.mul(s))));
    const G = c.add(1);
    const detM = A.mul(G).sub(Dn.mul(E));
    const NxB = nxB.mul(0.5);
    const NyB = G.mul(nyB).sub(E.mul(nzB)).div(detM);
    const NzB = A.mul(nzB).sub(Dn.mul(nyB)).div(detM);
    const bentNormalLocal = vec3(NxB.mul(-1), NyB.mul(-1), NzB);

    // Write the bent position AND normal in local (pre-instance) space, then let
    // three's InstanceNode apply the per-instance rotation to BOTH and the model
    // normal matrix to the normal. Overriding normalNode directly would use only
    // the mesh's world matrix and SKIP each petal's instance spin/tilt — the
    // cause of the wrong per-petal shading.
    const positionNode = Fn(() => {
      normalLocal.assign(bentNormalLocal);
      return bentPosition;
    })();
    m.positionNode = positionNode;
    m.castShadowPositionNode = bentPosition;
    return m;
  }, [bendUniform, bendCenterZUniform]);

  useEffect(() => {
    bendUniform.value = controls.petalBend;
  }, [bendUniform, controls.petalBend]);

  useEffect(() => {
    bendCenterZUniform.value = controls.petalBendCenterZ;
  }, [bendCenterZUniform, controls.petalBendCenterZ]);

  // Debug overlay: the NURBS spawn curve (red line) + the sampled spawn points (blue dots).
  const debug = useMemo(() => {
    const curve = buildSpawnCurve(controls);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(200)),
      new THREE.LineBasicMaterial({ color: '#ff2266', depthTest: false, depthWrite: false }),
    );
    line.frustumCulled = false;
    line.renderOrder = 999;

    const count = Math.max(1, Math.floor(controls.amountOfPetals));
    const coords = [];
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      curve.getPointAt(count > 1 ? i / (count - 1) : 0, p);
      coords.push(p.x, p.y, p.z);
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    const points = new THREE.Points(
      pointsGeo,
      new THREE.PointsMaterial({ color: '#1e90ff', size: 0.04, depthTest: false, depthWrite: false }),
    );
    points.frustumCulled = false;
    points.renderOrder = 1000;

    return { line, points };
  }, [controls]);

  useEffect(() => () => { geometry?.dispose(); }, [geometry]);
  useEffect(() => () => { material.dispose(); }, [material]);
  useEffect(() => () => {
    debug.line.geometry.dispose();
    debug.line.material.dispose();
    debug.points.geometry.dispose();
    debug.points.material.dispose();
  }, [debug]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !geometry) return;
    updateDahliaInstances(mesh, controls, scratch);
  }, [geometry, controls, scratch]);

  if (!geometry) return null;

  return (
    <group position={position} visible={visible} dispose={null}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, MAX_PETALS]}
        frustumCulled={false}
        castShadow
        receiveShadow
      />
      {controls.showCurve && (
        <>
          <primitive object={debug.line} />
          <primitive object={debug.points} />
        </>
      )}
    </group>
  );
}

useGLTF.preload(PETAL_PATH);
