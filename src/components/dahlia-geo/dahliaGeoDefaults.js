import * as THREE from 'three/webgpu';
import { NURBSCurve } from 'three/examples/jsm/curves/NURBSCurve.js';

export const PETAL_PATH = '/models/petal.glb';

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// STEP 1 — minimal spawn only:
// Spawn N straight petals along a flat NURBS spiral curve (the "Point/Petal
// Spawn" of the Blender graph). No petal bend/roll, no open/close morph.
export function createDahliaGeoControlsSchema() {
  return {
    amountOfPetals: { value: 1, min: 1, max: 400, step: 1, label: 'Amount of Petals' },
    curveLength: { value: 0.4, min: 0.02, max: 3, step: 0.01, label: 'curve length' },
    petalScale: { value: 0.3, min: 0.02, max: 2, step: 0.01, label: 'petal scale' },
    // Bend multiplier (Blender's Math node constant feeding the Vector Rotate
    // angle = Y * bend). Export ≈ 0.295; tune to match your Blender file.
    petalBend: { value: 0.295, min: -4, max: 4, step: 0.001, label: 'Petal Bend' },
    // Blender's Vector Rotate "Center" Z in BLENDER local coords (Center X/Y = 0).
    petalBendCenterZ: { value: 1, min: -15, max: 15, step: 0.01, label: 'Petal Bend Center Z (Blender)' },
    // Per-petal rotation (Blender's Combine XYZ -> Rotate Euler), remapped to
    // Three.js Y-up: Y is the up axis (Blender's Z) and carries the ×index golden
    // spin; X and Z are constant tilts.
    petalRotateX: { value: 0, min: -180, max: 180, step: 1, label: 'Petal Rotate X°' },
    petalRotateY: { value: 137.5, min: -180, max: 180, step: 0.5, label: 'Petal Rotate Y° (×index)' },
    petalRotateZ: { value: 0, min: -180, max: 180, step: 1, label: 'Petal Rotate Z°' },
    showCurve: { value: true, label: 'show curve (debug)' },
  };
}

// The NURBS spawn path — a simple straight line along +Y (like the Blender
// nurbsPath). Curve-to-Points samples it; a straight line has a constant
// tangent, so all petals come out parallel (the stacked deck) until a later
// step adds the per-petal rotation that fans them into the flower.
export function buildSpawnCurve({ curveLength }) {
  const degree = 1;
  const controlPoints = [
    new THREE.Vector4(0, 0, 0, 1),
    new THREE.Vector4(0, curveLength, 0, 1), // Three.js convention: +Y is up/top
  ];
  const knots = [0, 0, 1, 1];
  return new NURBSCurve(degree, knots, controlPoints);
}

// Place `amountOfPetals` petals along the line. The petal length (+Y) points
// PERPENDICULAR to the curve tangent (like Blender), so petals stand across the
// line and stack along it; the flat face points out toward +Z. No golden-angle
// rotation yet.
export function updateDahliaInstances(mesh, params, scratch) {
  const { amountOfPetals, petalScale, petalRotateX, petalRotateY, petalRotateZ } = params;
  const count = Math.max(1, Math.floor(amountOfPetals));
  const { matrix, basis, position, quaternion, qRot, scale, tangent, lenDir, xAxis, faceDir } = scratch;

  const rotX = THREE.MathUtils.degToRad(petalRotateX);
  const rotZ = THREE.MathUtils.degToRad(petalRotateZ);
  const rotYPerIndex = THREE.MathUtils.degToRad(petalRotateY); // ×index golden spin about +Y
  const curve = buildSpawnCurve(params);

  for (let i = 0; i < count; i += 1) {
    const u = count > 1 ? i / (count - 1) : 0;
    curve.getPointAt(u, position);
    curve.getTangentAt(u, tangent);

    // Petal FACE (local +Z) aligns to the nurbs axis (+Y) — petals lie flat and
    // stack up the line. LENGTH lies in the horizontal plane, WIDTH completes it.
    faceDir.copy(tangent).normalize();
    lenDir.set(0, 0, 1).addScaledVector(faceDir, -faceDir.z).normalize(); // horizontal, perp to face
    xAxis.crossVectors(lenDir, faceDir).normalize();
    basis.makeBasis(xAxis, lenDir, faceDir);
    quaternion.setFromRotationMatrix(basis);

    // Add back Petal Rotate X / Y / Z about the world axes (Y = up = Blender's Z,
    // carries the ×index golden spin).
    if (rotX !== 0) { qRot.setFromAxisAngle(AXIS_X, rotX); quaternion.premultiply(qRot); }
    if (rotZ !== 0) { qRot.setFromAxisAngle(AXIS_Z, rotZ); quaternion.premultiply(qRot); }
    if (rotYPerIndex !== 0) { qRot.setFromAxisAngle(AXIS_Y, i * rotYPerIndex); quaternion.premultiply(qRot); }

    scale.setScalar(petalScale);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }

  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

export function createInstanceScratch() {
  return {
    matrix: new THREE.Matrix4(),
    basis: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    qRot: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    lenDir: new THREE.Vector3(),
    xAxis: new THREE.Vector3(),
    faceDir: new THREE.Vector3(),
  };
}

// Bake the glb node transform and stand the petal up along +Y with its root at
// the origin. The BEND is done live in the vertex shader (see the material's
// positionNode in DahliaGeoNodes), so the geometry itself stays straight.
export function preparePetalGeometry(sourceMesh, { petalBend = 0 } = {}) {
  const geometry = sourceMesh.geometry.clone();
  sourceMesh.updateWorldMatrix(true, false);
  geometry.applyMatrix4(sourceMesh.matrixWorld);

  // glb petal runs along Z with a ~180° Y node flip; +90° X stands it up along +Y.
  geometry.rotateX(Math.PI / 2);

  // geometry.computeBoundingBox();
  // const box = geometry.boundingBox;
  // const center = box.getCenter(new THREE.Vector3());
  // geometry.translate(-center.x, -box.min.y, -center.z);

  // // Bend the petal on the CPU (rotate (y,z) about X by angle = y * Petal Bend).
  // // Baking it into the geometry keeps shadows correct — the shadow passes use
  // // the real bent geometry, unlike a vertex-shader deform whose bend does not
  // // reliably reach the shadow-cast depth material in this WebGPU node setup.
  // if (petalBend !== 0) {
  //   const pos = geometry.attributes.position;
  //   const v = new THREE.Vector3();
  //   for (let i = 0; i < pos.count; i += 1) {
  //     v.fromBufferAttribute(pos, i);
  //     const angle = v.y * petalBend;
  //     const c = Math.cos(angle);
  //     const s = Math.sin(angle);
  //     pos.setXYZ(i, v.x, v.y * c - v.z * s, v.y * s + v.z * c);
  //   }
  //   pos.needsUpdate = true;
  // }

  // geometry.computeVertexNormals();
  // geometry.computeBoundingBox();
  // geometry.computeBoundingSphere();
  return geometry;
}
