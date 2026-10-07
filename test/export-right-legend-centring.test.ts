// A right-hand legend column taller than the plot: live CENTRES the canvas (the plot with its x-axis
// title directly under it) against the column — `.figure-body--legend-right { align-items: center }`
// in styles.ts — and the PNG must place them the same way. The export re-renders from the spec, so
// it computes the same centring offset from its own measured column (F14 fix round 2; Codex F14).
// Before, it top-aligned the plot and put the x-axis title below the legend.
//
// Both layouts are built in ONE real page (Chromium), so the live column and the export's measured
// column wrap their labels with the same fonts and the same text measurement.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { EXPORT_BUNDLE_PATH } from "./setup/global-build";
import { CHART_CSS } from "../src/embed/styles";
import { INNER_W } from "../src/embed/figure-chrome";
import { LEGEND_COLUMN_WIDTH, LEGEND_GAP } from "../src/engine/legend-layout";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const HAS_BROWSER = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

// Real Chromium under parallel suite load: see test/tooltip-divider-visibility.test.ts.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const CHART_W = INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP;

// The two Codex repros (test/export-right-legend-plot-height.test.ts), each given an x-axis title.
const STACKED = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "T",
  xAxisType: "categorical",
  x_axis_title: "Dollars",
  columns: { x: "g", value: "v", series: "s" },
  note: "n",
  source: "s",
  data: "d.csv",
} as unknown as ChartSpec;
const STACKED_ROWS = Array.from({ length: 30 }, (_, i) => ({ g: "Group", s: `Series ${i}`, v: String(i + 1) })) as unknown as TidyRow[];

const LONG_A = "Cash income " + "Long descriptive label ".repeat(8);
const LONG_B = "Accrual income " + "Long descriptive label ".repeat(8);
const DUMBBELL = {
  chartType: "dumbbell",
  orientation: "horizontal",
  legendPosition: "right",
  title: "T",
  xAxisType: "categorical",
  x_axis_title: "Percent",
  columns: { category: "c", series: "m", value: "v" },
  series_order: [LONG_A, LONG_B],
  note: "n",
  data: "d.csv",
} as unknown as ChartSpec;
const DUMBBELL_ROWS = Array.from({ length: 7 }, (_, i) => [
  { c: `Group ${i + 1}`, m: LONG_A, v: String(20 + i) },
  { c: `Group ${i + 1}`, m: LONG_B, v: String(8 + i) },
]).flat() as unknown as TidyRow[];

// Not tall in a real browser: the repro's column outgrew the plot only under jsdom's fallback text
// measurement. Four such series make a dumbbell whose column is taller in both layouts.
const DUMBBELL_TALL = {
  ...DUMBBELL,
  series_order: ["A", "B", "C", "D"].map((k) => `${k} ${LONG_A}`),
} as unknown as ChartSpec;
const DUMBBELL_TALL_ROWS = Array.from({ length: 7 }, (_, i) =>
  ["A", "B", "C", "D"].map((k, j) => ({ c: `Group ${i + 1}`, m: `${k} ${LONG_A}`, v: String(8 + 4 * j + i) })),
).flat() as unknown as TidyRow[];

interface Geometry {
  /** Plot top, below the top of the region the plot and legend column share. */
  plotOffset: number;
  plotHeight: number;
  /** The x-axis title's first baseline, below the plot's bottom edge. */
  titleBelowPlot: number;
  /** The legend column's height. */
  legendHeight: number;
  /** The region the canvas is centred in (live: the flex row; PNG: from the column's top to the
   *  note), and the canvas: the plot plus its x-axis title (live: the scroll box; PNG: the plot plus
   *  the title's 14px band). */
  regionHeight: number;
  canvasHeight: number;
}

