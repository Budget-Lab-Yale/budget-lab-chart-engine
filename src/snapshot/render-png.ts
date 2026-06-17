// Headless-browser PNG renderer for chart snapshot testing.
// Launches Chromium via Playwright, loads a self-contained chart HTML, and
// screenshots the #chart element (or full page if absent) as a PNG Buffer.

import { chromium } from "playwright";

export interface RenderPngOptions {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
}

/**
 * Render a self-contained chart HTML page to a PNG Buffer.
 *
 * Uses a fixed viewport and waits for fonts + a short settle so the output
 * is deterministic across repeated calls on the same machine.
 */
export async function renderChartPng(
  html: string,
  opts?: RenderPngOptions,
): Promise<Buffer> {
  const width = opts?.width ?? 760;
  const height = opts?.height ?? 480;
  const deviceScaleFactor = opts?.deviceScaleFactor ?? 2;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
    });
    const page = await context.newPage();

    await page.setContent(html, { waitUntil: "networkidle" });

    // Wait for web fonts to be fully loaded (avoids font-swap flicker).
    await page.evaluate(() => document.fonts.ready);

    // Short settle for any layout reflows after font load.
    await page.waitForTimeout(150);

    // Screenshot the #chart element; fall back to full page if absent.
    const chartEl = page.locator("#chart");
    const count = await chartEl.count();
    let pngBuffer: Buffer;
    if (count > 0) {
      pngBuffer = (await chartEl.screenshot({ type: "png" })) as Buffer;
    } else {
      pngBuffer = (await page.screenshot({ type: "png", fullPage: true })) as Buffer;
    }

    await context.close();
    return pngBuffer;
  } finally {
    await browser.close();
  }
}
