// @vitest-environment jsdom
//
// Golden-SVG parity + determinism gate for the histogram chart type. Each case builds a spec +
// deterministic synthetic rows, renders through the headless engine (renderChart / renderFigure)
// under jsdom, asserts structural facts, and locks the resulting SVG to a committed baseline. The
// baseline is the visual contract: any engine change that alters a known histogram's output fails
// here until the baseline is deliberately regenerated (`vitest -u`) and reviewed.
//
// Mirrors the harness in test/golden.test.ts (same parse-free synthetic rows, same
// toMatchFileSnapshot idiom, same serializePanes helper for figures). No CSV fixtures: the rows are
// inline TidyRow[] so the data is self-contained and obviously deterministic.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../../src/engine/index";
import type { FigureRenderResult } from "../../src/engine/index";
import type { ChartSpec } from "../../src/spec/types";
import type { TidyRow } from "../../src/data/index";

// Serialize every pane of a figure into one stable string (label comment + SVG), matching the
// helper used by the figure goldens in test/golden.test.ts.
function serializePanes(fig: FigureRenderResult): string {
  return fig.panes
    .map((p) => `<!-- pane: ${p.value} (${p.title}) -->\n${(p.svg as SVGSVGElement).outerHTML}`)
    .join("\n\n");
}

// Build raw single-value rows (the `time` column holds the x value the engine bins).
function rawRows(values: number[], series?: string[]): TidyRow[] {
  return values.map((v, i) => {
    const row: Record<string, string> = { time: String(v) };
    if (series) row.series = series[i]!;
    return row as TidyRow;
  });
}

// --- Case 1: single-series numeric histogram (raw binning) ---

const SINGLE_SPEC: ChartSpec = {
  chartType: "histogram",
  title: "Distribution of scores",
  subtitle: "Count",
  xAxisType: "numeric",
  data: "synthetic",
  // Explicit domain + binWidth ⇒ fully deterministic edges 0,10,20,30,40,50 (5 bins).
  histogram: { binWidth: 10, domain: [0, 50] },
};

// Values chosen so bin counts are 2,4,6,4,2 across [0,10),[10,20),[20,30),[30,40),[40,50].
const SINGLE_VALUES = [
  3, 7,
  11, 13, 15, 17,
  21, 23, 25, 25, 27, 29,
  31, 33, 35, 37,
  41, 43,
];

// --- Case 2: overlapping multi-series numeric histogram ---

const OVERLAP_SPEC: ChartSpec = {
  chartType: "histogram",
  title: "Two overlaid distributions",
  subtitle: "Count",
  xAxisType: "numeric",
  data: "synthetic",
  series_order: ["A", "B"],
  histogram: { binWidth: 10, domain: [0, 50] },
};

// A: 1,3,5,3,1  B: 2,4,2,1,0 (B's last bin is empty → preserved as a 0-height bin).
const OVERLAP_A = [3, 11, 13, 15, 21, 23, 25, 27, 29, 31, 33, 35, 41];
const OVERLAP_B = [3, 7, 11, 13, 15, 17, 21, 23, 31];
const OVERLAP_ROWS: TidyRow[] = [
  ...rawRows(OVERLAP_A, OVERLAP_A.map(() => "A")),
  ...rawRows(OVERLAP_B, OVERLAP_B.map(() => "B")),
];

// --- Case 3: faceted histogram, shared mode (two panes, shared thresholds) ---

const FACETED_SPEC: ChartSpec = {
  chartType: "histogram",
  title: "Distribution by region",
  subtitle: "Count",
  xAxisType: "numeric",
  data: "synthetic",
  columns: { x: "time", value: "value", facet: "region" },
  small_multiples: { columns: 2, mode: "shared", pane_order: ["East", "West"] },
  histogram: { binWidth: 10, domain: [0, 50] },
};

function facetRows(values: number[], region: string): TidyRow[] {
  return values.map((v) => ({ time: String(v), region }) as TidyRow);
}
const FACETED_ROWS: TidyRow[] = [
  ...facetRows([3, 7, 11, 13, 15, 21, 23, 25, 27, 35], "East"),
  ...facetRows([5, 15, 17, 19, 25, 33, 35, 37, 41, 43], "West"),
];

// --- Case 4: temporal histogram, month binning ---

const TEMPORAL_SPEC: ChartSpec = {
  chartType: "histogram",
  title: "Events per month",
  subtitle: "Count",
  xAxisType: "temporal",
  data: "synthetic",
  histogram: { binWidth: "month" },
};

// Dates spanning 2024-01 .. 2024-04; counts 2,3,1,2 by month.
const TEMPORAL_DATES = [
  "2024-01-05", "2024-01-20",
  "2024-02-03", "2024-02-14", "2024-02-28",
  "2024-03-10",
  "2024-04-02", "2024-04-25",
];
const TEMPORAL_ROWS: TidyRow[] = TEMPORAL_DATES.map((d) => ({ time: d }) as TidyRow);

// --- Case 5: pre-binned histogram (x0/x1 edges read directly) ---

const PREBINNED_SPEC: ChartSpec = {
  chartType: "histogram",
  title: "Pre-binned distribution",
  subtitle: "Share",
  xAxisType: "numeric",
  data: "synthetic",
  columns: { x0: "lo", x1: "hi", value: "count" },
};

// Explicit, uneven edges to prove they render as given (not re-derived by the engine).
const PREBINNED_ROWS: TidyRow[] = [
  { lo: "0", hi: "10", count: "5" },
  { lo: "10", hi: "25", count: "12" },
  { lo: "25", hi: "30", count: "8" },
  { lo: "30", hi: "60", count: "3" },
] as unknown as TidyRow[];

