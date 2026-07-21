import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  cos,
  Fn,
  mix,
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
  // Bend Vector Rotate "Center" Z, BLENDER local coords (Center X/Y = 0). z=1 is
  // the CLOSED petal (z=-9.86 is the open petal).
  const bendCenterZUniform = useMemo(() => uniform(1), []);
  // Bottom Taper: Vector Rotate about Z, angle = X * Petal Width, Center=(0,ty,0).
  const petalWidthUniform = useMemo(() => uniform(-10.49), []);
  const taperCenterYUniform = useMemo(() => uniform(0.18), []);
  // Open/close morph: blend (0=closed, 1=open).
  const openAmountUniform = useMemo(() => uniform(0), []);
  // Open petal bend: own multiplier (0.295) and center Z (-9.86).
  const openBendUniform = useMemo(() => uniform(0.295), []);
  const openCenterZUniform = useMemo(() => uniform(-9.86), []);

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
    const k = bendUniform;         // closed petal bend multiplier
    const w = petalWidthUniform;   // taper angle multiplier (Petal Width)
    const ty = taperCenterYUniform;// taper Center.Y (Center X/Z = 0)
    const x = positionGeometry.x;
    const y = positionGeometry.y;
    const z = positionGeometry.z;

    // LITERAL port of the Blender graph. Both the bend and the bottom taper are
    //   Set Position [Offset], Offset = VectorRotate(P, Center, axis, angle)
    //                                  = Center + R(angle)(P - Center)
    //   new = P + Offset
    // Worked in BLENDER local coords (our X = -Blender X, Y = -Blender Y, Z = Z),
    // so the Center/angle controls match the node numbers 1:1.
    const xb = x.mul(-1);
    const yb = y.mul(-1);
    const zb = z;
    const nx0 = normalGeometry.x.mul(-1);
    const ny0 = normalGeometry.y.mul(-1);
    const nz0 = normalGeometry.z;

    // Bend (about X, angle = Y*bend, Center=(0,0,cz)) + Bottom Taper (about Z,
    // angle = X*width, Center=(0,ty,0)). cz is the only closed/open difference.
    // Returns { pos, nrm } already back in our coords.
    const buildBendTaper = (cz) => {
      const aB = yb.mul(k);
      const cB = cos(aB);
      const sB = sin(aB);
      const dYb = yb;            // Center.Y = 0
      const dZb = zb.sub(cz);
      const bxb = xb.add(xb);    // offset.x = xb → new.x = 2*xb
      const byb = yb.add(dYb.mul(cB).sub(dZb.mul(sB)));
      const bzb = zb.add(cz).add(dYb.mul(sB).add(dZb.mul(cB)));
      // Bend normal via analytic Jacobian (J^-1)^T: x→nx/2, (y,z) via 2x2 inverse.
      const A = cB.add(1).sub(k.mul(dYb.mul(sB).add(dZb.mul(cB))));
      const Dn = sB.mul(-1);
      const E = sB.add(k.mul(dYb.mul(cB).sub(dZb.mul(sB))));
      const G = cB.add(1);
      const detB = A.mul(G).sub(Dn.mul(E));
      const bnx = nx0.mul(0.5);
      const bny = G.mul(ny0).sub(E.mul(nz0)).div(detB);
      const bnz = A.mul(nz0).sub(Dn.mul(ny0)).div(detB);

      // Taper about Z on the bent position. Normal is rotation-approximated (Rz).
      const aT = bxb.mul(w);
      const cT = cos(aT);
      const sT = sin(aT);
      const dXt = bxb;          // Center.X = 0
      const dYt = byb.sub(ty);
      const txb = bxb.add(dXt.mul(cT).sub(dYt.mul(sT)));
      const tyb = byb.add(ty).add(dXt.mul(sT).add(dYt.mul(cT)));
      const tzb = bzb.add(bzb); // offset.z = bzb → new.z = 2*bzb
      const tnx = bnx.mul(cT).sub(bny.mul(sT));
      const tny = bnx.mul(sT).add(bny.mul(cT));
      const tnz = bnz;

      return {
        pos: vec3(txb.mul(-1), tyb.mul(-1), tzb),
        nrm: vec3(tnx.mul(-1), tny.mul(-1), tnz),
      };
    };

    // Open petal: own bend multiplier (0.295) + Scale(0.54,0.21,0.28).
    // Curl + open-taper to be added later.
    const buildOpenBend = () => {
      const ko = openBendUniform;
      const cz = openCenterZUniform;
      const aB = yb.mul(ko);
      const cB = cos(aB);
      const sB = sin(aB);
      const dYb = yb;
      const dZb = zb.sub(cz);
      const b_x = xb.add(xb);
      const b_y = yb.add(dYb.mul(cB).sub(dZb.mul(sB)));
      const b_z = zb.add(cz).add(dYb.mul(sB).add(dZb.mul(cB)));
      const Ab = cB.add(1).sub(ko.mul(dYb.mul(sB).add(dZb.mul(cB))));
      const Dnb = sB.mul(-1);
      const Eb = sB.add(ko.mul(dYb.mul(cB).sub(dZb.mul(sB))));
      const Gb = cB.add(1);
      const detB = Ab.mul(Gb).sub(Dnb.mul(Eb));
      const b_nx = nx0.mul(0.5);
      const b_ny = Gb.mul(ny0).sub(Eb.mul(nz0)).div(detB);
      const b_nz = Ab.mul(nz0).sub(Dnb.mul(ny0)).div(detB);
      return {
        pos: vec3(b_x.mul(-2), b_y.mul(-0.4), b_z.mul(0.54)),
        nrm: vec3(b_nx.div(-2), b_ny.div(-0.4), b_nz.div(0.54)),
      };
    };

    const closed = buildBendTaper(bendCenterZUniform);
    const open = buildOpenBend();
    const blend = openAmountUniform;
    const bentPosition = mix(closed.pos, open.pos, blend);
    const bentNormalLocal = mix(closed.nrm, open.nrm, blend).normalize();

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
  }, [bendUniform, bendCenterZUniform, petalWidthUniform, taperCenterYUniform, openAmountUniform, openBendUniform, openCenterZUniform]);

  useEffect(() => {
    bendUniform.value = controls.petalBend;
  }, [bendUniform, controls.petalBend]);

  useEffect(() => {
    bendCenterZUniform.value = controls.petalBendCenterZ;
  }, [bendCenterZUniform, controls.petalBendCenterZ]);

  useEffect(() => {
    petalWidthUniform.value = controls.petalWidth;
  }, [petalWidthUniform, controls.petalWidth]);

  useEffect(() => {
    taperCenterYUniform.value = controls.taperCenterY;
  }, [taperCenterYUniform, controls.taperCenterY]);

  useEffect(() => {
    openAmountUniform.value = controls.openAmount;
  }, [openAmountUniform, controls.openAmount]);

  useEffect(() => {
    openBendUniform.value = controls.openPetalBend;
  }, [openBendUniform, controls.openPetalBend]);

  useEffect(() => {
    openCenterZUniform.value = controls.openBendCenterZ;
  }, [openCenterZUniform, controls.openBendCenterZ]);

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
