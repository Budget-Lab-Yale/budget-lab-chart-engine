// @vitest-environment jsdom
//
// Faceted coverage for the truncated-axis clip (see test/mark-clip.test.ts for the single-frame
// cases). Two shapes of "faceted" exist and they clip differently:
//
//   1. fx/fy facets INSIDE one plot — grouped vertical bars (fx per category) and horizontal bars
//      (fy per category). Plot emits ONE cell-sized clipPath and lets each facet group's translate
//      move it, so the clip must be verified per cell, not per SVG.
//   2. small_multiples — both modes are per-pane compositions (each pane its own single-frame SVG,
//      see FacetInfo's DORMANT note), so each pane hits the single-frame clip path independently and
//      only the panes whose data exceeds the domain are clipped.
//
// The jsdom assertions can only prove the clip-path attributes are wired. Whether the geometry is
// actually clipped — and clipped to the right CELL rather than to the whole frame — needs a real
// renderer, so the last block rasterizes through headless Chromium and counts bar-colored pixels.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { renderChart, renderFigure } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const HAS_BROWSER = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const CATS = ["Alpha", "Beta", "Gamma"];
const SERIES = ["2019", "2022"];

/** Grouped bars: `Beta` blows through any sane ceiling, the other two sit well inside it. */
function groupedRows(spike = 200): TidyRow[] {
  const out: Array<Record<string, string>> = [];
  for (const cat of CATS) {
    for (const [i, series] of SERIES.entries()) {
      out.push({ cat, series, value: String(cat === "Beta" ? spike + i * 10 : 20 + i * 5) });
    }
  }
  return out as unknown as TidyRow[];
}

const GROUPED_BAR = {
  chartType: "bar",
  title: "grouped",
  xAxisType: "categorical",
  series_order: SERIES,
  columns: { x: "cat", value: "value", series: "series" },
} as unknown as ChartSpec;

/** Small multiples: pane B spikes at 2021, pane A stays flat and low. */
function facetRows(spike = 90): TidyRow[] {
  const out: Array<Record<string, string>> = [];
  for (const facet of ["A", "B"]) {
    for (const t of [2020, 2021, 2022]) {
      out.push({
        time: String(t),
        series: "S",
        facet,
        value: String(facet === "B" && t === 2021 ? spike : 10),
      });
    }
  }
  return out as unknown as TidyRow[];
}

const SM_LINE = {
  chartType: "line",
  title: "sm",
  xAxisType: "numeric",
  columns: { x: "time", value: "value", series: "series", facet: "facet" },
} as unknown as ChartSpec;

// ---------------------------------------------------------------------------
// 1. fx/fy facets inside one plot (grouped + horizontal bars)
// ---------------------------------------------------------------------------

