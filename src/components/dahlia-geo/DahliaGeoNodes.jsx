import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
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
  const geometry = useMemo(
    () => (sourceMesh ? preparePetalGeometry(sourceMesh) : null),
    [sourceMesh],
  );

  // Plain clay-grey material for this step (matches the reference render).
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#cfcfcf', roughness: 0.85, side: THREE.DoubleSide }),
    [],
  );

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
