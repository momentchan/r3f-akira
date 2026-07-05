import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const UV_PATH = path.join(rootDir, 'public/textures/tujlip.png');
const SOURCE_PATH = path.join(rootDir, 'public/textures/tujlip-veins-source.png');
const OUTPUT_PATH = path.join(rootDir, 'public/textures/tujlip-veins.png');

const CONFIG = {
  backgroundThreshold: 245,
  lineThreshold: 0.42,
};

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function isBackground(data, x, y, width) {
  const index = (y * width + x) * 4;
  return (
    data[index] >= CONFIG.backgroundThreshold &&
    data[index + 1] >= CONFIG.backgroundThreshold &&
    data[index + 2] >= CONFIG.backgroundThreshold
  );
}

function isLine(data, x, y, width) {
  const index = (y * width + x) * 4;
  return (
    data[index] < 200 &&
    data[index + 1] < 200 &&
    data[index + 2] < 200
  );
}

function buildFilledPetalMask(data, width, height) {
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = isBackground(data, x, y, width) ? 0 : 1;
    }
  }

  return mask;
}

function buildLineMask(data, width, height) {
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = isLine(data, x, y, width) ? 1 : 0;
    }
  }

  return mask;
}

function floodFillInterior(data, width, height) {
  const interior = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue = [];
  const seedX = Math.floor(width * 0.5);
  const seedCandidates = [
    [seedX, height - 8],
    [seedX, height - 20],
    [seedX, height - 40],
    [seedX, Math.floor(height * 0.55)],
  ];

  for (const [x, y] of seedCandidates) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    if (isLine(data, x, y, width) || !isBackground(data, x, y, width)) {
      continue;
    }
    queue.push([x, y]);
    break;
  }

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const index = y * width + x;

    if (x < 0 || y < 0 || x >= width || y >= height || visited[index]) {
      continue;
    }

    if (isLine(data, x, y, width) || !isBackground(data, x, y, width)) {
      continue;
    }

    visited[index] = 1;
    interior[index] = 1;
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return interior;
}

function buildOuterOutlineMask(data, interior, width, height) {
  const outline = new Uint8Array(width * height);
  const neighbors = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!isLine(data, x, y, width)) {
        continue;
      }

      const touchesExterior = neighbors.some(([ox, oy]) => {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          return true;
        }
        return isBackground(data, nx, ny, width) && !interior[ny * width + nx];
      });

      if (touchesExterior) {
        outline[index] = 1;
      }
    }
  }

  return dilateMask(outline, width, height, 2);
}

function dilateMask(mask, width, height, radius) {
  const dilated = new Uint8Array(mask);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }

      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          dilated[ny * width + nx] = 1;
        }
      }
    }
  }

  return dilated;
}

function floodFillExteriorWhite(data, width, height) {
  const exterior = new Uint8Array(width * height);
  const queue = [];

  for (let x = 0; x < width; x += 1) {
    queue.push([x, 0], [x, height - 1]);
  }
  for (let y = 0; y < height; y += 1) {
    queue.push([0, y], [width - 1, y]);
  }

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const index = y * width + x;

    if (x < 0 || y < 0 || x >= width || y >= height || exterior[index]) {
      continue;
    }

    if (isLine(data, x, y, width)) {
      continue;
    }

    if (!isBackground(data, x, y, width)) {
      continue;
    }

    exterior[index] = 1;
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return exterior;
}

function stripOuterBorder(output, uvMask, width, height) {
  const exterior = floodFillExteriorWhite(output.data, width, height);
  const neighbors = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!uvMask[index] || !isLine(output.data, x, y, width)) {
        continue;
      }

      const touchesExterior = neighbors.some(([ox, oy]) => {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          return true;
        }
        const neighborIndex = ny * width + nx;
        return (
          isBackground(output.data, nx, ny, width) &&
          exterior[neighborIndex]
        );
      });

      if (touchesExterior) {
        const offset = index * 4;
        output.data[offset] = 255;
        output.data[offset + 1] = 255;
        output.data[offset + 2] = 255;
      }
    }
  }
}

