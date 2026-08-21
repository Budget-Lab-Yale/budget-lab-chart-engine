// Visual proof that barStack.total.divider's rule is actually PERCEPTIBLE against a dark/
// saturated bar segment showing through .tbl-tooltip's translucent card — not just that the
// modifier class landed and its computed border-color resolved to something. A computed
// border-top-color tells you nothing about whether a human can see it once it's composited over
// an arbitrary, unpredictable chart backdrop through a `backdrop-filter: blur(...)` card; that
// gap is exactly how the original --tbl-gridline choice (tuned for a gridline on an OPAQUE white
// plot area) shipped invisible over a saturated bar. This rasterizes the REAL standalone bundle
// in headless Chromium, hovers a REAL dark bar, and reads pixels out of a REAL screenshot of the
// live .tbl-tooltip element.
//
// `bold`/`divider` default ON, so the case that actually matters is a spec with NO `barStack.total`
// block at all — every pre-existing stacked chart with a Total row. Both specs below are verified
// through the same real-browser path; the explicit opt-in case guards against a future change that
// makes the opt-out the only route to this markup.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { PNG } from "pngjs";
import { BUNDLE_PATH } from "./setup/global-build";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const HAS_BROWSER = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

// This file launches a real Chromium via Playwright, which flakes under parallel test-file load
// (contending for CPU with the rest of the suite's worker threads) — the suite's 5s/10s defaults
// are tuned for jsdom-speed tests, not a browser launch + screenshot. Raised per-file (isolated to
// this file's worker) rather than in vitest.config.ts, so the rest of the suite keeps its tight
// defaults; see test/hatch-legend-legibility.test.ts for the other file with the same fix.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// Worst case per the coordinator's report: a dark, saturated bar segment (navy), not the pale
// palette default. Both series share it, so wherever the hovered pointer/tooltip lands over the
// single bar, the backdrop is uniformly dark.
const DARK = "#101F5B"; // --tbl-navy
const ROWS: TidyRow[] = [
  { time: "Cat", series: "A", value: "40" },
  { time: "Cat", series: "B", value: "40" },
];

// netDisplay: "none" + hover: "tooltip" is the only way to reach a Total row with `hover:
// tooltip` and no net dot — total.bold/divider apply to either Total-row branch, this just
// reuses the smallest reproduction.
const BASE = {
  chartType: "stacked" as const,
  title: "Divider visibility",
  xAxisType: "categorical" as const,
  series_order: ["A", "B"],
  series_colors: { A: DARK, B: DARK },
  data: "inline" as const,
};

// Explicit opt-in (belt and suspenders — proves the field still works when set).
const SPEC_EXPLICIT: ChartSpec = {
  ...BASE,
  barStack: { netDisplay: "none", hover: "tooltip", total: { bold: true, divider: true } },
};
// The case the default flip is actually about: no `total` block at all.
const SPEC_DEFAULT: ChartSpec = {
  ...BASE,
  barStack: { netDisplay: "none", hover: "tooltip" },
};

/** Average perceptual luminance (0-255) of a horizontal pixel strip, avoiding the rounded
 *  corners by sampling only the inner 60% of the width. */
function stripLuminance(png: PNG, yDevice: number, rowsTall = 1): number {
  const xStart = Math.floor(png.width * 0.2);
  const xEnd = Math.ceil(png.width * 0.8);
  let sum = 0;
  let n = 0;
  for (let dy = 0; dy < rowsTall; dy++) {
    const y = yDevice + dy;
    if (y < 0 || y >= png.height) continue;
    for (let x = xStart; x < xEnd; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i]!, g = png.data[i + 1]!, b = png.data[i + 2]!;
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++;
    }
  }
  return n ? sum / n : NaN;
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60000);
afterAll(async () => {
  await browser?.close();
});

/** Mount `spec` in a real page, hover the (single, dark) bar, and return the live `.tbl-tooltip`
 *  locator plus the DPR-scaled screenshot PNG, once the tooltip is showing. */
