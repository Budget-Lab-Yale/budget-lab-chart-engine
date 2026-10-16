// PNG comparison utility for chart snapshot tests.
// Uses pngjs to decode PNG buffers and pixelmatch to count differing pixels.

import { writeFileSync } from "node:fs";

// pngjs + pixelmatch are imported DYNAMICALLY (inside the function), not at the top — they
// are optional, snapshot-only deps. A static import would be hoisted by esbuild to the top
// of the CLI bundle and break `tbl-chart` for consumers that don't have them installed.
// (This makes comparePng async.)

export interface CompareResult {
  match: boolean;
  diffPixels: number;
  totalPixels: number;
  /** Whether a diff image was written to `diffOutPath`. False on a dimension mismatch, which
   *  returns before any diff is drawn, so a caller must not report a diff file then. */
  diffWritten: boolean;
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
export async function comparePng(
  actual: Buffer,
  baseline: Buffer,
  opts?: { threshold?: number; diffOutPath?: string },
): Promise<CompareResult> {
  const threshold = opts?.threshold ?? 0.1;

  const { PNG } = await import("pngjs");
  const { default: pixelmatch } = await import("pixelmatch");

  const actualPng = PNG.sync.read(actual);
  const baselinePng = PNG.sync.read(baseline);

  const totalPixels = actualPng.width * actualPng.height;

  // Dimension mismatch: treat every pixel as different.
  if (actualPng.width !== baselinePng.width || actualPng.height !== baselinePng.height) {
    return { match: false, diffPixels: totalPixels, totalPixels, diffWritten: false };
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

  const diffOutPath = diffPixels > 0 ? opts?.diffOutPath : undefined;
  if (diffOutPath) writeFileSync(diffOutPath, PNG.sync.write(diffPng));

  return { match: diffPixels === 0, diffPixels, totalPixels, diffWritten: !!diffOutPath };
}
