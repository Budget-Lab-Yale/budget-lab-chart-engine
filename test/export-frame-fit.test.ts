// @vitest-environment jsdom
//
// Shrink-to-fit for framed exports (1.17.0): `frame.fillPanes` fills a figure's frame exactly, growing
// OR shrinking its panes down to a floor, and `frame.fitRows` compresses a row-sized chart's row pitch
// (never expanding it) down to a legible floor. Both only touch a framed export; frame-less output is
// pinned byte for byte below.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { buildExportSvg } from "../src/embed/export-png";
import { renderChart } from "../src/engine/index";
import { horizontalBarChartHeight, FIT_MIN_PX_PER_BAR, FIT_LABEL_LINE_PX } from "../src/engine/figure";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"]; });
afterAll(() => { HTMLCanvasElement.prototype.getContext = realGetContext; });

const ser = (el: Element) => new XMLSerializer().serializeToString(el);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const heightOf = (svg: SVGSVGElement) => Number(svg.getAttribute("height"));
/** The chart SVG the export composed: the nested <svg> directly under the root. */
const chartOf = (root: SVGSVGElement) =>
  [...root.children].find((c) => c.tagName.toLowerCase() === "svg") as SVGSVGElement;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BARS: ChartSpec = {
  chartType: "bar", orientation: "horizontal", title: "Rows", xAxisType: "categorical",
  columns: { x: "cat", value: "v" }, data: "d.csv",
} as ChartSpec;
const barRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ cat: `Category ${i + 1}`, v: String(5 + (i % 7)) })) as unknown as TidyRow[];

const GROUPED: ChartSpec = { ...BARS, columns: { x: "cat", value: "v", series: "s" } } as ChartSpec;
const groupedRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ["A", "B", "C"].map((s, k) => ({ cat: `Category ${i + 1}`, s, v: String(3 + ((i + k) % 5)) })))
    .flat() as unknown as TidyRow[];

// A sectioned horizontal stack with net totals drawn as text and two-line category labels, like the
// revenue-by-tax charts: category labels, section headers, net labels and the value axis all in play.
const STACK: ChartSpec = {
  chartType: "stacked", orientation: "horizontal", title: "Revenue by provision", subtitle: "Billions of dollars",
  xAxisType: "categorical", columns: { x: "stage", value: "v", series: "tax", section: "policy" },
  barStack: { netDisplay: "text" }, data: "d.csv",
} as ChartSpec;
const STAGES = ["Before response", "After mechanical income adjustments to households", "After behavioral response"];
const stackRows = (policies: string[]) =>
  policies.flatMap((p, pi) => STAGES.flatMap((st, si) => ["Income", "Gains", "Payroll"].map((t, k) =>
    ({ policy: p, stage: st, tax: t, v: String(20 + 7 * pi + 3 * si + 5 * k) })))) as unknown as TidyRow[];

// A price-waterfall-like shared two-column waterfall figure with its long subtitle and note.
const WF: ChartSpec = {
  chartType: "waterfall", title: "Re-estimating the April 2 price decomposition",
  subtitle: "As published (April 2026) vs. updated (July 2026): updated ETR measurement + a new eta step + a modeling step (model re-run on the eta-adjusted April-December 2025 basket).",
  xAxisType: "categorical", y_axis_title: "Short-run price effect (%)",
  columns: { x: "step", value: "value", kind: "kind", facet: "panel" }, small_multiples: { columns: 2 }, data: "d.csv",
} as ChartSpec;
const wfRows = ["P1", "P2"].flatMap((p) => [["Initial", "2.3", "total"], ["A", "-0.5", ""], ["B", "-0.3", ""], ["C", "-0.2", ""], ["D", "-0.6", ""]]
  .map(([step, value, kind]) => ({ step, value, kind, panel: p }))) as unknown as TidyRow[];
const WF_NOTE = { ...WF, note: "Reproduces the April 2026 retrospective's decomposition of the April 2, 2025 estimate (short-run price formula, baseline 2.4%)." };

