import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  cos,
  Fn,
  instanceIndex,
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
  // Closed petal taper: angle = X * petalWidthUniform, center Y = taperCenterYUniform.
  const petalWidthUniform = useMemo(() => uniform(0.5), []);
  const taperCenterYUniform = useMemo(() => uniform(0.325), []);
  // "Transfer Between Open and Close Petal":
  // Color Ramp Factor = per-petal instanceIndex normalized by petal count.
  // Color Ramp stop position (rampStop) and Add node value (addValue) are animated.
  // Per-petal blend = clamp(clamp(iNorm / rampStop, 0, 1) + addValue, 0, 1).
  const rampStopUniform = useMemo(() => uniform(0.038), []);
  const addValueUniform = useMemo(() => uniform(-0.969), []);
  const amountOfPetalsUniform = useMemo(() => uniform(12), []);
  // Open petal bend: own multiplier (0.295) and center Z (-9.86).
  const openBendUniform = useMemo(() => uniform(0.295), []);
  const openCenterZUniform = useMemo(() => uniform(-9.86), []);
  // Open petal taper: angle = X * openTaperWidth, center Y = openTaperCenterY.
  const openTaperWidthUniform = useMemo(() => uniform(1.29), []);
  const openTaperCenterYUniform = useMemo(() => uniform(-4.11), []);
  // Open petal curl: angle = Blender_X * curlK. Blender: Multiply value = -22.607.
  const openCurlKUniform = useMemo(() => uniform(-22.607), []);

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

    // Shared bend + Transform Geometry (scale + translate X). All in Blender coords.
    // k: bend multiplier (uniform); cz: center Z (uniform).
    // sx/sy/sz: TG scale constants; tx: TG translate X constant.
    // Returns { x, y, z, nx, ny, nz } in Blender coords — NOT yet coord-flipped.
    const buildBend = (bk, cz, sx, sy, sz, tx) => {
      const aB = yb.mul(bk);
      const cB = cos(aB);
      const sB = sin(aB);
      const dYb = yb;
      const dZb = zb.sub(cz);
      const b_x = xb.add(xb);
      const b_y = yb.add(dYb.mul(cB).sub(dZb.mul(sB)));
      const b_z = zb.add(cz).add(dYb.mul(sB).add(dZb.mul(cB)));
      const A = cB.add(1).sub(bk.mul(dYb.mul(sB).add(dZb.mul(cB))));
      const Dn = sB.mul(-1);
      const E = sB.add(bk.mul(dYb.mul(cB).sub(dZb.mul(sB))));
      const G = cB.add(1);
      const det = A.mul(G).sub(Dn.mul(E));
      const b_nx = nx0.mul(0.5);
      const b_ny = G.mul(ny0).sub(E.mul(nz0)).div(det);
      const b_nz = A.mul(nz0).sub(Dn.mul(ny0)).div(det);
      // TG: Scale(sx,sy,sz) then Translate(tx,0,0). Normal: S^-T·n = n/S.
      return {
        x: b_x.mul(sx).add(tx), y: b_y.mul(sy), z: b_z.mul(sz),
        nx: b_nx.div(sx),       ny: b_ny.div(sy), nz: b_nz.div(sz),
      };
    };

    // Shared taper (rotate about Z) + Transform Geometry. All in Blender coords.
    // b: result from buildBend. taperWidth/centerY: TSL nodes (uniforms).
    // tgSx/tgSy/tgSz: TG scale constants; tgRx: TG rotate X (JS radians); tgTx: TG translate X.
    const applyTaper = (b, taperWidth, centerY, tgSx, tgSy, tgSz, tgRx, tgTx) => {
      const aT = b.x.mul(taperWidth);
      const cT = cos(aT); const sT = sin(aT);
      const dXt = b.x; const dYt = b.y.sub(centerY);
      const t_x = b.x.add(dXt.mul(cT).sub(dYt.mul(sT)));
      const t_y = b.y.add(centerY).add(dXt.mul(sT).add(dYt.mul(cT)));
      const t_z = b.z.add(b.z);
      const t_nx = b.nx.mul(cT).sub(b.ny.mul(sT));
      const t_ny = b.nx.mul(sT).add(b.ny.mul(cT));
      const t_nz = b.nz;
      // TG: Scale(sx,sy,sz) → Rotate X(rx) → Translate(tx,0,0). Normal: S^-T then R_X.
      const cosRx = Math.cos(tgRx); const sinRx = Math.sin(tgRx);
      const f_x = t_x.mul(tgSx).add(tgTx);
      const f_y = t_y.mul(tgSy).mul(cosRx).sub(t_z.mul(tgSz).mul(sinRx));
      const f_z = t_y.mul(tgSy).mul(sinRx).add(t_z.mul(tgSz).mul(cosRx));
      const f_nx = t_nx.div(tgSx);
      const f_ny = t_ny.div(tgSy).mul(cosRx).sub(t_nz.div(tgSz).mul(sinRx));
      const f_nz = t_ny.div(tgSy).mul(sinRx).add(t_nz.div(tgSz).mul(cosRx));
      return {
        pos: vec3(f_x.mul(-1), f_y.mul(-1), f_z),
        nrm: vec3(f_nx.mul(-1), f_ny.mul(-1), f_nz),
      };
    };

    // Open petal Curl: Vector Rotate (Axis Angle) + TG. All in Blender coords.
    // Center=(0,-1.09,0.07), Axis=(0,1,0.09) normalized, Angle = b.x * curlK.
    // Set Position [Offset]: new_P = P + center + R(angle)*(P-center).
    // Normal: approximate as same Rodrigues rotation R applied to normal.
    // TG after: Translate(0,0,-0.13), Rotate X=-10.5°.
    const buildCurl = (b, curlK) => {
      const ctrY = -1.090, ctrZ = 0.070;
      const axLen = Math.sqrt(1 + 0.09 * 0.09);
      const aNy = 1 / axLen, aNz = 0.09 / axLen; // axis X = 0

      const alpha = b.x.mul(curlK);
      const cA = cos(alpha);
      const sA = sin(alpha);
      const omC = cA.mul(-1).add(1); // 1 - cos(alpha)

      // Q = P - center (center X=0 so Qx = b.x)
      const Qx = b.x;
      const Qy = b.y.sub(ctrY);
      const Qz = b.z.sub(ctrZ);

      // Rodrigues: n=(0, aNy, aNz), nx=0
      const nDotQ = Qy.mul(aNy).add(Qz.mul(aNz));
      const nCQx = Qz.mul(aNy).sub(Qy.mul(aNz)); // (n×Q)_x
      const nCQy = Qx.mul(aNz);                   // (n×Q)_y
      const nCQz = Qx.mul(aNy).mul(-1);            // (n×Q)_z

      const RQx = Qx.mul(cA).add(nCQx.mul(sA));
      const RQy = Qy.mul(cA).add(nCQy.mul(sA)).add(nDotQ.mul(omC).mul(aNy));
      const RQz = Qz.mul(cA).add(nCQz.mul(sA)).add(nDotQ.mul(omC).mul(aNz));

      // Set Position: P' = P + center + R*Q
      const curl_x = b.x.add(RQx);
      const curl_y = b.y.add(ctrY).add(RQy);
      const curl_z = b.z.add(ctrZ).add(RQz);

      // Normal: same Rodrigues rotation
      const nDotN = b.ny.mul(aNy).add(b.nz.mul(aNz));
      const nCNx = b.nz.mul(aNy).sub(b.ny.mul(aNz));
      const nCNy = b.nx.mul(aNz);
      const nCNz = b.nx.mul(aNy).mul(-1);

      const RNx = b.nx.mul(cA).add(nCNx.mul(sA));
      const RNy = b.ny.mul(cA).add(nCNy.mul(sA)).add(nDotN.mul(omC).mul(aNy));
      const RNz = b.nz.mul(cA).add(nCNz.mul(sA)).add(nDotN.mul(omC).mul(aNz));

      // TG: Translate(0,0,-0.13), Rotate X=-10.5° (Blender X axis)
      const cosTg = Math.cos(-10.5 * Math.PI / 180);
      const sinTg = Math.sin(-10.5 * Math.PI / 180);
      return {
        x: curl_x,
        y: curl_y.mul(cosTg).sub(curl_z.mul(sinTg)),
        z: curl_y.mul(sinTg).add(curl_z.mul(cosTg)).sub(0.13),
        nx: RNx,
        ny: RNy.mul(cosTg).sub(RNz.mul(sinTg)),
        nz: RNy.mul(sinTg).add(RNz.mul(cosTg)),
      };
    };

    // CLOSED: bend(k, cz=1, scale=0.2/0.2/0.16) + taper(w, ty, TG scale=-0.46/0.5/0.5)
    const buildClosed = () => {
      const b = buildBend(k, bendCenterZUniform, 0.2, 0.2, 0.16, 0);
      return applyTaper(b, w, ty, 0.46, 0.5, 0.5, 0, 0);
    };

    // OPEN: bend → curl → taper
    const buildOpen = () => {
      const b = buildBend(openBendUniform, openCenterZUniform, 0.54, 0.21, 0.28, 0);
      const bc = buildCurl(b, openCurlKUniform);
      return applyTaper(bc, openTaperWidthUniform, openTaperCenterYUniform, 0.5, 0.5, 0.5, 21.4 * Math.PI / 180, 0);
    };

    const closed = buildClosed();
    const open = buildOpen();
    // Per-petal blend: Color Ramp(iNorm, rampStop) + addValue, clamped [0,1].
    const countMinus1 = amountOfPetalsUniform.toFloat().sub(1).max(1);
    const iNorm = instanceIndex.toFloat().div(countMinus1).clamp(0, 1);
    const rampOut = iNorm.div(rampStopUniform.max(0.001)).clamp(0, 1);
    const blend = rampOut.add(addValueUniform).clamp(0, 1);
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
  }, [bendUniform, bendCenterZUniform, petalWidthUniform, taperCenterYUniform, rampStopUniform, addValueUniform, amountOfPetalsUniform, openBendUniform, openCenterZUniform, openCurlKUniform, openTaperWidthUniform, openTaperCenterYUniform]);

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
    rampStopUniform.value = controls.rampStop;
  }, [rampStopUniform, controls.rampStop]);

  useEffect(() => {
    addValueUniform.value = controls.addValue;
  }, [addValueUniform, controls.addValue]);

  useEffect(() => {
    amountOfPetalsUniform.value = controls.amountOfPetals;
  }, [amountOfPetalsUniform, controls.amountOfPetals]);

  useEffect(() => {
    openBendUniform.value = controls.openPetalBend;
  }, [openBendUniform, controls.openPetalBend]);

  useEffect(() => {
    openCenterZUniform.value = controls.openBendCenterZ;
  }, [openCenterZUniform, controls.openBendCenterZ]);

  useEffect(() => {
    openCurlKUniform.value = controls.openCurlK;
  }, [openCurlKUniform, controls.openCurlK]);

  useEffect(() => {
    openTaperWidthUniform.value = controls.openTaperWidth;
  }, [openTaperWidthUniform, controls.openTaperWidth]);

  useEffect(() => {
    openTaperCenterYUniform.value = controls.openTaperCenterY;
  }, [openTaperCenterYUniform, controls.openTaperCenterY]);

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
