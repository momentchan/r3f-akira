import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const COMPONENT_BYTES = {
  5121: 1,
  5123: 2,
  5125: 4,
  5126: 4,
};

const COMPONENT_READERS = {
  5121: 'getUint8',
  5123: 'getUint16',
  5125: 'getUint32',
  5126: 'getFloat32',
};

const TYPE_SIZE = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

function readGlb(filePath) {
  const file = fs.readFileSync(filePath);
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(
    file.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/, ''),
  );
  const binaryHeader = 20 + jsonLength;
  const binaryLength = file.readUInt32LE(binaryHeader);
  const binary = file.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength);
  return { json, binary };
}

function readAccessor(glb, accessorIndex) {
  const accessor = glb.json.accessors[accessorIndex];
  const view = glb.json.bufferViews[accessor.bufferView];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const componentCount = TYPE_SIZE[accessor.type];
  const reader = COMPONENT_READERS[accessor.componentType];
  const stride = view.byteStride ?? componentBytes * componentCount;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(
    glb.binary.buffer,
    glb.binary.byteOffset,
    glb.binary.byteLength,
  );

  return Array.from({ length: accessor.count }, (_, row) => (
    Array.from({ length: componentCount }, (_, column) => (
      data[reader](start + row * stride + column * componentBytes, true)
    ))
  ));
}

function edge(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function rasterizeTriangle(coverage, size, a, b, c) {
  const ax = a[0] * (size - 1);
  // Flower masks are configured with texture.flipY = false. Store V directly
  // in image-row space so the runtime samples the Blender UV without mirroring.
  const ay = a[1] * (size - 1);
  const bx = b[0] * (size - 1);
  const by = b[1] * (size - 1);
  const cx = c[0] * (size - 1);
  const cy = c[1] * (size - 1);
  const area = edge(ax, ay, bx, by, cx, cy);
  if (Math.abs(area) < 1e-8) return;

  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
  const sign = area < 0 ? -1 : 1;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const ab = edge(ax, ay, bx, by, px, py) * sign;
      const bc = edge(bx, by, cx, cy, px, py) * sign;
      const ca = edge(cx, cy, ax, ay, px, py) * sign;
      if (ab >= -1e-5 && bc >= -1e-5 && ca >= -1e-5) {
        coverage[y * size + x] = 1;
      }
    }
  }
}

function findTriangleComponents(indices) {
  const parent = new Int32Array(indices.length / 3);
  const vertexOwner = new Map();
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;

  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const join = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let triangle = 0; triangle < parent.length; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[triangle * 3 + corner];
      const owner = vertexOwner.get(vertex);
      if (owner == null) vertexOwner.set(vertex, triangle);
      else join(triangle, owner);
    }
  }

  const components = new Map();
  for (let triangle = 0; triangle < parent.length; triangle += 1) {
    const root = find(triangle);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(triangle);
  }
  return [...components.values()].sort((a, b) => b.length - a.length);
}

function insetCoverage(coverage, size, insetPixels) {
  if (insetPixels <= 0) return coverage;

  const maxDistance = size * 2;
  const distance = new Uint16Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      // The texture outside the image is also outside the UV island. Seed the
      // image border at distance one so full-range 0..1 UV shells can inset.
      const borderDistance = Math.min(x + 1, y + 1, size - x, size - y);
      distance[i] = coverage[i] >= 0.5 ? borderDistance : 0;
      if (distance[i] > insetPixels + 1) distance[i] = maxDistance;
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      if (x > 0) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
      if (y > 0) distance[i] = Math.min(distance[i], distance[i - size] + 1);
    }
  }
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = size - 1; x >= 0; x -= 1) {
      const i = y * size + x;
      if (x + 1 < size) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
      if (y + 1 < size) distance[i] = Math.min(distance[i], distance[i + size] + 1);
    }
  }

  const inset = new Float32Array(coverage.length);
  for (let i = 0; i < inset.length; i += 1) {
    // Texture filtering softens this relocated binary transition at runtime.
    inset[i] = Math.max(0, Math.min(1, distance[i] - insetPixels));
  }
  return inset;
}

function generateMask(
  inputPath,
  outputPath,
  outputSize = 1024,
  componentMode = 'all',
  insetPixels = 0,
  supersample = 4,
) {
  const glb = readGlb(inputPath);
  const primitive = glb.json.meshes
    .flatMap((mesh) => mesh.primitives)
    .find((candidate) => candidate.attributes?.TEXCOORD_0 != null);

  if (!primitive) throw new Error(`No TEXCOORD_0 found in ${inputPath}`);
  if (primitive.indices == null) throw new Error(`Indexed geometry required: ${inputPath}`);

  const uvs = readAccessor(glb, primitive.attributes.TEXCOORD_0);
  const indices = readAccessor(glb, primitive.indices).flat();
  const workSize = outputSize * supersample;
  const coverage = new Uint8Array(workSize * workSize);
  const components = findTriangleComponents(indices);
  const selectedTriangles = componentMode === 'representative'
    ? components[0]
    : Array.from({ length: indices.length / 3 }, (_, triangle) => triangle);

  for (const triangle of selectedTriangles) {
    const i = triangle * 3;
    rasterizeTriangle(
      coverage,
      workSize,
      uvs[indices[i]],
      uvs[indices[i + 1]],
      uvs[indices[i + 2]],
    );
  }

  const png = new PNG({ width: outputSize, height: outputSize });
  const sampleCount = supersample * supersample;
  const outputCoverage = new Float32Array(outputSize * outputSize);
  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        const row = (y * supersample + sy) * workSize;
        for (let sx = 0; sx < supersample; sx += 1) {
          covered += coverage[row + x * supersample + sx];
        }
      }
      outputCoverage[y * outputSize + x] = covered / sampleCount;
    }
  }

  const finalCoverage = insetCoverage(outputCoverage, outputSize, insetPixels);
  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const value = Math.round(255 * (1 - finalCoverage[y * outputSize + x]));
      const offset = (y * outputSize + x) * 4;
      png.data[offset] = value;
      png.data[offset + 1] = value;
      png.data[offset + 2] = value;
      png.data[offset + 3] = 255;
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, PNG.sync.write(png));
  console.log(
    `Generated ${outputPath} (${outputSize}x${outputSize}, `
      + `${componentMode}, inset ${insetPixels}px, `
      + `${components.length} connected components found)`,
  );
}

const [, , inputPath, outputPath, sizeArg, componentArg, insetArg] = process.argv;
if (!inputPath || !outputPath) {
  console.error(
    'Usage: node scripts/textures/generate-flower-mask-from-uv.mjs '
      + '<input.glb> <output.png> [size] [all|representative] [insetPixels]',
  );
  process.exit(1);
}

const componentMode = componentArg || 'all';
if (!['all', 'representative'].includes(componentMode)) {
  throw new Error(`Unknown component mode: ${componentMode}`);
}

generateMask(
  inputPath,
  outputPath,
  Number(sizeArg) || 1024,
  componentMode,
  Math.max(0, Number(insetArg) || 0),
);