const FIG: ChartSpec = {
  chartType: "bar", title: "By sector", xAxisType: "categorical", orientation: "vertical",
  columns: { x: "cat", value: "v", facet: "grp" }, small_multiples: { mode: "shared", columns: 1 }, data: "d.csv",
} as ChartSpec;
const figRows = (facets: number) =>
  Array.from({ length: facets }, (_, f) => ["A", "B", "C"].map((cat, i) => ({ cat, grp: `G${f + 1}`, v: String(1 + i + f) })))
    .flat() as unknown as TidyRow[];

// ---------------------------------------------------------------------------
// Geometry helpers: vertical extents of what the chart SVG draws, in its own coordinates.
// ---------------------------------------------------------------------------

/** Sum of every translate's y from `el` up to (excluding) `stop`. */
function translateY(el: Element, stop: Element): number {
  let y = 0;
  for (let n: Element | null = el; n && n !== stop; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) y += Number(m[2]);
  }
  return y;
}
const fontSizeOf = (el: Element): number => {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const fs = n.getAttribute("font-size");
    if (fs) return Number(fs);
  }
  return 10;
};
/** A length attribute in px: "0.32em" scales by the font size, a bare number is px. */
const lengthPx = (v: string | null, fs: number): number =>
  v == null ? 0 : v.endsWith("em") ? Number(v.slice(0, -2)) * fs : Number(v);

type Box = { top: number; bottom: number; text: string };
/** A text element's em box: each line's baseline less 0.8em above and 0.2em below it. */
function textBox(t: Element, chart: Element): Box {
  const fs = fontSizeOf(t);
  const anchor = translateY(t, chart) + lengthPx(t.getAttribute("y"), fs);
  const spans = [...t.querySelectorAll("tspan")];
  const baselines: number[] = [];
  if (!spans.length) baselines.push(anchor);
  else {
    let b = anchor;
    for (const s of spans) {
      b = s.hasAttribute("y") ? anchor + lengthPx(s.getAttribute("y"), fs) : b + lengthPx(s.getAttribute("dy"), fs);
      baselines.push(b);
    }
  }
  return { top: Math.min(...baselines) - 0.8 * fs, bottom: Math.max(...baselines) + 0.2 * fs, text: t.textContent ?? "" };
}
const rectBox = (r: Element, chart: Element): Box => {
  const top = translateY(r, chart) + Number(r.getAttribute("y"));
  return { top, bottom: top + Number(r.getAttribute("height")), text: r.getAttribute("data-series") ?? "" };
};
/** No two boxes overlap vertically (touching is fine). */
function expectNoOverlap(boxes: Box[], what: string): void {
  const s = [...boxes].sort((a, b) => a.top - b.top);
  for (let i = 1; i < s.length; i++) {
    const gap = s[i]!.top - s[i - 1]!.bottom;
    expect(gap, `${what}: "${s[i - 1]!.text}" overlaps "${s[i]!.text}"`).toBeGreaterThanOrEqual(-0.01);
  }
}
/** Distinct bar bands (stacked segments of one row share one). */
const barBands = (chart: Element): Box[] => {
  const seen = new Map<string, Box>();
  for (const r of chart.querySelectorAll('g[aria-label="bar"] rect')) {
    const b = rectBox(r, chart);
    seen.set(`${b.top.toFixed(3)}:${b.bottom.toFixed(3)}`, b);
  }
  return [...seen.values()];
};
const catLabels = (chart: Element) => [...chart.querySelectorAll("g.tbl-cat-label text")].map((t) => textBox(t, chart));
/** Value-axis tick labels: the 10.5px text (category labels are 13px, value labels 12px). */
const tickLabels = (chart: Element) =>
  [...chart.querySelectorAll("text")].filter((t) => fontSizeOf(t) === 10.5).map((t) => textBox(t, chart));
/** Section headers: bold 13px text in the gutter (not the category labels). */
const sectionHeaders = (chart: Element) =>
  [...chart.querySelectorAll("text")].filter((t) =>
    !t.closest("g.tbl-cat-label") && t.closest("g[font-weight='700']") && fontSizeOf(t) === 13).map((t) => textBox(t, chart));
