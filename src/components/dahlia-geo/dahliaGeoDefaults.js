import { folder } from 'leva';
import * as THREE from 'three/webgpu';

export const PETAL_PATH = '/models/petal.glb';

// The Blender "Dahlia Flower" geometry node graph is a phyllotaxis generator.
// The exposed modifier inputs (and their real defaults) are:
//   Amount of Petals = 120         -> Curve to Points.Count
//   Rotation Fix for ^ = -0.004    -> small azimuth correction (Math.001)
//   Petal Rotate X = -0.490        -> per-petal base pitch  (Combine XYZ.X)
//   Petal Rotate Y = 0.000         -> per-petal base yaw    (Combine XYZ.Y)
//   Petal Rotate Z = 137.500       -> golden angle per index (Math.019)
//   Random Petal Scale = 1.500     -> per-petal scale jitter (Math.011)
//   Petal Width = -10.490          -> ROLL angle around the petal length (Vector Rotate.003)
//   Petal Bend = 1.120             -> BEND angle along the petal length  (Vector Rotate.004)
// Petal Width / Petal Bend are Vector-Rotate angles, not linear scales, so they
// are applied here as vertex rotations. The raw modifier values are kept as the
// UI defaults; these constants calibrate them to the petal's real dimensions.
export const BLENDER_DEFAULTS = {
  amountOfPetals: 120,
  rotationFix: -0.004,
  petalRotateX: -0.49,
  petalRotateY: 0,
  petalRotateZ: 137.5,
  randomPetalScale: 1.5,
  petalWidth: -10.49,
  petalBend: 1.12,
};

const ROLL_SCALE = 0.14; // Petal Width -> radians of roll at the petal edge (gentle scoop)
const BEND_SCALE = 0.5; // Petal Bend  -> radians of bend at the petal tip
const RAND_SCALE = 0.06; // Random Petal Scale -> fractional size jitter

const UP = new THREE.Vector3(0, 1, 0);

export function createDahliaGeoControlsSchema() {
  const b = BLENDER_DEFAULTS;
  return {
    // --- Blender modifier inputs (authoritative defaults) ---
    amountOfPetals: { value: 175, min: 3, max: 400, step: 1, label: 'Amount of Petals' },
    rotationFix: { value: b.rotationFix, min: -0.2, max: 0.2, step: 0.001, label: 'Rotation Fix' },
    petalRotateX: { value: b.petalRotateX, min: -1.6, max: 1.6, step: 0.005, label: 'Petal Rotate X' },
    petalRotateY: { value: b.petalRotateY, min: -1.6, max: 1.6, step: 0.005, label: 'Petal Rotate Y' },
    petalRotateZ: { value: b.petalRotateZ, min: 0, max: 180, step: 0.1, label: 'Petal Rotate Z' },
    randomPetalScale: { value: b.randomPetalScale, min: 0, max: 3, step: 0.01, label: 'Random Petal Scale' },
    petalWidth: { value: b.petalWidth, min: -20, max: 20, step: 0.01, label: 'Petal Width (roll)' },
    petalBend: { value: b.petalBend, min: -3, max: 3, step: 0.01, label: 'Petal Bend' },

    bloom: { value: 1, min: 0, max: 1, step: 0.001, label: 'bloom (open)' },

    // --- Arrangement (the dome that the curve-points + rotate-instances build) ---
    // Reshape the long/narrow source petal into dahlia proportions (the graph's
    // non-uniform Transform scales). Length < 1 shortens the spike, width > 1
    // broadens it, so petals read as rounded scoops instead of pointed blades.
    'Petal Shape': folder(
      {
        petalLengthScale: { value: 0.72, min: 0.15, max: 1.5, step: 0.01, label: 'length' },
        petalWidthScale: { value: 1.3, min: 0.4, max: 3, step: 0.01, label: 'width' },
        petalThickness: { value: 1, min: 0.2, max: 2, step: 0.01, label: 'thickness' },
      },
      { collapsed: true },
    ),

    Arrangement: folder(
      {
        viewTilt: { value: -1.15, min: -1.6, max: 0.2, step: 0.01, label: 'view tilt (face)' },
        domeAngle: { value: 1.7, min: 0.3, max: 2.9, step: 0.01, label: 'dome angle (rim)' },
        domeEase: { value: 1.05, min: 0.2, max: 4, step: 0.01, label: 'dome ease' },
        rootRadius: { value: 0.16, min: 0, max: 1.5, step: 0.005, label: 'root radius' },
        upBias: { value: 0.28, min: -0.5, max: 1.5, step: 0.01, label: 'tip lift' },
        recurve: { value: 0.3, min: -1, max: 1, step: 0.01, label: 'recurve' },
        globalScale: { value: 0.26, min: 0.02, max: 1, step: 0.005, label: 'global scale' },
        sizeInner: { value: 0.32, min: 0.05, max: 1.5, step: 0.01, label: 'size inner' },
        sizeOuter: { value: 1, min: 0.05, max: 1.5, step: 0.01, label: 'size outer' },
        sizeEase: { value: 1.1, min: 0.2, max: 4, step: 0.01, label: 'size ease' },
      },
      { collapsed: true },
    ),

    Animation: folder(
      {
        animate: { value: false, label: 'animate bloom' },
        animateSpeed: { value: 0.4, min: 0.05, max: 3, step: 0.01, label: 'anim speed' },
        seed: { value: 1, min: 1, max: 9999, step: 1, label: 'seed' },
      },
      { collapsed: true },
    ),
  };
}

function easePower(t, power) {
  return Math.pow(THREE.MathUtils.clamp(t, 0, 1), power);
}