function getContentBounds(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { minX, minY, maxX, maxY };
}

function sampleChannelBilinear(data, width, height, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;

  function sample(px, py) {
    if (px < 0 || py < 0 || px >= width || py >= height) {
      return 255;
    }

    return data[(py * width + px) * 4];
  }

  const top = sample(x0, y0) * (1 - tx) + sample(x1, y0) * tx;
  const bottom = sample(x0, y1) * (1 - tx) + sample(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function sampleLineStrength(data, outline, width, height, x, y) {
  const value = sampleChannelBilinear(data, width, height, x, y);
  const strength = 1 - value / 255;
  if (strength < CONFIG.lineThreshold) {
    return 0;
  }

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const px = Math.max(0, Math.min(width - 1, Math.round(x) + ox));
      const py = Math.max(0, Math.min(height - 1, Math.round(y) + oy));
      if (outline[py * width + px]) {
        return 0;
      }
    }
  }

  return strength;
}

function fitVeinTextureToUv(uvImage, sourceImage) {
  const { width, height, data: uvData } = uvImage;
  const {
    width: sourceWidth,
    height: sourceHeight,
    data: sourceData,
  } = sourceImage;

  const uvMask = buildFilledPetalMask(uvData, width, height);
  const sourceLineMask = buildLineMask(sourceData, sourceWidth, sourceHeight);
  const sourceInterior = floodFillInterior(sourceData, sourceWidth, sourceHeight);
  const sourceOutline = buildOuterOutlineMask(
    sourceData,
    sourceInterior,
    sourceWidth,
    sourceHeight,
  );

  const uvBounds = getContentBounds(uvMask, width, height);
  const sourceBounds = getContentBounds(sourceLineMask, sourceWidth, sourceHeight);

  const uvWidth = uvBounds.maxX - uvBounds.minX;
  const uvHeight = uvBounds.maxY - uvBounds.minY;
  const sourceWidthPx = sourceBounds.maxX - sourceBounds.minX;
  const sourceHeightPx = sourceBounds.maxY - sourceBounds.minY;

  const output = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    output.data[offset] = 255;
    output.data[offset + 1] = 255;
    output.data[offset + 2] = 255;
    output.data[offset + 3] = 255;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!uvMask[index]) {
        continue;
      }

      const normX = (x - uvBounds.minX) / uvWidth;
      const normY = (y - uvBounds.minY) / uvHeight;
      const sourceX = sourceBounds.minX + normX * sourceWidthPx;
      const sourceY = sourceBounds.minY + normY * sourceHeightPx;
      const strength = sampleLineStrength(
        sourceData,
        sourceOutline,
        sourceWidth,
        sourceHeight,
        sourceX,
        sourceY,
      );

      if (strength >= CONFIG.lineThreshold) {
        const offset = index * 4;
        output.data[offset] = 0;
        output.data[offset + 1] = 0;
        output.data[offset + 2] = 0;
      }
    }
  }

  stripOuterBorder(output, uvMask, width, height);

  return {
    output,
    uvBounds,
    sourceBounds,
    scaleX: uvWidth / sourceWidthPx,
    scaleY: uvHeight / sourceHeightPx,
  };
}

function main() {
  const uvImage = readPng(UV_PATH);
  const sourceImage = readPng(SOURCE_PATH);
  const { output, uvBounds, sourceBounds, scaleX, scaleY } =
    fitVeinTextureToUv(uvImage, sourceImage);

  fs.writeFileSync(OUTPUT_PATH, PNG.sync.write(output));

  console.log(`Fitted ${SOURCE_PATH}`);
  console.log(`Output: ${OUTPUT_PATH} (${output.width}x${output.height})`);
  console.log(`UV petal bounds: ${JSON.stringify(uvBounds)}`);
  console.log(`Source art bounds: ${JSON.stringify(sourceBounds)}`);
  console.log(`Scale X: ${scaleX.toFixed(4)}, Scale Y: ${scaleY.toFixed(4)}`);
  console.log('Warp: smooth bounds-to-bounds bilinear');
}

main();