/** Net / value labels: bold 12px text. */
const valueLabels = (chart: Element) =>
  [...chart.querySelectorAll("text")].filter((t) => t.closest("g[font-weight='700']") && fontSizeOf(t) === 12)
    .map((t) => textBox(t, chart));

/** Everything a fitted row-sized chart draws keeps clear of everything else on its side of the plot. */
function expectLegible(chart: SVGSVGElement): void {
  const cats = catLabels(chart);
  expect(cats.length).toBeGreaterThan(0);
  expectNoOverlap([...cats, ...sectionHeaders(chart)], "gutter labels");
  const bars = barBands(chart);
  expectNoOverlap(bars, "bars");
  expectNoOverlap(valueLabels(chart), "value labels");
  // The value axis sits below the last bar and inside the chart.
  const ticks = tickLabels(chart);
  expect(ticks.length).toBeGreaterThan(0);
  const lastBar = Math.max(...bars.map((b) => b.bottom));
  const lastLabel = Math.max(...cats.map((b) => b.bottom));
  for (const t of ticks) {
    expect(t.top).toBeGreaterThanOrEqual(lastBar);
    expect(t.top).toBeGreaterThanOrEqual(lastLabel - 0.01);
    expect(t.bottom).toBeLessThanOrEqual(Number(chart.getAttribute("height")) + 0.01);
  }
}
/** Row pitch: the smallest centre-to-centre step between bar bands. */
const pitchOf = (chart: Element): number => {
  const c = barBands(chart).map((b) => (b.top + b.bottom) / 2).sort((a, b) => a - b);
  return Math.min(...c.slice(1).map((v, i) => v - c[i]!));
};

// ---------------------------------------------------------------------------
// Frame-less byte identity, pinned against bda588f (before this change)
// ---------------------------------------------------------------------------

describe("frame-less output is unchanged", () => {
  it.each([
    ["a 40-row horizontal bar chart", BARS, barRows(40), "37ae2b5f803e13c38efb9469ff37315f8d2b6c2cf4f2cf078228ca04450582a3"],
    ["a 3-row horizontal bar chart", BARS, barRows(3), "57109ae2b32f69a5925a3915b7820ae5e41c37cca6c03e61c1910c1dd59e2fef"],
    ["a two-column waterfall figure", WF, wfRows, "bda91822342fbd8818dea067b451e9bbc842f8c5d18a83ebce9ab3087a548f38"],
  ])("%s", (_name, spec, rows, hash) => {
    expect(sha(ser(buildExportSvg(spec as ChartSpec, rows as TidyRow[])))).toBe(hash);
  });
  it("the live height model is unchanged without maxHeight", () => {
    expect(horizontalBarChartHeight(BARS, barRows(40))).toBe(40 * 22 + 80);
    expect(horizontalBarChartHeight(BARS, barRows(40), {})).toBe(40 * 22 + 80);
  });
});

// ---------------------------------------------------------------------------
// fillPanes: grow or shrink
// ---------------------------------------------------------------------------

describe("fillPanes fills the frame exactly, shrinking panes as well as growing them", () => {
  it("a price-waterfall-like two-column waterfall figure fills a 640x618 frame", () => {
    const frame = { width: 640, height: 618, logoTop: 20 };
    // Precondition: content-sized, the 420px waterfall panes overflow the frame.
    expect(heightOf(buildExportSvg(WF_NOTE, wfRows, { frame }))).toBeGreaterThan(618);
    expect(heightOf(buildExportSvg(WF_NOTE, wfRows, { frame: { ...frame, fillPanes: true } }))).toBe(618);
  });
  it.each([1200, 1201, 1202, 1203, 700, 701, 702])("a three-row figure fills a 1280x%i frame exactly", (fh) => {
    const svg = buildExportSvg(FIG, figRows(3), { frame: { width: 1280, height: fh, fillPanes: true } });
    expect(heightOf(svg)).toBe(fh);
  });
  it("a four-row figure in a short frame stops at the 160px pane floor and comes out taller", () => {
    const svg = buildExportSvg(FIG, figRows(4), { frame: { width: 1280, height: 618, fillPanes: true } });
    const panes = [...svg.children].filter((c) => c.tagName.toLowerCase() === "svg");
    expect(panes).toHaveLength(4);
    for (const p of panes) expect(Number(p.getAttribute("height"))).toBe(160);
    expect(heightOf(svg)).toBeGreaterThan(618);
    // ...and no taller than the floor requires: the unfilled figure is taller still.
    expect(heightOf(svg)).toBeLessThan(heightOf(buildExportSvg(FIG, figRows(4), { frame: { width: 1280, height: 618 } })));
  });
  it("fillPanes: false and an absent fillPanes are the same output", () => {
    const frame = { width: 640, height: 618 };
    expect(ser(buildExportSvg(WF, wfRows, { frame: { ...frame, fillPanes: false } }))).toBe(ser(buildExportSvg(WF, wfRows, { frame })));
  });
});