// Deterministic pseudo-random in [0,1) for a given index + seed.
function hashRandom(index, seed) {
  const x = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Fill the InstancedMesh matrices for one dahlia bloom.
 * Petals are rooted on a hemisphere (the dome the curve-points build) and point
 * radially outward; azimuth advances by the golden angle (Petal Rotate Z) and a
 * per-petal base pitch/yaw (Petal Rotate X/Y) plus a size gradient toward the rim.
 */
export function updateDahliaInstances(mesh, params, scratch) {
  const {
    amountOfPetals,
    rotationFix,
    petalRotateX,
    petalRotateY,
    petalRotateZ,
    randomPetalScale,
    bloom,
    domeAngle,
    domeEase,
    rootRadius,
    upBias,
    recurve,
    globalScale,
    sizeInner,
    sizeOuter,
    sizeEase,
    seed,
  } = params;

  const count = Math.max(1, Math.floor(amountOfPetals));
  const goldenRad = THREE.MathUtils.degToRad(petalRotateZ);
  const {
    matrix, position, quaternion, qPitch, scale,
    dir, tangent, lengthDir, faceN, widthDir, basis,
  } = scratch;

  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0;
    const azimuth = i * goldenRad + rotationFix * i;

    // Polar angle from the top pole; `bloom` folds every petal upright into a bud.
    const theta = domeAngle * easePower(t, domeEase) * bloom;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const sinP = Math.sin(azimuth);
    const cosP = Math.cos(azimuth);

    // Surface frame on the dome: radial normal + meridian tangent (down-slope).
    dir.set(sinT * sinP, cosT, sinT * cosP); // outward normal (petal faces this way)
    tangent.set(cosT * sinP, -sinT, cosT * cosP); // meridian, points away from the pole

    // Petals lie ALONG the surface (tangent) rather than sticking straight out;
    // `upBias` lifts the tip off the dome so successive rings overlap like a real
    // dahlia instead of splaying flat like a daisy.
    lengthDir.copy(tangent).addScaledVector(dir, upBias).normalize();
    // Re-orthogonalize the outward face against the (lifted) length direction.
    faceN.copy(dir).addScaledVector(lengthDir, -dir.dot(lengthDir)).normalize();
    widthDir.crossVectors(lengthDir, faceN).normalize();

    // Local petal frame -> world: X=width, Y=length, Z=face normal.
    basis.makeBasis(widthDir, lengthDir, faceN);
    quaternion.setFromRotationMatrix(basis);

    // Per-petal pitch about the width axis (Petal Rotate X + recurve toward rim).
    qPitch.setFromAxisAngle(widthDir, petalRotateX * (1 - t) + recurve * t + petalRotateY);
    quaternion.premultiply(qPitch);

    const jitter = 1 + (hashRandom(i, seed) - 0.5) * 2 * (randomPetalScale * RAND_SCALE);
    const size = globalScale * THREE.MathUtils.lerp(sizeInner, sizeOuter, easePower(t, sizeEase)) * jitter;

    position.copy(dir).multiplyScalar(rootRadius);
    scale.setScalar(size);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }

  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

const EULER = new THREE.Euler();

export function createInstanceScratch() {
  return {
    matrix: new THREE.Matrix4(),
    basis: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    qPitch: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    lengthDir: new THREE.Vector3(),
    faceN: new THREE.Vector3(),
    widthDir: new THREE.Vector3(),
  };
}

/**
 * Bake the petal glb node transform into the geometry, reorient it so the root
 * sits at the origin with the length along +Y, then apply the graph's petal
 * shaping: Petal Width rolls the petal around its length (the dahlia quill) and
 * Petal Bend curves it along its length.
 */
export function preparePetalGeometry(sourceMesh, {
  petalWidth,
  petalBend,
  petalLengthScale = 1,
  petalWidthScale = 1,
  petalThickness = 1,
}) {
  const geometry = sourceMesh.geometry.clone();
  sourceMesh.updateWorldMatrix(true, false);
  geometry.applyMatrix4(sourceMesh.matrixWorld);

  // In the exported glb the petal runs along Z; the node's ~180° Y rotation
  // flips the tip to -Z, so a +90° X rotation stands it up along +Y.
  geometry.rotateX(Math.PI / 2);

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);

  // Reshape into dahlia proportions (the graph's non-uniform Transform scales):
  // shorten the length, broaden the width so it stops reading as a spike.
  geometry.scale(petalWidthScale, petalLengthScale, petalThickness);

  geometry.computeBoundingBox();
  const length = Math.max(1e-4, geometry.boundingBox.max.y);
  const halfWidth = Math.max(1e-4, Math.max(
    Math.abs(geometry.boundingBox.max.x),
    Math.abs(geometry.boundingBox.min.x),
  ));

  const rollAmount = petalWidth * ROLL_SCALE;
  const bendAmount = petalBend * BEND_SCALE;

  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);

    // Roll: rotate the cross-section (x,z) about the length axis by an angle that
    // grows toward the petal edge — curls the flat petal into a rolled quill.
    const roll = rollAmount * (v.x / halfWidth);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const rx = v.x * cr + v.z * sr;
    const rz = -v.x * sr + v.z * cr;
    v.x = rx;
    v.z = rz;

    // Bend: rotate (y,z) about the width axis by an angle that grows toward the
    // tip — curves the petal forward along its length.
    const yn = v.y / length;
    const bend = bendAmount * yn;
    const cb = Math.cos(bend);
    const sb = Math.sin(bend);
    const by = v.y * cb - v.z * sb;
    const bz = v.y * sb + v.z * cb;
    v.y = by;
    v.z = bz;

    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}
