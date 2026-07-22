import * as THREE from 'three/webgpu';
import { NURBSCurve } from 'three/examples/jsm/curves/NURBSCurve.js';
import { folder } from 'leva';

export const PETAL_PATH = '/models/petal.glb';

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// STEP 1 — minimal spawn only:
// Spawn N straight petals along a flat NURBS spiral curve (the "Point/Petal
// Spawn" of the Blender graph). No petal bend/roll, no open/close morph.
export function createDahliaGeoControlsSchema() {
  return {
    amountOfPetals: { value: 12, min: 1, max: 400, step: 1, label: 'Amount of Petals' },
    curveLength: { value: 0.1, min: 0.02, max: 3, step: 0.01, label: 'Curve Length' },
    petalScale: { value: 0.3, min: 0.02, max: 2, step: 0.01, label: 'Petal Scale' },
    centerScale: { value: 0.8, min: 0, max: 2, step: 0.01, label: 'Center Petal Scale' },
    scaleRampPos: { value: 2, min: 0.01, max: 5, step: 0.01, label: 'Scale Ramp Pos (anim)' },
    petalRotateX: { value: -22, min: -180, max: 180, step: 1, label: 'Rotate X°' },
    petalRotateY: { value: 137.5, min: -180, max: 180, step: 0.5, label: 'Rotate Y° (×index)' },
    petalRotateZ: { value: 0, min: -180, max: 180, step: 1, label: 'Rotate Z°' },
    showCurve: { value: true, label: 'Show Curve (debug)' },
    rampStop: { value: 0.038, min: 0, max: 1.5, step: 0.001, label: 'Ramp Stop (anim)' },
    addValue: { value: -0.969, min: -2, max: 1, step: 0.001, label: 'Add Value (anim)' },
    'Closed Petal': folder({
      petalBend: { value: 0.43, min: -2, max: 2, step: 0.001, label: 'Bend' },
      petalBendCenterZ: { value: 1, min: -15, max: 15, step: 0.01, label: 'Bend Center Z' },
      petalWidth: { value: 0.5, min: -5, max: 5, step: 0.01, label: 'Taper Width' },
      taperCenterY: { value: 0.325, min: -5, max: 5, step: 0.001, label: 'Taper Center Y' },
    }, { collapsed: true }),
    'Open Petal': folder({
      openPetalBend: { value: 0.1, min: -2, max: 2, step: 0.001, label: 'Bend' },
      openBendCenterZ: { value: -9.86, min: -15, max: 15, step: 0.01, label: 'Bend Center Z' },
      openCurlK: { value: -6.38, min: -50, max: 50, step: 0.001, label: 'Curl K' },
      openScaleFix: { value: 1.5, min: 0, max: 5, step: 0.001, label: 'Scale Fix Y' },
      openTaperWidth: { value: 0.3, min: -5, max: 5, step: 0.01, label: 'Taper Width' },
      openTaperCenterY: { value: -4.11, min: -10, max: 10, step: 0.001, label: 'Taper Center Y' },
    }, { collapsed: true }),
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
  const { amountOfPetals, petalScale, petalRotateX, petalRotateY, petalRotateZ, centerScale, scaleRampPos, rampStop, addValue, openScaleFix } = params;
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

    // Per-petal blend factor: mirrors the GPU Color Ramp + Add computation.
    const iNorm = count > 1 ? i / (count - 1) : 0;
    const rampOut = rampStop > 0 ? Math.min(1, iNorm / rampStop) : 1;
    const blendFactor = Math.max(0, Math.min(1, rampOut + addValue));

    // Rotate Instances (open petal, Local Space): index mapped [1→120] → [0.860→-0.560] rad on X.
    // Local space = post-multiply so it rotates in the petal's own frame.
    if (blendFactor !== 0) {
      const tOpen = Math.max(0, Math.min(1, (i - 1) / (120 - 1)));
      const openRotX = (0.860 + tOpen * (-0.560 - 0.860)) * blendFactor;
      qRot.setFromAxisAngle(AXIS_X, -openRotX);
      quaternion.multiply(qRot);
    }

    // "Scale center petals smaller": ramp from centerScale (center) to full size
    // at distance scaleRampPos (the animatable bloom knob).
    const t = Math.min(1, position.length() / Math.max(1e-4, scaleRampPos));
    const sizeMul = centerScale + (1 - centerScale) * t; // mix(centerScale, 1, t)
    scale.setScalar(petalScale * sizeMul);

    // Scale Fix 2 (open petal, Local Space): Y-only scale.
    // Position → Gradient Texture (Quadratic Sphere) → Color Ramp (Ease, stop@0.842=1)
    //   → Multiply(openScaleFix) → Combine XYZ (1, Y, 1) → Scale Instances.
    if (blendFactor !== 0) {
      const dist = position.length();
      const gradFactor = Math.max(0, 1 - dist * dist); // Quadratic Sphere: 1 at origin, 0 at dist=1
      const tGrad = Math.min(1, gradFactor / 0.842);   // Color Ramp: [0, 0.842] → [0, 1]
      const ramp = tGrad * tGrad * (3 - 2 * tGrad);   // Ease (smoothstep)
      scale.y *= 1 + (ramp * openScaleFix - 1) * blendFactor;
    }

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