// ---------------------------------------------------------------------------
// fitRows: compress a row-sized chart's pitch to the frame
// ---------------------------------------------------------------------------

describe("fitRows compresses a row-sized chart to the frame", () => {
  it("states its floors: 16px per label line, 15px per bar", () => {
    expect(FIT_LABEL_LINE_PX).toBe(16);
    expect(FIT_MIN_PX_PER_BAR).toBe(15);
  });

  it("a 30-row bar chart fills a 1280x618 frame exactly, labels clear of each other", () => {
    const frame = { width: 1280, height: 618, logoTop: 20 };
    const plain = buildExportSvg(BARS, barRows(30), { frame });
    expect(heightOf(plain)).toBeGreaterThan(618); // precondition: it overflows unfitted
    const fitted = buildExportSvg(BARS, barRows(30), { frame: { ...frame, fitRows: true } });
    expect(heightOf(fitted)).toBe(618);
    const chart = chartOf(fitted);
    const pitch = pitchOf(chart);
    expect(pitch).toBeLessThan(22);
    expect(pitch).toBeGreaterThanOrEqual(16);
    expectLegible(chart);
  });

  it("the legibility check is not vacuous: it fails on 40 rows squeezed into 400px", () => {
    const squeezed = renderChart(BARS, barRows(40), { width: 1200, height: 400, heightFromModel: true, document }).svg;
    expect(() => expectLegible(squeezed)).toThrow(/overlaps/);
  });

  it("a 40-row bar chart fills a 1280x800 frame exactly", () => {
    const fitted = buildExportSvg(BARS, barRows(40), { frame: { width: 1280, height: 800, logoTop: 20, fitRows: true } });
    expect(heightOf(fitted)).toBe(800);
    expectLegible(chartOf(fitted));
  });

  it("a 40-row bar chart in a 1280x618 frame stops at the floor, legible, and comes out taller", () => {
    const frame = { width: 1280, height: 618, logoTop: 20 };
    const plainH = heightOf(buildExportSvg(BARS, barRows(40), { frame }));
    const fitted = buildExportSvg(BARS, barRows(40), { frame: { ...frame, fitRows: true } });
    expect(heightOf(fitted)).toBeGreaterThan(618);
    expect(heightOf(fitted)).toBeLessThan(plainH);
    const chart = chartOf(fitted);
    expect(pitchOf(chart)).toBe(16);
    expectLegible(chart);
  });

  it("grouped bars compress the whole group: three bars per row, each at least 12px thick at the floor", () => {
    const frame = { width: 1280, height: 618, logoTop: 20 };
    const plain = buildExportSvg(GROUPED, groupedRows(12), { frame });
    expect(heightOf(plain)).toBeGreaterThan(618);
    const fitted = buildExportSvg(GROUPED, groupedRows(12), { frame: { ...frame, fitRows: true } });
    expect(heightOf(fitted)).toBeGreaterThan(618); // 12 rows x 3 bars cannot fit at 15px a bar
    const chart = chartOf(fitted);
    const bars = barBands(chart);
    expect(bars).toHaveLength(36);
    for (const b of bars) expect(b.bottom - b.top).toBeGreaterThanOrEqual(12 - 0.01);
    expectLegible(chart);
    // At a frame tall enough it fits exactly.
    const tall = buildExportSvg(GROUPED, groupedRows(12), { frame: { width: 1280, height: 720, logoTop: 20, fitRows: true } });
    expect(heightOf(tall)).toBe(720);
    expectLegible(chartOf(tall));
  });

  it("a sectioned stack with two-line labels and net totals fits, headers and labels clear", () => {
    const policies = ["Capital gains", "+ Corporate", "Package"];
    const frame = { width: 1280, height: 618, logoTop: 20 };
    const plain = buildExportSvg(STACK, stackRows(policies), { frame });
    expect(heightOf(plain)).toBeGreaterThan(618);
    const fitted = buildExportSvg(STACK, stackRows(policies), { frame: { ...frame, fitRows: true } });
    expect(heightOf(fitted)).toBe(618);
    const chart = chartOf(fitted);
    expect(sectionHeaders(chart)).toHaveLength(policies.length);
    expect(valueLabels(chart)).toHaveLength(policies.length * STAGES.length);
    expect(catLabels(chart).some((b) => b.bottom - b.top > 20)).toBe(true); // some labels wrap
    expectLegible(chart);
  });

  it("never expands: a 3-row chart keeps its content height", () => {
    const frame = { width: 1280, height: 618, logoTop: 20 };
    const plain = buildExportSvg(BARS, barRows(3), { frame });
    const fitted = buildExportSvg(BARS, barRows(3), { frame: { ...frame, fitRows: true } });
    expect(heightOf(plain)).toBeLessThan(618);
    expect(ser(fitted)).toBe(ser(plain));
  });

  it("does nothing to a chart that is not row-sized, or to a figure", () => {
    const LINE = { chartType: "line", title: "T", xAxisType: "numeric", columns: { x: "x", value: "v" }, data: "d.csv" } as ChartSpec;
    const lineRows = [1, 2, 3].map((x) => ({ x: String(x), v: String(x * 2) })) as unknown as TidyRow[];
    const frame = { width: 1280, height: 618 };
    expect(ser(buildExportSvg(LINE, lineRows, { frame: { ...frame, fitRows: true } }))).toBe(ser(buildExportSvg(LINE, lineRows, { frame })));
    expect(ser(buildExportSvg(WF, wfRows, { frame: { ...frame, fitRows: true } }))).toBe(ser(buildExportSvg(WF, wfRows, { frame })));
  });

  it("fitRows: false is the same as absent", () => {
    const frame = { width: 1280, height: 618 };
    expect(ser(buildExportSvg(BARS, barRows(30), { frame: { ...frame, fitRows: false } }))).toBe(ser(buildExportSvg(BARS, barRows(30), { frame })));
  });

  it("the height model fits to maxHeight and stops at its floor", () => {
    const natural = horizontalBarChartHeight(BARS, barRows(40));
    expect(horizontalBarChartHeight(BARS, barRows(40), { maxHeight: natural + 50 })).toBe(natural);
    expect(horizontalBarChartHeight(BARS, barRows(40), { maxHeight: 700.5 })).toBe(700.5);
    // 40 rows at 16px: margins 44 + ceil(16 x (40 - 0.2 + 0.04)).
    expect(horizontalBarChartHeight(BARS, barRows(40), { maxHeight: 300 })).toBe(44 + Math.ceil(16 * 39.84));
  });
});