async function mountHoverAndShoot(
  page: Page,
  spec: ChartSpec,
  dpr: number,
): Promise<{ png: PNG; ruleCssTop: number; tipTop: number }> {
  const liveJs = readFileSync(BUNDLE_PATH, "utf8");
  await page.setContent(
    `<!doctype html><html><head><style>${CHART_CSS}</style></head>` +
      `<body style="margin:0;background:#fff">` +
      `<div id="chart" style="width:700px;height:500px"></div>` +
      `<script>${liveJs}</script></body></html>`,
    { waitUntil: "load" },
  );
  await page.evaluate(
    ({ spec, rows }) => {
      const w = window as unknown as {
        BudgetLabChart: { mountChart: (el: Element, opts: unknown) => void };
      };
      w.BudgetLabChart.mountChart(document.getElementById("chart")!, {
        spec,
        rows,
        width: 700,
        height: 500,
      });
    },
    { spec, rows: ROWS },
  );

  const hit = page.locator(".tbl-band-crosshair-hit").first();
  await hit.waitFor({ state: "attached" });
  const barBox = await page.locator('g[aria-label="bar"] rect').first().boundingBox();
  if (!barBox) throw new Error("no bar rect found");
  // Hover comfortably inside the (single, wide, tall) dark bar so the tooltip's +14/+14 offset
  // also lands over it, not past its edge.
  const cx = barBox.x + barBox.width / 2;
  const cy = barBox.y + Math.min(30, barBox.height / 2);
  await page.mouse.move(cx, cy);

  const tip = page.locator(".tbl-tooltip");
  await expect.poll(() => tip.evaluate((el) => (el as HTMLElement).style.opacity)).toBe("1");

  const geom = await page.evaluate(() => {
    const t = document.querySelector(".tbl-tooltip")!.getBoundingClientRect();
    const row = document.querySelector(".tbl-tooltip-row--total")!.getBoundingClientRect();
    return { tipTop: t.top, rowTop: row.top };
  });
  const shot = await tip.screenshot();
  const png = PNG.sync.read(shot);
  return { png, ruleCssTop: geom.rowTop, tipTop: geom.tipTop };
}

/** Runs the full visible-divider assertion for one spec, sharing the geometry/pixel logic. */
function verifyVisibleDivider(name: string, spec: ChartSpec) {
  it(`${name}: renders a rule perceptibly different from the plain gap above it, and a bold label`, async () => {
    const DPR = 2; // magnify so a 1px CSS border is not lost to a single ambiguous device pixel
    const page: Page = await browser.newPage({
      viewport: { width: 700, height: 500 },
      deviceScaleFactor: DPR,
    });
    try {
      const { png, ruleCssTop, tipTop } = await mountHoverAndShoot(page, spec, DPR);

      const totalRowClass = await page.evaluate(
        () => document.querySelector(".tbl-tooltip-row--total")?.className ?? null,
      );
      expect(totalRowClass).not.toBeNull();
      expect(totalRowClass).toContain("tbl-tooltip-row--total-rule-above");
      expect(totalRowClass).toContain("tbl-tooltip-row--total-bold");

      // Bold: the label's actually-computed weight, not just the class name.
      const labelWeight = await page.evaluate(() => {
        const label = document.querySelector(".tbl-tooltip-row--total .tbl-tooltip-label")!;
        return getComputedStyle(label).fontWeight;
      });
      expect(Number(labelWeight)).toBeGreaterThanOrEqual(700); // --tw-bold is 800

      // Divider: border-top sits exactly at the Total row's own border-box top edge.
      const ruleCssY = ruleCssTop - tipTop;
      const ruleY = Math.round(ruleCssY * DPR);

      // The expected row from getBoundingClientRect is exact in CSS px, but the actual painted
      // border can land 1-2 DEVICE px off it (subpixel snapping at a fractional CSS position,
      // plus the 1px CSS border itself spanning ~DPR device rows) — so search a small window
      // around the expected position for the brightest row (the rule, over a dark backdrop,
      // reads BRIGHTER than its surroundings) rather than assume exact row alignment.
      const searchRadius = Math.ceil(3 * DPR);
      let atMax = -Infinity;
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        atMax = Math.max(atMax, stripLuminance(png, ruleY + dy, 1));
      }
      // Baselines well clear of the search window on both sides: inside the ordinary gap above
      // (no border there) and inside the Total row's own content band below (past the divider's
      // padding) — same translucent card over the same dark bar, just with no rule.
      const before = stripLuminance(png, ruleY - searchRadius - Math.round(2 * DPR), 2);
      const after = stripLuminance(png, ruleY + searchRadius + Math.round(3 * DPR), 2);

      const deltaBefore = Math.abs(atMax - before);
      const deltaAfter = Math.abs(atMax - after);
      // A perceptible line reads as a local luminance spike relative to BOTH neighbours — the
      // exact property a computed border-color can't tell you. 8/255 is a conservative floor
      // against the measured ~35/255 spike this fix produces here (see the fix report for the
      // full measurement, including where an opaque near-white rule DOES and does not disappear —
      // it is not simply "dark backdrops hide it").
      expect(deltaBefore).toBeGreaterThan(8);
      expect(deltaAfter).toBeGreaterThan(8);
    } finally {
      await page.close();
    }
  }, 30000);
}

describe.skipIf(!HAS_BROWSER)("barStack.total bold + divider — visible against a dark bar (real browser)", () => {
  verifyVisibleDivider("explicit total: { bold: true, divider: true }", SPEC_EXPLICIT);
  verifyVisibleDivider("NO barStack.total block at all (the default)", SPEC_DEFAULT);
});
