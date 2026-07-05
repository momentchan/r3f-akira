import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const INPUT_PATH = path.join(rootDir, 'public/textures/tujlip.png');
const OUTPUT_PATH = path.join(rootDir, 'public/textures/tujlip-veins.png');

const CONFIG = {
  backgroundThreshold: 245,
  veinCount: 11,
  lineWidth: 4.5,
  angleSpread: Math.PI * 0.68,
  curveStrength: 0.15,
  tipInset: 0.07,
  // Tiny deterministic offsets so spacing is even but not machine-perfect.
  angleWobble: 0.012,
  lengthWobble: 0.025,
};

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function buildPetalMask(data, width, height) {
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const isBackground =
        r >= CONFIG.backgroundThreshold &&
        g >= CONFIG.backgroundThreshold &&
        b >= CONFIG.backgroundThreshold;
      mask[y * width + x] = isBackground ? 0 : 1;
    }
  }

  return mask;
}

function findPetalBase(mask, width, height) {
  for (let y = height - 1; y >= 0; y -= 1) {
    let minX = width;
    let maxX = 0;
    let count = 0;

    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        count += 1;
      }
    }

    if (count > width * 0.002) {
      return { x: (minX + maxX) * 0.5, y };
    }
  }

  return { x: width * 0.5, y: height * 0.92 };
}

function castRayToPetalEdge(mask, width, height, originX, originY, angle) {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  let lastX = originX;
  let lastY = originY;

  for (let step = 1; step < Math.max(width, height); step += 1) {
    const x = Math.round(originX + dx * step);
    const y = Math.round(originY + dy * step);

    if (x < 0 || y < 0 || x >= width || y >= height) {
      break;
    }

    if (mask[y * width + x]) {
      lastX = x;
      lastY = y;
      continue;
    }

    break;
  }

  return { x: lastX, y: lastY };
}

function setPixel(output, width, height, mask, x, y, value) {
  const px = Math.round(x);
  const py = Math.round(y);

  if (px < 0 || py < 0 || px >= width || py >= height) {
    return;
  }

  const index = py * width + px;
  if (!mask[index]) {
    return;
  }

  const offset = index * 4;
  output[offset] = value;
  output[offset + 1] = value;
  output[offset + 2] = value;
  output[offset + 3] = 255;
}

function drawDisc(output, width, height, mask, cx, cy, radius, value) {
  const r = Math.ceil(radius);

  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        setPixel(output, width, height, mask, x, y, value);
      }
    }
  }
}

function sampleQuadratic(x0, y0, cx, cy, x1, y1, t) {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * x0 + 2 * oneMinusT * t * cx + t * t * x1,
    y: oneMinusT * oneMinusT * y0 + 2 * oneMinusT * t * cy + t * t * y1,
  };
}

function drawVeinCurve(output, width, height, mask, start, end, lineWidth) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const midX = (start.x + end.x) * 0.5;
  const midY = (start.y + end.y) * 0.5;
  const side = Math.sign(end.x - start.x) || 0;
  const outward = 1 + Math.abs(end.x - start.x) / (width * 0.22);
  const curveAmount = CONFIG.curveStrength * outward;
  const controlX = midX + (-dy / length) * length * curveAmount * side;
  const controlY = midY + (dx / length) * length * curveAmount * side;

  const steps = Math.ceil(length * 1.4);
  let prev = start;

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const point = sampleQuadratic(start.x, start.y, controlX, controlY, end.x, end.y, t);
    const segmentSteps = Math.max(
      1,
      Math.ceil(Math.hypot(point.x - prev.x, point.y - prev.y)),
    );

    for (let s = 0; s <= segmentSteps; s += 1) {
      const u = s / segmentSteps;
      const x = prev.x + (point.x - prev.x) * u;
      const y = prev.y + (point.y - prev.y) * u;
      drawDisc(output, width, height, mask, x, y, lineWidth * 0.5, 0);
    }

    prev = point;
  }
}

function buildVeinAngles() {
  const angles = [];
  const startAngle = -CONFIG.angleSpread * 0.5;

  for (let i = 0; i < CONFIG.veinCount; i += 1) {
    const t = CONFIG.veinCount === 1 ? 0.5 : i / (CONFIG.veinCount - 1);
    const wobble = Math.sin(i * 1.63 + 0.4) * CONFIG.angleWobble;
    angles.push(startAngle + CONFIG.angleSpread * t + wobble);
  }

  return angles;
}

function generateVeinMap(source) {
  const { width, height, data } = source;
  const mask = buildPetalMask(data, width, height);
  const output = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    output[offset] = 255;
    output[offset + 1] = 255;
    output[offset + 2] = 255;
    output[offset + 3] = 255;
  }

  const base = findPetalBase(mask, width, height);
  const angles = buildVeinAngles();

  angles.forEach((angle, index) => {
    const edge = castRayToPetalEdge(mask, width, height, base.x, base.y, angle);
    const lengthScale =
      1 - CONFIG.tipInset + Math.sin(index * 2.11) * CONFIG.lengthWobble;
    const end = {
      x: base.x + (edge.x - base.x) * lengthScale,
      y: base.y + (edge.y - base.y) * lengthScale,
    };

    drawVeinCurve(output, width, height, mask, base, end, CONFIG.lineWidth);
  });

  return { output, mask };
}

function main() {
  const source = readPng(INPUT_PATH);
  const { output, mask } = generateVeinMap(source);

  const png = new PNG({ width: source.width, height: source.height });
  png.data = Buffer.from(output);
  fs.writeFileSync(OUTPUT_PATH, PNG.sync.write(png));

  let lineCount = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] && output[i * 4] === 0) {
      lineCount += 1;
    }
  }

  console.log(`Generated ${OUTPUT_PATH}`);
  console.log(`Size: ${source.width}x${source.height}, line pixels: ${lineCount}`);
}

main();