let browser: Browser;
beforeAll(async () => {
  if (HAS_BROWSER) browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

/** Live and export geometry for one spec, measured in the same page. */
async function measure(spec: ChartSpec, rows: TidyRow[]): Promise<{ live: Geometry; png: Geometry }> {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<!doctype html><html><head><style>${CHART_CSS}</style></head><body style="margin:0;background:#fff">` +
        `<div id="chart" style="width:${INNER_W}px"></div>` +
        `<script>${readFileSync(EXPORT_BUNDLE_PATH, "utf8")}</script></body></html>`,
      { waitUntil: "load" },
    );
    return await page.evaluate(
      ({ spec, rows, width, chartW, colW }) => {
        const w = window as unknown as {
          BudgetLabExport: {
            mountChart: (el: Element, opts: unknown) => void;
            buildExportSvg: (spec: unknown, rows: unknown) => SVGSVGElement;
          };
        };
        // --- live ---
        w.BudgetLabExport.mountChart(document.getElementById("chart")!, { spec, rows, width });
        const box = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(`live: no ${sel}`);
          return el.getBoundingClientRect();
        };
        const body = box(".figure-body--legend-right");
        const svg = box(".figure-canvas svg");
        const canvas = box(".figure-canvas-scroll");
        const legend = box(".figure-legend-slot--right .tbl-legend");
        // The title's first baseline: a zero-height inline-block sits ON the baseline.
        const titleEl = document.querySelector(".figure-x-axis-title")!;
        const probe = document.createElement("span");
        probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
        titleEl.insertBefore(probe, titleEl.firstChild);
        const titleBaseline = probe.getBoundingClientRect().bottom;
        const live = {
          plotOffset: svg.top - body.top,
          plotHeight: svg.height,
          titleBelowPlot: titleBaseline - svg.bottom,
          legendHeight: legend.height,
          regionHeight: body.height,
          canvasHeight: canvas.height,
        };

        // --- PNG export ---
        const root = w.BudgetLabExport.buildExportSvg(spec, rows);
        const chart = Array.from(root.querySelectorAll("svg")).find((s) => Number(s.getAttribute("width")) === chartW)!;
        const plotY = Number(chart.getAttribute("y"));
        const plotH = Number(chart.getAttribute("height"));
        const colX = Number(chart.getAttribute("x")) + chartW + colW;
        const topTexts = Array.from(root.querySelectorAll("text")).filter((t) => t.closest("svg") === root);
        const legendYs = topTexts.filter((t) => Number(t.getAttribute("x")) >= colX).map((t) => Number(t.getAttribute("y")));
        // The column's first baseline is 12px below the region's top (export-png.ts COL_TOP).
        const regionTop = Math.min(...legendYs) - 12;
        const title = topTexts.find((t) => t.textContent === (spec as { x_axis_title: string }).x_axis_title)!;
        // The note's first baseline is 18px below the region (figure-chrome.ts composeBottomChrome).
        const noteBaseline = Number(topTexts.find((t) => t.textContent === "n")!.getAttribute("y"));
        const png = {
          plotOffset: plotY - regionTop,
          plotHeight: plotH,
          titleBelowPlot: Number(title.getAttribute("y")) - (plotY + plotH),
          legendHeight: Math.max(...legendYs) - regionTop,
          regionHeight: noteBaseline - 18 - regionTop,
          canvasHeight: plotH + 14,
        };
        return { live, png };
      },
      { spec, rows, width: INNER_W, chartW: CHART_W, colW: LEGEND_GAP },
    );
  } finally {
    await page.close();
  }
}

describe.skipIf(!HAS_BROWSER)("a tall right-hand legend: the PNG centres the plot against it, as live does", () => {
  const cases: [string, ChartSpec, TidyRow[], boolean][] = [
    ["horizontal stacked, 30 series in one category", STACKED, STACKED_ROWS, true],
    ["horizontal dumbbell, two very long series labels", DUMBBELL, DUMBBELL_ROWS, false],
    ["horizontal dumbbell, four very long series labels", DUMBBELL_TALL, DUMBBELL_TALL_ROWS, true],
  ];
  for (const [name, spec, rows, tall] of cases) {
    it(`${name}: plot offset and x-axis title position match live`, async () => {
      const { live, png } = await measure(spec, rows);
      const why = JSON.stringify({ live, png });
      // Precondition (non-vacuity): whether the column outgrows the plot, the same in both layouts.
      expect(live.legendHeight > live.plotHeight + 20, `live: ${why}`).toBe(tall);
      expect(png.legendHeight > png.plotHeight + 20, `PNG: ${why}`).toBe(tall);
      // Live centres the canvas in the region (offset 0 when the canvas is the taller); the PNG
      // applies the same rule to its own region.
      if (tall) expect(live.plotOffset, why).toBeGreaterThan(50);
      expect(live.plotOffset, why).toBeCloseTo((live.regionHeight - live.canvasHeight) / 2, 3);
      expect(png.plotOffset, why).toBeCloseTo((png.regionHeight - png.canvasHeight) / 2, 3);
      // The PNG draws its own column (rows on a 16+8px pitch, wrapped by the same canvas text
      // measurement), so its region can differ from live's; the offsets differ by half that, no more.
      const slack = Math.abs(png.regionHeight - png.canvasHeight - (live.regionHeight - live.canvasHeight)) / 2;
      expect(Math.abs(png.plotOffset - live.plotOffset), why).toBeLessThanOrEqual(slack + 0.01);
      if (tall) expect(slack, why).toBeLessThanOrEqual(20);
      // The x-axis title stays directly under the plot, not below the legend: 14px below it, as the
      // PNG draws it on every chart (live's CSS puts it 5px nearer, tall legend or not).
      expect(png.titleBelowPlot, why).toBe(14);
      expect(live.titleBelowPlot, why).toBe(9);
    });
  }
});
