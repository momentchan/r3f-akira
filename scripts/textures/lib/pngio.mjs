import fs from 'fs';
import { PNG } from 'pngjs';

export function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

export function writePng(filePath, png) {
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

export function buildPetalMask(data, width, height, backgroundThreshold = 245) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const isBackground =
        data[index] >= backgroundThreshold &&
        data[index + 1] >= backgroundThreshold &&
        data[index + 2] >= backgroundThreshold;
      mask[y * width + x] = isBackground ? 0 : 1;
    }
  }
  return mask;
}