// Absolute x/width of every histogram <rect>, in document order, resolving the group transform.
function rectSpans(svg: SVGSVGElement): { x: number; w: number }[] {
  const groups = Array.from(svg.querySelectorAll('g[aria-label="rect"]'));
  const out: { x: number; w: number }[] = [];
  for (const g of groups) {
    const tf = g.getAttribute("transform");
    const m = tf ? /translate\(\s*(-?[\d.]+)/.exec(tf) : null;
    const tx = m ? Number(m[1]) : 0;
    for (const r of Array.from(g.querySelectorAll("rect"))) {
      out.push({ x: tx + Number(r.getAttribute("x")), w: Number(r.getAttribute("width")) });
    }
  }
  return out;
}

describe("golden SVG — histogram", () => {
  it("single-series numeric: 5 edge-to-edge bars", async () => {
    const { svg } = renderChart(SINGLE_SPEC, rawRows(SINGLE_VALUES), {
      width: 720,
      height: 400,
      document,
    });
    const rects = svg.querySelectorAll('g[aria-label="rect"] rect');
    expect(rects.length).toBe(5);
    // Adjacent bars touch: each bar's right edge meets the next bar's left edge (no gap/overlap).
    const spans = rectSpans(svg).sort((a, b) => a.x - b.x);
    expect(spans.length).toBe(5);
    for (let i = 1; i < spans.length; i++) {
      const prevRight = spans[i - 1]!.x + spans[i - 1]!.w;
      expect(Math.abs(spans[i]!.x - prevRight)).toBeLessThan(0.5);
    }
    await expect(svg.outerHTML).toMatchFileSnapshot("../fixtures/histogram-single.golden.svg");
  });

  it("overlapping multi-series: translucent bars (fill-opacity < 1)", async () => {
    const { svg, legendItems } = renderChart(OVERLAP_SPEC, OVERLAP_ROWS, {
      width: 720,
      height: 400,
      document,
    });
    expect(legendItems?.map((l) => l.series)).toEqual(["A", "B"]);
    // 2 series × 5 bins = 10 rects (empty bins preserved as zero-height rects).
    const rects = Array.from(svg.querySelectorAll('g[aria-label="rect"] rect'));
    expect(rects.length).toBe(10);
    const ops = rects.map((r) => Number(r.getAttribute("fill-opacity") ?? "1"));
    expect(ops.every((o) => o < 1)).toBe(true);
    await expect(svg.outerHTML).toMatchFileSnapshot("../fixtures/histogram-overlap.golden.svg");
  });

  it("faceted (shared mode): two panes with a shared x-domain", async () => {
    const fig = renderFigure(FACETED_SPEC, FACETED_ROWS, { width: 900, document });
    expect(fig.panes.length).toBe(2);
    expect(fig.panes.map((p) => p.value)).toEqual(["East", "West"]);
    // Each pane bins to the SAME 5 shared thresholds ⇒ 5 rects per pane.
    for (const p of fig.panes) {
      expect((p.svg as SVGSVGElement).querySelectorAll('g[aria-label="rect"] rect').length).toBe(5);
    }
    const a = serializePanes(fig);
    const b = serializePanes(renderFigure(FACETED_SPEC, FACETED_ROWS, { width: 900, document }));
    expect(a).toBe(b);
    await expect(a).toMatchFileSnapshot("../fixtures/histogram-faceted-shared.golden.svg");
  });

  it("temporal (month binning): one bar per month, edge-to-edge", async () => {
    const { svg } = renderChart(TEMPORAL_SPEC, TEMPORAL_ROWS, {
      width: 720,
      height: 400,
      document,
    });
    // Jan..Apr 2024 → 4 month bins.
    const rects = svg.querySelectorAll('g[aria-label="rect"] rect');
    expect(rects.length).toBe(4);
    const spans = rectSpans(svg).sort((a, b) => a.x - b.x);
    for (let i = 1; i < spans.length; i++) {
      const prevRight = spans[i - 1]!.x + spans[i - 1]!.w;
      expect(Math.abs(spans[i]!.x - prevRight)).toBeLessThan(0.5);
    }
    await expect(svg.outerHTML).toMatchFileSnapshot("../fixtures/histogram-temporal-month.golden.svg");
  });

  it("pre-binned: renders the given edges directly (4 uneven bars)", async () => {
    const { svg } = renderChart(PREBINNED_SPEC, PREBINNED_ROWS, {
      width: 720,
      height: 400,
      document,
    });
    const rects = svg.querySelectorAll('g[aria-label="rect"] rect');
    expect(rects.length).toBe(4);
    // Uneven pre-binned widths: bars are proportional to (hi-lo) = 10,15,5,30 and still touch.
    const spans = rectSpans(svg).sort((a, b) => a.x - b.x);
    expect(spans.length).toBe(4);
    for (let i = 1; i < spans.length; i++) {
      const prevRight = spans[i - 1]!.x + spans[i - 1]!.w;
      expect(Math.abs(spans[i]!.x - prevRight)).toBeLessThan(0.5);
    }
    // Widths follow the given edge ratios (10:15:5:30), not equal bins.
    const ws = spans.map((s) => s.w);
    expect(ws[1]! / ws[0]!).toBeCloseTo(1.5, 1);
    expect(ws[3]! / ws[0]!).toBeCloseTo(3, 1);
    await expect(svg.outerHTML).toMatchFileSnapshot("../fixtures/histogram-prebinned.golden.svg");
  });

  it("is deterministic: rendering the single-series case twice is byte-identical", () => {
    const a = renderChart(SINGLE_SPEC, rawRows(SINGLE_VALUES), { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(SINGLE_SPEC, rawRows(SINGLE_VALUES), { width: 720, height: 400, document }).svg.outerHTML;
    expect(a).toBe(b);
  });
});
