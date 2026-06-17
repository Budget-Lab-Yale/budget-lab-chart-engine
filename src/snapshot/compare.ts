// PNG comparison utility for chart snapshot tests.
// Uses pngjs to decode PNG buffers and pixelmatch to count differing pixels.

import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { writeFileSync } from "node:fs";

export interface CompareResult {
  match: boolean;
  diffPixels: number;
  totalPixels: number;
}

/**
 * Compare two PNG buffers pixel-by-pixel.
 *
 * Returns match:true only when diffPixels === 0 (strict default).
 * If `diffOutPath` is given and there are differing pixels, the diff image
 * is written to that path.
 *
 * If the images have different dimensions, match is false and diffPixels
 * equals totalPixels (width * height of the actual image).
 */
export function comparePng(
  actual: Buffer,
  baseline: Buffer,
  opts?: { threshold?: number; diffOutPath?: string },
): CompareResult {
  const threshold = opts?.threshold ?? 0.1;

  const actualPng = PNG.sync.read(actual);
  const baselinePng = PNG.sync.read(baseline);

  const totalPixels = actualPng.width * actualPng.height;

  // Dimension mismatch: treat every pixel as different.
  if (actualPng.width !== baselinePng.width || actualPng.height !== baselinePng.height) {
    return { match: false, diffPixels: totalPixels, totalPixels };
  }

  const diffPng = new PNG({ width: actualPng.width, height: actualPng.height });

  const diffPixels = pixelmatch(
    actualPng.data,
    baselinePng.data,
    diffPng.data,
    actualPng.width,
    actualPng.height,
    { threshold },
  );

  if (diffPixels > 0 && opts?.diffOutPath) {
    writeFileSync(opts.diffOutPath, PNG.sync.write(diffPng));
  }

  return { match: diffPixels === 0, diffPixels, totalPixels };
}