// ---------------------------------------------------------------------------
// fitRows floor: a row's own marks (dumbbell dots + gap labels, stacked net dots)
// ---------------------------------------------------------------------------

const DUMBBELL: ChartSpec = {
  chartType: "dumbbell", orientation: "horizontal", title: "Rates", xAxisType: "categorical",
  columns: { category: "cat", series: "m", value: "v" }, series_order: ["Before", "After"], data: "d.csv",
} as ChartSpec;
const dumbbellRows = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    { cat: `Group ${i + 1}`, m: "Before", v: String(10 + (i % 5)) },
    { cat: `Group ${i + 1}`, m: "After", v: String(18 + (i % 7)) },
  ]).flat() as unknown as TidyRow[];

const strokeOf = (el: Element): number => {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const sw = n.getAttribute("stroke-width");
    if (sw) return Number(sw);
  }
  return 1;
};
/** Each row's vertical reach: its dots (radius + half the outline), its connector (half its width) and
 *  its gap label's em box. Rows are found from the dots' centres; a connector or label belongs to the
 *  row it sits on (labels pair with rows in order: one per row, above it). */
function dumbbellRows_(chart: Element): Box[] {
  const dots = [...chart.querySelectorAll('g[aria-label="dot"] circle')].map((c) => {
    const cy = translateY(c, chart) + Number(c.getAttribute("cy") ?? 0);
    const reach = Number(c.getAttribute("r")) + strokeOf(c) / 2;
    return { cy, top: cy - reach, bottom: cy + reach };
  });
  const rows = new Map<string, Box>();
  for (const d of dots) {
    const k = d.cy.toFixed(3);
    const b = rows.get(k);
    rows.set(k, b ? { top: Math.min(b.top, d.top), bottom: Math.max(b.bottom, d.bottom), text: k } : { top: d.top, bottom: d.bottom, text: k });
  }
  const sorted = [...rows.values()].sort((a, b) => a.top - b.top);
  const centre = (b: Box) => Number(b.text);
  const extend = (i: number, top: number, bottom: number) => {
    const b = sorted[i]!;
    sorted[i] = { ...b, top: Math.min(b.top, top), bottom: Math.max(b.bottom, bottom) };
  };
  for (const l of chart.querySelectorAll("g.tbl-dumbbell-connector line")) {
    const y = translateY(l, chart) + Number(l.getAttribute("y1"));
    const half = strokeOf(l) / 2;
    const i = sorted.findIndex((b) => Math.abs(centre(b) - y) < 0.01);
    expect(i).toBeGreaterThanOrEqual(0);
    extend(i, y - half, y + half);
  }
  const labels = [...chart.querySelectorAll("g.tbl-dumbbell-gap text")].map((t) => textBox(t, chart)).sort((a, b) => a.top - b.top);
  if (labels.length) {
    expect(labels).toHaveLength(sorted.length);
    labels.forEach((l, i) => {
      expect(l.bottom).toBeLessThan(centre(sorted[i]!)); // above its own stem
      extend(i, l.top, l.bottom);
    });
  }
  return sorted;
}
const dumbbellPitch = (rows: Box[]): number => {
  const c = rows.map((b) => Number(b.text));
  return Math.min(...c.slice(1).map((v, i) => +(v - c[i]!).toFixed(3)));
};

