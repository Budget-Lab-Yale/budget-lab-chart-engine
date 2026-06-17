/**
 * Unit tests for src/snapshot/compare.ts — pure PNG comparison, no browser.
 *
 * PNG buffers are constructed in-test using pngjs so no fixture files are
 * needed and the test runs in node environment without Playwright. comparePng is async
 * (it dynamic-imports pngjs/pixelmatch so they stay out of the CLI's eager import graph).
 */

import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { comparePng } from "../src/snapshot/compare";

function makePng(width: number, height: number, r: number, g: number, b: number, a = 255): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = a;
  }
  return PNG.sync.write(png);
}

describe("comparePng — identical images", () => {
  it("returns match:true and diffPixels:0 for two identical 4x4 buffers", async () => {
    const buf = makePng(4, 4, 100, 150, 200);
    const result = await comparePng(buf, buf);
    expect(result.match).toBe(true);
    expect(result.diffPixels).toBe(0);
    expect(result.totalPixels).toBe(16);
  });

  it("returns match:true for two separately constructed identical buffers", async () => {
    const buf1 = makePng(8, 8, 255, 0, 0);
    const buf2 = makePng(8, 8, 255, 0, 0);
    const result = await comparePng(buf1, buf2);
    expect(result.match).toBe(true);
    expect(result.diffPixels).toBe(0);
  });
});

describe("comparePng — differing images", () => {
  it("returns match:false and diffPixels > 0 when images differ", async () => {
    const buf1 = makePng(4, 4, 0, 0, 0); // black
    const buf2 = makePng(4, 4, 255, 255, 255); // white
    const result = await comparePng(buf1, buf2);
    expect(result.match).toBe(false);
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.totalPixels).toBe(16);
  });

  it("diffPixels equals totalPixels when every pixel differs and threshold is low", async () => {
    const buf1 = makePng(2, 2, 0, 0, 0);
    const buf2 = makePng(2, 2, 255, 255, 255);
    const result = await comparePng(buf1, buf2, { threshold: 0 });
    expect(result.match).toBe(false);
    expect(result.diffPixels).toBe(result.totalPixels);
  });
});

describe("comparePng — mismatched dimensions", () => {
  it("returns match:false with diffPixels = totalPixels (actual size) when dims differ", async () => {
    const buf1 = makePng(4, 4, 100, 100, 100);
    const buf2 = makePng(8, 8, 100, 100, 100);
    const result = await comparePng(buf1, buf2);
    expect(result.match).toBe(false);
    expect(result.totalPixels).toBe(16); // 4×4
    expect(result.diffPixels).toBe(16); // all pixels count as diff
  });
});
