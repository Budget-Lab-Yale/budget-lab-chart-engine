// @vitest-environment jsdom
//
// `highlightSeries` on a stacked bar. CONFIG-SPEC lists it under "Bar / stacked-bar options" ("Series
// keys to emphasize (dims all others)"), but only bar.ts and histogram.ts read it, so a stacked chart
// with the field rendered byte-identically to one without (marks-overlays review, 2026-10-15). It
// now dims as bar.ts does: every segment of a series not listed is painted `annotationDim`, through
// a per-segment fill that the legend, tooltip and export keys pick up from the render.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderFigure } from "../src/engine/figure";
import { buildExportSvg } from "../src/embed/export-png";
import { ICON_GROUP_CLASS } from "../src/engine/icon";
import { TBL } from "../src/engine/theme";
import { monoScale } from "../src/engine/palette";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document };
const DIM = TBL.color.annotationDim.toLowerCase();
const ROWS = (
  [["A", "one", 6], ["A", "two", 4], ["A", "three", 3], ["B", "one", 3], ["B", "two", 7], ["B", "three", 5]] as const
).map(([time, series, v]) => ({ time, series, value: String(v) })) as unknown as TidyRow[];
const COLORS = { one: "blue", two: "amber", three: "teal" };
const spec = (s: Record<string, unknown> = {}): ChartSpec =>
  ({
    title: "t", chartType: "stacked", xAxisType: "categorical", data: "d.csv",
    columns: { x: "time", value: "value", series: "series" },
    series_colors: COLORS,
    highlightSeries: ["two"],
    ...s,
  }) as unknown as ChartSpec;

/** series → the set of fills its drawn segments carry. */
function fills(svg: Element): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of svg.querySelectorAll('g[aria-label="bar"] rect[data-series]')) {
    const s = r.getAttribute("data-series")!;
    if (!out.has(s)) out.set(s, new Set());
    out.get(s)!.add((r.getAttribute("fill") ?? "").toLowerCase());
  }
  return out;
}

function expectDimmedExceptTwo(svg: Element, palette: Map<string, string>) {
  const f = fills(svg);
  expect([...f.keys()].sort()).toEqual(["one", "three", "two"]);
  expect([...f.get("one")!]).toEqual([DIM]);
  expect([...f.get("three")!]).toEqual([DIM]);
  expect([...f.get("two")!]).toEqual([palette.get("two")!.toLowerCase()]);
  expect(palette.get("two")!.toLowerCase()).not.toBe(DIM);
}

describe("highlightSeries on a stacked bar dims every other series", () => {
  it("vertical", () => {
    const r = renderChart(spec(), ROWS, OPTS);
    expectDimmedExceptTwo(r.svg, r.colors);
  });

  it("horizontal", () => {
    const r = renderChart(spec({ orientation: "horizontal" }), ROWS, OPTS);
    expectDimmedExceptTwo(r.svg, r.colors);
  });

  it("diverging (net dots kept, undimmed: Total is not a series)", () => {
    const rows = ROWS.map((r) => (r.series === "three" ? { ...r, value: `-${r.value}` } : r));
    const r = renderChart(spec(), rows, OPTS);
    expectDimmedExceptTwo(r.svg, r.colors);
    const dots = [...r.svg.querySelectorAll("g.tbl-net-marker circle")];
    expect(dots.length).toBe(2);
  });

  it("100%-normalized", () => {
    const r = renderChart(spec({ barStack: { normalize: true } }), ROWS, OPTS);
    expectDimmedExceptTwo(r.svg, r.colors);
  });

  it("mono: the highlighted series keeps its tier, the rest dim", () => {
    const r = renderChart(spec({ barStack: { mono: { base: "blue" } } }), ROWS, OPTS);
    const f = fills(r.svg);
    const tiers = monoScale("blue", 3).map((t) => t.toLowerCase());
    expect([...f.get("one")!]).toEqual([DIM]);
    expect([...f.get("three")!]).toEqual([DIM]);
    expect(tiers).toContain([...f.get("two")!][0]);
  });

  it("the legend keys the dimmed series with the dim it is painted", () => {
    const r = renderChart(spec(), ROWS, OPTS);
    const color = (s: string) => r.legendItems!.find((i) => i.series === s)!.color!.toLowerCase();
    expect(color("one")).toBe(DIM);
    expect(color("two")).toBe(r.colors.get("two")!.toLowerCase());
  });

  it("the PNG export dims the same segments and keys", () => {
    const svg = buildExportSvg(spec(), ROWS);
    const plot = svg.querySelector("svg.tblchart")!;
    expectDimmedExceptTwo(plot, renderChart(spec(), ROWS, OPTS).colors);
    const keyFills = [...svg.querySelectorAll(`g.${ICON_GROUP_CLASS} rect`)].map((k) =>
      (/fill:\s*([^;]+)/.exec(k.getAttribute("style") ?? "")?.[1] ?? k.getAttribute("fill") ?? "").toLowerCase(),
    );
    expect(keyFills.filter((c) => c === DIM).length).toBe(2);
  });

  it("small multiples: every pane dims", () => {
    const rows = ROWS.flatMap((r) => ["North", "South"].map((region) => ({ ...r, region })));
    const fig = renderFigure(
      spec({ columns: { x: "time", value: "value", series: "series", facet: "region" }, small_multiples: { columns: 2 } }),
      rows as unknown as TidyRow[],
      OPTS,
    );
    expect(fig.panes.length).toBe(2);
    for (const p of fig.panes) expectDimmedExceptTwo(p.svg!, fig.colors);
    expect(fig.legendItems!.find((i) => i.series === "one")!.color!.toLowerCase()).toBe(DIM);
  });

  it("a segment label on a dimmed segment takes dark text (white on the dim grey is unreadable)", () => {
    const r = renderChart(spec({ valueLabels: { show: true } }), ROWS, { ...OPTS, height: 600 });
    const labels = [...r.svg.querySelectorAll("g.tbl-segment-label text")];
    expect(labels.length).toBe(6);
    const fillOf = (t: Element) => (t.getAttribute("fill") ?? t.parentElement?.getAttribute("fill") ?? "").toLowerCase();
    // "two" prints 4 and 7; every other value belongs to a dimmed series.
    for (const t of labels) {
      const highlighted = t.textContent === "4" || t.textContent === "7";
      expect(fillOf(t), `label ${t.textContent}`).toBe(highlighted ? "#ffffff" : TBL.color.heading.toLowerCase());
    }
  });

  it("an empty list dims nothing (byte-identical to no field)", () => {
    const a = renderChart(spec({ highlightSeries: [] }), ROWS, OPTS).svg.outerHTML;
    const b = renderChart(spec({ highlightSeries: undefined }), ROWS, OPTS).svg.outerHTML;
    expect(a).toBe(b);
  });
});