describe("fx facets (grouped vertical bars) — truncated value axis", () => {
  const spec = { ...GROUPED_BAR, yAxisPolicy: { min: 0, max: 40 } } as ChartSpec;

  it("clips every facet group through ONE cell-sized clipPath", () => {
    const { svg } = renderChart(spec, groupedRows(), { width: 720, height: 400, document });
    const defs = Array.from(svg.querySelectorAll("clipPath"));
    expect(defs.length).toBe(1);
    const clipped = Array.from(svg.querySelectorAll('g[aria-label="bar"] [clip-path]'));
    expect(clipped.length).toBe(CATS.length);
    const ref = `url(#${defs[0]!.getAttribute("id")})`;
    for (const g of clipped) expect(g.getAttribute("clip-path")).toBe(ref);
  });

  it("sizes the clip rect to ONE facet cell, not the whole plot", () => {
    const { svg } = renderChart(spec, groupedRows(), { width: 720, height: 400, document });
    const clipW = Number(svg.querySelector("clipPath rect")!.getAttribute("width"));
    // Cell pitch straight off the facet-group translates. The rect must be about one cell wide (it
    // is a little narrower — facet padding); a whole-frame rect would be ~3 pitches.
    const xs = Array.from(svg.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g'))
      .map((g) => Number(/translate\(\s*([\d.+-]+)/.exec(g.getAttribute("transform") ?? "")?.[1]))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    expect(xs.length).toBe(CATS.length);
    const pitch = xs[1]! - xs[0]!;
    expect(clipW).toBeLessThanOrEqual(pitch);
    expect(clipW).toBeGreaterThan(pitch / 2);
  });

  it("keeps the clip INSIDE each facet group, so the group translates still drive it", () => {
    const { svg } = renderChart(spec, groupedRows(), { width: 720, height: 400, document });
    // One cell-sized rect shared by every cell only lands correctly because each facet group's
    // own transform moves it — so the clip must sit on (or under) the translated group.
    for (const g of Array.from(svg.querySelectorAll('g[aria-label="bar"] [clip-path]'))) {
      const ownT = g.getAttribute("transform");
      const parentT = (g.parentElement as Element | null)?.getAttribute("transform");
      expect(ownT ?? parentT).toMatch(/translate\(/);
    }
  });

  it("leaves the facet-group structure crosshair code reads unchanged", () => {
    // crosshair.ts resolves category bands via `g[aria-label="bar"] > g` + a translate transform.
    // Plot nests the clip wrapper INSIDE each facet group, so this must still see one translated
    // group per category on a clipped chart exactly as on an unclipped one.
    const clippedSvg = renderChart(spec, groupedRows(), { width: 720, height: 400, document }).svg;
    const plainSvg = renderChart(GROUPED_BAR, groupedRows(20), {
      width: 720,
      height: 400,
      document,
    }).svg;
    const transforms = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g'))
        .map((g) => g.getAttribute("transform"))
        .filter((t): t is string => !!t && t.includes("translate("));
    expect(transforms(clippedSvg).length).toBe(CATS.length);
    expect(transforms(clippedSvg)).toEqual(transforms(plainSvg));
  });

  it("does not clip when the domain covers every group", () => {
    const wide = { ...GROUPED_BAR, yAxisPolicy: { min: 0, max: 300 } } as ChartSpec;
    const { svg } = renderChart(wide, groupedRows(), { width: 720, height: 400, document });
    expect(svg.querySelectorAll("clipPath").length).toBe(0);
  });
});

describe("fy facets (grouped horizontal bars) — truncated value axis", () => {
  const base = { ...GROUPED_BAR, orientation: "horizontal" } as ChartSpec;

  it("clips every fy facet group through one cell-sized clipPath", () => {
    const spec = { ...base, yAxisPolicy: { min: 0, max: 40 } } as ChartSpec;
    const { svg } = renderChart(spec, groupedRows(), { width: 720, height: 400, document });
    expect(svg.querySelectorAll("clipPath").length).toBe(1);
    expect(svg.querySelectorAll('g[aria-label="bar"] [clip-path]').length).toBe(CATS.length);
    const rect = svg.querySelector("clipPath rect")!;
    // Horizontal: the cells stack vertically, so it is the HEIGHT that is one cell tall.
    expect(Number(rect.getAttribute("height"))).toBeLessThan(400 / 2);
  });

  it("clips a raised floor on the horizontal value axis (which runs along x)", () => {
    const spec = { ...base, yAxisPolicy: { min: 15, max: 40 } } as ChartSpec;
    const { svg } = renderChart(spec, groupedRows(30), { width: 720, height: 400, document });
    expect(svg.querySelectorAll("clipPath").length).toBe(1);
  });

  it("does not clip when the domain covers every group", () => {
    const spec = { ...base, yAxisPolicy: { min: 0, max: 300 } } as ChartSpec;
    const { svg } = renderChart(spec, groupedRows(), { width: 720, height: 400, document });
    expect(svg.querySelectorAll("clipPath").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. small_multiples (per-pane composition in BOTH modes)
// ---------------------------------------------------------------------------

describe("small multiples — shared mode", () => {
  const opts = { width: 720, height: 400, document };
  const shared = (yAxisPolicy?: Record<string, number>) =>
    ({
      ...SM_LINE,
      small_multiples: { columns: 2, mode: "shared" },
      ...(yAxisPolicy ? { yAxisPolicy } : {}),
    }) as unknown as ChartSpec;

  const clipOf = (svg: SVGSVGElement | undefined) =>
    svg?.querySelector('g[aria-label="line"]')?.getAttribute("clip-path") ?? null;

  it("clips only the pane whose data exceeds the shared domain", () => {
    const fig = renderFigure(shared({ min: 0, max: 20 }), facetRows(), opts);
    expect(fig.panes.length).toBe(2);
    const byValue = new Map(fig.panes.map((p) => [p.value, clipOf(p.svg)]));
    expect(byValue.get("A")).toBeNull();
    expect(byValue.get("B")).toMatch(/^url\(#/);
  });

  it("clips no pane when the shared domain covers every pane", () => {
    const fig = renderFigure(shared({ min: 0, max: 100 }), facetRows(), opts);
    for (const p of fig.panes) expect(clipOf(p.svg)).toBeNull();
  });

  it("clips no pane on an auto shared domain (the domain is fitted to the data)", () => {
    const fig = renderFigure(shared(), facetRows(), opts);
    for (const p of fig.panes) expect(clipOf(p.svg)).toBeNull();
  });

  it("gives each clipped pane its own clipPath id (panes are separate SVGs)", () => {
    const fig = renderFigure(shared({ min: 0, max: 5 }), facetRows(), opts);
    const refs = fig.panes.map((p) => clipOf(p.svg));
    for (const r of refs) expect(r).toMatch(/^url\(#/);
    expect(new Set(refs).size).toBe(refs.length);
    for (const p of fig.panes) expect(p.svg!.querySelectorAll("clipPath").length).toBe(1);
  });
});

describe("small multiples — per-pane mode", () => {
  const opts = { width: 720, height: 400, document };

  it("clips the overflowing pane when a global policy truncates it", () => {
    const spec = {
      ...SM_LINE,
      small_multiples: { columns: 2, mode: "per-pane" },
      yAxisPolicy: { min: 0, max: 20 },
    } as unknown as ChartSpec;
    const fig = renderFigure(spec, facetRows(), opts);
    expect(fig.mode).toBe("per-pane");
    const byValue = new Map(
      fig.panes.map((p) => [
        p.value,
        p.svg?.querySelector('g[aria-label="line"]')?.getAttribute("clip-path") ?? null,
      ]),
    );
    expect(byValue.get("A")).toBeNull();
    expect(byValue.get("B")).toMatch(/^url\(#/);
  });

  it("clips nothing when each pane fits its own auto domain", () => {
    const spec = {
      ...SM_LINE,
      small_multiples: { columns: 2, mode: "per-pane" },
    } as unknown as ChartSpec;
    const fig = renderFigure(spec, facetRows(), opts);
    for (const p of fig.panes) {
      expect(p.svg!.querySelectorAll("clipPath").length).toBe(0);
    }
  });
});

describe("faceted bar panes (small multiples of bars) — truncated axis", () => {
  it("clips the overflowing pane's bars", () => {
    const rows: Array<Record<string, string>> = [];
    for (const facet of ["A", "B"]) {
      for (const cat of ["x", "y"]) {
        rows.push({ cat, facet, series: "S", value: String(facet === "B" ? 300 : 12) });
      }
    }
    const spec = {
      chartType: "bar",
      title: "sm bars",
      xAxisType: "categorical",
      columns: { x: "cat", value: "value", series: "series", facet: "facet" },
      small_multiples: { columns: 2, mode: "shared" },
      yAxisPolicy: { min: 0, max: 20 },
    } as unknown as ChartSpec;
    const fig = renderFigure(spec, rows as unknown as TidyRow[], {
      width: 720,
      height: 400,
      document,
    });
    const clips = new Map(fig.panes.map((p) => [p.value, p.svg!.querySelectorAll("clipPath").length]));
    expect(clips.get("A")).toBe(0);
    expect(clips.get("B")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Rasterized proof: the clip actually clips, per CELL
// ---------------------------------------------------------------------------

/** Count pixels exactly matching any of `colors`, split at `splitY`, bucketed into `buckets`
 *  equal-width columns. Exact match is safe: bars are flat fills, so interiors are unblended. */
function countInk(
  png: { width: number; height: number; data: Buffer },
  colors: Array<[number, number, number]>,
  splitY: number,
  buckets: number,
): { above: number; belowByBucket: number[] } {
  const want = new Set(colors.map(([r, g, b]) => (r << 16) | (g << 8) | b));
  const belowByBucket = new Array(buckets).fill(0);
  let above = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i + 3]! < 200) continue;
      if (!want.has((png.data[i]! << 16) | (png.data[i + 1]! << 8) | png.data[i + 2]!)) continue;
      if (y < splitY) above++;
      else belowByBucket[Math.min(buckets - 1, Math.floor((x / png.width) * buckets))]!++;
    }
  }
  return { above, belowByBucket };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

describe.skipIf(!HAS_BROWSER)("rasterized — faceted clip confines marks to their own cell", () => {
  /** Serialize an SVG, rasterize it 1:1 in Chromium, and decode the PNG. */
  async function raster(svg: SVGSVGElement) {
    const { PNG } = await import("pngjs");
    const markup = new XMLSerializer().serializeToString(svg);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 600 },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<body style="margin:0;background:#fff">${markup}</body>`,
        { waitUntil: "load" },
      );
      const shot = (await page.locator("svg").first().screenshot({ type: "png" })) as Buffer;
      return PNG.sync.read(shot);
    } finally {
      await browser.close();
    }
  }

  /** The distinct bar fills actually rendered, read off the DOM (palette-resolved). */
  function barFills(svg: SVGSVGElement): Array<[number, number, number]> {
    const out = new Set<string>();
    for (const rect of Array.from(svg.querySelectorAll('g[aria-label="bar"] rect'))) {
      const own = rect.getAttribute("fill");
      const inherited = (rect.closest("[fill]") as Element | null)?.getAttribute("fill");
      const fill = own ?? inherited;
      if (fill && fill.startsWith("#")) out.add(fill);
    }
    return Array.from(out).map(hexToRgb);
  }

  it("grouped bars: no ink above the frame, and every cell still paints", async () => {
    const spec = { ...GROUPED_BAR, yAxisPolicy: { min: 0, max: 40 } } as ChartSpec;
    const { svg } = renderChart(spec, groupedRows(), { width: 720, height: 400, document });
    const frameTop = Number(svg.getAttribute("data-margin-top"));
    expect(frameTop).toBeGreaterThan(0);
    const fills = barFills(svg);
    expect(fills.length).toBeGreaterThan(0);

    const png = await raster(svg);
    const { above, belowByBucket } = countInk(png, fills, frameTop, CATS.length);
    // Beta's bars run to y = -1422 in the markup; nothing may survive above the frame.
    expect(above).toBe(0);
    // All three cells keep their bars — a clip rect resolved in the WRONG space would blank the
    // translated cells instead of trimming them.
    for (const [i, n] of belowByBucket.entries()) {
      expect(n, `cell ${i} (${CATS[i]}) has no bar ink`).toBeGreaterThan(0);
    }
    // Beta is clipped flush to the ceiling, so its cell paints the most ink of the three.
    expect(belowByBucket[1]).toBeGreaterThan(belowByBucket[0]!);
    expect(belowByBucket[1]).toBeGreaterThan(belowByBucket[2]!);
  }, 60_000);

  it("dumbbell: the runaway dot is trimmed at the frame, and the in-range dots survive", async () => {
    // Unclipped, this spec put a dot at cx ≈ 2849 on a 720px canvas. Count DOT-colored ink to the
    // right of the frame — geometry alone can't prove the clip renders, only that it's attached.
    const spec = {
      chartType: "dumbbell",
      title: "db",
      xAxisType: "categorical",
      orientation: "horizontal",
      series_order: ["Current", "Proposed"],
      columns: { category: "cat", value: "value", series: "series" },
      yAxisPolicy: { min: 0, max: 20 },
    } as unknown as ChartSpec;
    const rows = [
      { cat: "A", series: "Current", value: "5" },
      { cat: "A", series: "Proposed", value: "12" },
      { cat: "B", series: "Current", value: "8" },
      { cat: "B", series: "Proposed", value: "85" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(svg.querySelectorAll("clipPath").length).toBe(1);

    const fills = new Set<string>();
    for (const c of Array.from(svg.querySelectorAll('g[aria-label="dot"] circle'))) {
      const f = c.getAttribute("fill");
      if (f && f.startsWith("#")) fills.add(f);
    }
    expect(fills.size).toBeGreaterThan(0);
    const colors = Array.from(fills).map(hexToRgb);

    const png = await raster(svg);
    // Split at the frame's RIGHT edge: everything past it must be empty of dot ink. countInk splits
    // on y, so transpose the question by bucketing across x and reading the far bucket.
    const frameRight = 720 - 16;
    let beyond = 0;
    let inside = 0;
    const want = new Set(colors.map(([r, g, b]) => (r << 16) | (g << 8) | b));
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i + 3]! < 200) continue;
        if (!want.has((png.data[i]! << 16) | (png.data[i + 1]! << 8) | png.data[i + 2]!)) continue;
        if (x > frameRight) beyond++;
        else inside++;
      }
    }
    expect(beyond).toBe(0);
    expect(inside).toBeGreaterThan(0);
  }, 60_000);

  it("positive control: an AREA chart is not wired to clipMarks and DOES leak above the frame", async () => {
    // Guards the detector above: if `above` could never be non-zero, that assertion proves nothing.
    // Doubles as a live record of the unwired chart types (see MarkContext.clipMarks).
    const spec = {
      chartType: "area",
      title: "area",
      xAxisType: "numeric",
      series_order: ["S"],
      columns: { x: "time", value: "value", series: "series" },
      yAxisPolicy: { min: 0, max: 20 },
    } as unknown as ChartSpec;
    const rows = [
      { time: "2020", series: "S", value: "10" },
      { time: "2021", series: "S", value: "95" },
      { time: "2022", series: "S", value: "12" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(svg.querySelectorAll("clipPath").length).toBe(0);
    const frameTop = Number(svg.getAttribute("data-margin-top"));
    const fills = new Set<string>();
    for (const p of Array.from(svg.querySelectorAll('g[aria-label="area"] path'))) {
      const f = p.getAttribute("fill") ?? (p.parentElement as Element | null)?.getAttribute("fill");
      if (f && f.startsWith("#")) fills.add(f);
    }
    expect(fills.size).toBeGreaterThan(0);
    const png = await raster(svg);
    const { above } = countInk(png, Array.from(fills).map(hexToRgb), frameTop, 1);
    expect(above).toBeGreaterThan(0);
  }, 60_000);
});
