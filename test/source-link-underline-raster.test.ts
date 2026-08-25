// Does the export's underline actually reach the PIXELS?
//
// The export draws a link as an SVG <tspan text-decoration="underline">, and the download pipeline
// is XMLSerializer → SVG Blob → <img> → canvas. A DOM assertion that the attribute is present says
// nothing about whether that pipeline paints it: this codebase already documents the same rasterizer
// silently ignoring `baseline-shift`. So the attribute test in source-links-render.test.ts is
// necessary and NOT sufficient, and this file is the sufficient half.
//
// If this ever fails, the fix is not to delete the assertion — it is to draw the underline as an
// explicit <line> under each link run, which the rasterizer cannot ignore.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { PNG } from "pngjs";

const HAS_BROWSER = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let browser: Browser | undefined;
beforeAll(async () => { if (HAS_BROWSER) browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

/** Rasterize an SVG string through the SAME path the download uses, and count dark pixels. */
async function darkPixels(svg: string): Promise<number> {
  const page = await browser!.newPage();
  const b64: string = await page.evaluate(async (markup: string) => {
    const blob = new Blob([markup], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas");
    c.width = 300; c.height = 60;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png").split(",")[1]!;
  }, svg);
  await page.close();
  const png = PNG.sync.read(Buffer.from(b64, "base64"));
  let dark = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i]! < 200 && png.data[i + 1]! < 200 && png.data[i + 2]! < 200) dark++;
  }
  return dark;
}

/** Identical text, drawn with and without the underline attribute the export emits. */
const svgFor = (underline: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60">` +
  `<text x="10" y="30" font-family="sans-serif" font-size="14" fill="#333">` +
  `<tspan${underline ? ' text-decoration="underline"' : ""}>Current Employment Statistics</tspan>` +
  `</text></svg>`;

describe.skipIf(!HAS_BROWSER)("export underline reaches the raster", () => {
  it("paints more ink with text-decoration than without", async () => {
    const plain = await darkPixels(svgFor(false));
    const underlined = await darkPixels(svgFor(true));
    expect(plain).toBeGreaterThan(0); // the text itself rasterized, so the harness works
    expect(underlined).toBeGreaterThan(plain);
  });
});