describe("fitRows floor covers each row's own marks", () => {
  const frame = { width: 1280, height: 618, logoTop: 20, fitRows: true };

  it("a default dumbbell still compresses, to the 16px label floor", () => {
    const plain = buildExportSvg(DUMBBELL, dumbbellRows(40), { frame: { ...frame, fitRows: false } });
    const fitted = buildExportSvg(DUMBBELL, dumbbellRows(40), { frame });
    expect(heightOf(fitted)).toBeLessThan(heightOf(plain));
    const rows = dumbbellRows_(chartOf(fitted));
    expect(rows).toHaveLength(40);
    expect(dumbbellPitch(rows)).toBe(16);
    expectNoOverlap(rows, "dumbbell rows");
  });

  it("dot_radius 10: neighbouring rows' 20px dots never meet; the floor binds and the output is taller", () => {
    const spec = { ...DUMBBELL, dot_radius: 10 } as ChartSpec;
    const fitted = buildExportSvg(spec, dumbbellRows(40), { frame });
    expect(heightOf(fitted)).toBeGreaterThan(618);
    const rows = dumbbellRows_(chartOf(fitted));
    expect(rows).toHaveLength(40);
    expectNoOverlap(rows, "dumbbell rows");
  });

  it("dot_radius 7: compresses only to the dot floor, 2 x 7.5 + 3 = 18px", () => {
    const spec = { ...DUMBBELL, dot_radius: 7 } as ChartSpec;
    const rows = dumbbellRows_(chartOf(buildExportSvg(spec, dumbbellRows(40), { frame })));
    expect(dumbbellPitch(rows)).toBe(18);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.top - rows[i - 1]!.bottom).toBeGreaterThanOrEqual(3 - 0.01);
  });

  it("gap_annotation, dot_radius 10: the floor (34px) is above the natural pitch, so the chart is left as it was", () => {
    const spec = { ...DUMBBELL, dot_radius: 10, gap_annotation: true } as ChartSpec;
    const fitted = buildExportSvg(spec, dumbbellRows(40), { frame });
    expect(ser(fitted)).toBe(ser(buildExportSvg(spec, dumbbellRows(40), { frame: { ...frame, fitRows: false } })));
    // No gap label crosses the connector of the row above it.
    const chart = chartOf(fitted);
    const conns = [...chart.querySelectorAll("g.tbl-dumbbell-connector line")]
      .map((l) => translateY(l, chart) + Number(l.getAttribute("y1"))).sort((x, y) => x - y);
    const labels = [...chart.querySelectorAll("g.tbl-dumbbell-gap text")].map((t) => textBox(t, chart)).sort((x, y) => x.top - y.top);
    expect(labels).toHaveLength(40);
    labels.forEach((l, i) => {
      if (i > 0) expect(l.top).toBeGreaterThan(conns[i - 1]! + 0.75);
      expect(l.bottom).toBeLessThan(conns[i]! - 0.75);
    });
  });

  it.each([3, 5])("gap_annotation, dot_radius %i: no gap label meets the row above's connector or dots", (r) => {
    const spec = { ...DUMBBELL, dot_radius: r, gap_annotation: true } as ChartSpec;
    const rows = dumbbellRows_(chartOf(buildExportSvg(spec, dumbbellRows(40), { frame })));
    expect(rows).toHaveLength(40);
    expectNoOverlap(rows, "dumbbell rows with gap labels");
  });

  it("gap_annotation, dot_radius 3: compresses, but only to the label's floor (20px)", () => {
    const spec = { ...DUMBBELL, dot_radius: 3, gap_annotation: true } as ChartSpec;
    const rows = dumbbellRows_(chartOf(buildExportSvg(spec, dumbbellRows(40), { frame })));
    // Label em box 3 + 5 + 0.48 x 10.5 above the stem, the dot 3.5 below, 3px clear: ceil(19.54).
    expect(dumbbellPitch(rows)).toBe(20);
  });

  it("a diverging stack's net dots (r 8, 2px outline) stop the pitch at 21px and never meet", () => {
    const spec = { ...BARS, chartType: "stacked", columns: { x: "cat", value: "v", series: "s" } } as ChartSpec;
    const rows = Array.from({ length: 40 }, (_, i) => [
      { cat: `Category ${i + 1}`, s: "Up", v: String(5 + (i % 4)) },
      { cat: `Category ${i + 1}`, s: "Down", v: String(-2 - (i % 3)) },
    ]).flat() as unknown as TidyRow[];
    const chart = chartOf(buildExportSvg(spec, rows, { frame }));
    const nets = [...chart.querySelectorAll("circle.tbl-net-marker, g.tbl-net-marker circle")].map((c) => {
      const cy = translateY(c, chart) + Number(c.getAttribute("cy") ?? 0);
      const reach = Number(c.getAttribute("r")) + strokeOf(c) / 2;
      return { top: cy - reach, bottom: cy + reach, text: String(cy) };
    });
    expect(nets).toHaveLength(40);
    expect(pitchOf(chart)).toBe(21);
    expectNoOverlap(nets, "net dots");
  });
});

describe("frame option validation", () => {
  it.each([["fitRows", "yes"], ["fitRows", 1], ["fillPanes", "true"], ["fillPanes", null]])("rejects %s: %s", (key, value) => {
    const frame = { width: 1280, height: 618, [key]: value } as unknown as { width: number; height: number };
    expect(() => buildExportSvg(BARS, barRows(3), { frame })).toThrow(new RegExp(key));
  });
  it.each([true, false, undefined])("accepts fitRows and fillPanes %s", (v) => {
    expect(() => buildExportSvg(BARS, barRows(3), { frame: { width: 1280, height: 618, fitRows: v, fillPanes: v } })).not.toThrow();
  });
});
