// @vitest-environment jsdom
//
// A REPEATED `series_order` OR `shape_order` ENTRY IS AN AUTHOR ERROR (Ruling 66).
//
// Validation rejects it, naming the field and the value. renderChart does not validate, so the engine
// drops the repeats once, up front (first occurrence kept), and every surface then reads one list with
// no repeats: a spec with a repeated entry renders exactly as the same spec with the repeat removed,
// standalone and faceted, live and in the PNG. Before that, Plot's symbol scale kept a value's first
// occurrence while every list the engine built row by row (the legend, the key rows, the hover maps,
// a horizontal bar's height) counted the repeat, so the legend and the marks disagreed.
import { describe, it, expect, afterEach } from "vitest";
import { renderChart, renderPane, shapeDomainOver } from "../src/engine/index";
import { renderTreemap } from "../src/engine/marks/treemap";
import { renderTimeline } from "../src/engine/marks/timeline";
import { renderFigure } from "../src/engine/figure";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { MARKER_SYMBOLS } from "../src/engine/theme";
import { symbolPathD } from "../src/engine/symbols";
import { validateSpec } from "../src/spec/validate";
import { CHART_SPEC_SCHEMA } from "../src/spec/schema";
import { mockRect1to1 } from "./helpers/hover-harness";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

afterEach(() => document.body.replaceChildren());

// ---------------------------------------------------------------------------------------------------
// Validation.

/** A minimal spec of each chart type that validates as it stands. */
const MINIMAL: Record<string, Record<string, unknown>> = {
  line: { xAxisType: "temporal" },
  area: { xAxisType: "temporal" },
  bar: { xAxisType: "categorical" },
  stacked: { xAxisType: "categorical" },
  scatter: { xAxisType: "numeric" },
  dotplot: { xAxisType: "categorical" },
  waterfall: { xAxisType: "categorical" },
  histogram: { xAxisType: "numeric" },
  dumbbell: { xAxisType: "categorical" },
  timeline: { xAxisType: "temporal" },
  treemap: { xAxisType: "categorical" },
};
const minimal = (chartType: string, extra: object = {}): Record<string, unknown> => ({
  chartType, title: "T", data: "d.csv", ...MINIMAL[chartType], ...extra,
});
/** Timeline and treemap reject shape_order outright; every other chart type accepts it. */
const SHAPE_TYPES = Object.keys(MINIMAL).filter((t) => t !== "timeline" && t !== "treemap");

describe("validation rejects a repeated series_order or shape_order entry", () => {
  it("covers every chart type the schema knows", () => {
    const types = (CHART_SPEC_SCHEMA as { properties: { chartType: { enum: readonly string[] } } }).properties.chartType.enum;
    expect(Object.keys(MINIMAL).sort()).toEqual([...types].sort());
  });

  for (const chartType of Object.keys(MINIMAL)) {
    it(`${chartType}: series_order`, () => {
      // Control: the same list without the repeat validates.
      expect(validateSpec(minimal(chartType, { series_order: ["M", "N"] }))).toEqual({ valid: true, errors: [] });
      expect(validateSpec(minimal(chartType, { series_order: ["M", "M", "N"] }))).toEqual({
        valid: false, errors: ['/series_order: "M" appears more than once'],
      });
      // The repeated value is named however far apart the two entries are.
      expect(validateSpec(minimal(chartType, { series_order: ["N", "M", "O", "M"] })).errors).toEqual([
        '/series_order: "M" appears more than once',
      ]);
    });
  }

  for (const chartType of SHAPE_TYPES) {
    it(`${chartType}: shape_order`, () => {
      expect(validateSpec(minimal(chartType, { shape_order: ["M", "N"] }))).toEqual({ valid: true, errors: [] });
      expect(validateSpec(minimal(chartType, { shape_order: ["N", "M", "N"] }))).toEqual({
        valid: false, errors: ['/shape_order: "N" appears more than once'],
      });
    });
  }

  it("names each field with a repeat, and a repeated blank entry", () => {
    expect(validateSpec(minimal("dotplot", { series_order: ["A", "A"], shape_order: ["", "M", ""] })).errors).toEqual([
      '/series_order: "A" appears more than once',
      '/shape_order: "" appears more than once',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// renderChart (which does not validate) drops the repeats once, up front.

const letters = (d: string): string => d.replace(/[^A-Za-z]/g, "");
const BY_LETTERS = new Map(MARKER_SYMBOLS.map((s) => [letters(symbolPathD(s, 50)), s as string] as const));
const symbolOf = (el: Element): string =>
  el.tagName.toLowerCase() === "circle" ? "circle" : BY_LETTERS.get(letters(el.getAttribute("d") ?? "")) ?? "?";

const mount = (spec: ChartSpec, rows: TidyRow[], height?: number): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  mountChart(host, { spec, rows, width: 838, ...(height != null ? { height } : {}) });
  return host;
};

type Mode = "standalone" | "shared" | "per-pane";
const MODES: Mode[] = ["standalone", "shared", "per-pane"];

function specOf(base: object, columns: Record<string, string>, extra: object, mode: Mode): ChartSpec {
  const { facet, ...rest } = columns;
  return {
    ...base,
    title: "t",
    data: "d.csv",
    columns: mode === "standalone" ? rest : { ...rest, facet },
    ...extra,
    ...(mode === "standalone" ? {} : { small_multiples: { columns: 2, mode } }),
  } as unknown as ChartSpec;
}

/** Plot numbers an area's clip path from a process-wide counter (`plot-clip-3`), so two renders of
 *  one spec differ there and only there. */
const stable = (s: string): string => s.replace(/plot-clip-\d+/g, "plot-clip-#");

/** Every surface a spec renders to, serialised: the render result (SVGs, legend, key rows, shape
 *  legend), the live mount at its own computed height, and the PNG. */
function surfaces(spec: ChartSpec, rows: TidyRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  const keyed = (v: unknown): string => JSON.stringify(v ?? null);
  if (spec.small_multiples) {
    const fig = renderFigure(spec, rows, { width: INNER_W });
    fig.panes.forEach((p, i) => {
      out[`pane ${i} svg`] = (p.svg as Element).outerHTML;
      out[`pane ${i} key rows`] = keyed(p.seriesKeyRows);
    });
    out["legend"] = keyed(fig.legendItems);
    out["shape legend"] = keyed(fig.shapeLegendItems);
  } else {
    const r = renderChart(spec, rows, { width: 720 });
    out["svg"] = r.svg.outerHTML;
    out["legend"] = keyed(r.legendItems);
    out["key rows"] = keyed(r.seriesKeyRows);
    out["shape legend"] = keyed(r.shapeLegendItems);
  }
  out["live"] = mount(spec, rows).innerHTML;
  out["PNG"] = buildExportSvg(spec, rows).outerHTML;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, stable(v)]));
}

/** Both panes carry A and B at every x. */
const seriesRows = (xs: readonly string[], panes: readonly string[] = ["P", "Q"]): TidyRow[] =>
  panes.flatMap((pane) =>
    xs.flatMap((x, i) => [
      { pane, series: "A", x, value: String(1 + i) },
      { pane, series: "B", x, value: String(-2 - i) },
    ]),
  ) as unknown as TidyRow[];
/** Both panes carry M at the first x and N at the second, for series A and B. */
const shapeRows = (xs: readonly string[], panes: readonly string[] = ["P", "Q"]): TidyRow[] =>
  panes.flatMap((pane) =>
    (["A", "B"] as const).flatMap((series, j) => [
      { pane, series, shp: "M", x: xs[0]!, value: String(1 + j) },
      { pane, series, shp: "N", x: xs[1]!, value: String(3 + j) },
    ]),
  ) as unknown as TidyRow[];

const SERIES_COLS = { x: "x", value: "value", series: "series", facet: "pane" };
const SHAPE_COLS = { ...SERIES_COLS, shape: "shp" };

const IDENTITY = [
  { kind: "line, points: true", base: { chartType: "line", points: true, xAxisType: "temporal" }, cols: SERIES_COLS, xs: ["2020-01-01", "2021-01-01", "2022-01-01"], rows: seriesRows, field: "series_order", dup: ["A", "A", "B"] },
  { kind: "line, points: true", base: { chartType: "line", points: true, xAxisType: "temporal" }, cols: SERIES_COLS, xs: ["2020-01-01", "2021-01-01", "2022-01-01"], rows: seriesRows, field: "series_order", dup: ["B", "A", "B"] },
  { kind: "area", base: { chartType: "area", xAxisType: "temporal" }, cols: SERIES_COLS, xs: ["2020-01-01", "2021-01-01"], rows: seriesRows, field: "series_order", dup: ["B", "A", "B"] },
  { kind: "bar", base: { chartType: "bar", xAxisType: "categorical" }, cols: SERIES_COLS, xs: ["u", "v"], rows: seriesRows, field: "series_order", dup: ["A", "A", "B"] },
  // A horizontal bar's height counted series_order's entries, the repeat included (eight categories,
  // so the height clears its 400px floor).
  { kind: "horizontal bar", base: { chartType: "bar", orientation: "horizontal", xAxisType: "categorical" }, cols: SERIES_COLS, xs: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"], rows: seriesRows, field: "series_order", dup: ["A", "B", "A"] },
  { kind: "stacked", base: { chartType: "stacked", xAxisType: "categorical" }, cols: SERIES_COLS, xs: ["u", "v"], rows: seriesRows, field: "series_order", dup: ["A", "B", "B"] },
  { kind: "dotplot, shape = series", base: { chartType: "dotplot", xAxisType: "categorical" }, cols: { ...SERIES_COLS, shape: "series" }, xs: ["u", "v"], rows: seriesRows, field: "series_order", dup: ["A", "A", "B"] },
  { kind: "scatter, shape = series", base: { chartType: "scatter", xAxisType: "numeric" }, cols: { ...SERIES_COLS, shape: "series" }, xs: ["1", "2"], rows: seriesRows, field: "series_order", dup: ["B", "A", "B"] },
  { kind: "scatter, shape column", base: { chartType: "scatter", xAxisType: "numeric" }, cols: SHAPE_COLS, xs: ["1", "2"], rows: shapeRows, field: "shape_order", dup: ["M", "M", "N"] },
  { kind: "dotplot, shape column", base: { chartType: "dotplot", xAxisType: "categorical" }, cols: SHAPE_COLS, xs: ["u", "v"], rows: shapeRows, field: "shape_order", dup: ["M", "N", "M"] },
] as const;

describe("a repeated entry renders exactly as the list without it", () => {
  for (const c of IDENTITY) {
    for (const mode of MODES) {
      it(`${c.kind} · ${c.field} ${c.dup.join(", ")} · ${mode}`, () => {
        const rows = c.rows(c.xs);
        const deduped = [...new Set<string>(c.dup)];
        const got = surfaces(specOf(c.base, c.cols, { [c.field]: [...c.dup] }, mode), rows);
        const want = surfaces(specOf(c.base, c.cols, { [c.field]: deduped }, mode), rows);
        expect(Object.keys(got)).toEqual(Object.keys(want));
        for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k]);
      });
    }
  }

  it("timeline · series_order policy, cohort, policy", () => {
    const base = {
      chartType: "timeline", title: "t", xAxisType: "temporal", data: "d.csv",
      columns: { x: "date", label: "title", series: "kind" }, timeline: { lanes: true },
    };
    const rows = [
      { date: "2026", title: "Policy begins", kind: "policy" },
      { date: "2030", title: "First cohort", kind: "cohort" },
      { date: "2034", title: "Second step", kind: "policy" },
    ] as unknown as TidyRow[];
    const got = surfaces({ ...base, series_order: ["policy", "cohort", "policy"] } as unknown as ChartSpec, rows);
    const want = surfaces({ ...base, series_order: ["policy", "cohort"] } as unknown as ChartSpec, rows);
    for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k]);
  });

  it("treemap · series_order A, B, A", () => {
    const base = {
      chartType: "treemap", title: "t", xAxisType: "categorical", data: "d.csv",
      columns: { x: "name", value: "amount", series: "group" },
    };
    const rows = [
      { name: "a1", amount: "300", group: "A" }, { name: "a2", amount: "100", group: "A" },
      { name: "b1", amount: "200", group: "B" }, { name: "c1", amount: "50", group: "C" },
    ] as unknown as TidyRow[];
    const got = surfaces({ ...base, series_order: ["B", "A", "B"] } as unknown as ChartSpec, rows);
    const want = surfaces({ ...base, series_order: ["B", "A"] } as unknown as ChartSpec, rows);
    for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k]);
  });
});

// ---------------------------------------------------------------------------------------------------
// With the repeat dropped, the legend, the marks and the hover agree.

/** `attr` value → the symbols its data markers are drawn with, in this element. */
function drawn(root: Element, attr: "data-shape" | "data-series"): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const el of Array.from(root.querySelectorAll(`g[aria-label="dot"] [${attr}]`))) {
    (out[el.getAttribute(attr)!] ??= new Set()).add(symbolOf(el));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

/** The PNG's legend, in order: [label, symbol] per icon that is a symbol (colour chips are rects). */
function pngLegend(png: Element): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const g of Array.from(png.querySelectorAll("g.tbl-icon"))) {
    const mark = g.querySelector("path, circle");
    if (mark) out.push([g.nextElementSibling?.textContent ?? "?", symbolOf(mark)]);
  }
  return out;
}

/** The live legend's rows carrying `attr`, in order: [value, swatch symbol]. */
function liveLegend(host: Element, attr: "data-shape" | "data-series"): Array<[string, string]> {
  return Array.from(host.querySelectorAll(`.tbl-legend-item[${attr}]`)).map((b) => [
    b.getAttribute(attr)!,
    symbolOf(b.querySelector(".tbl-legend-swatch path, .tbl-legend-swatch circle")!),
  ]);
}

/** mockRect1to1 boxes <text> and <circle> only; a symbol marker is a translated <path>, and the dot
 *  plot's cursor finds its categories from those marks. */
function mockPathMarks(svg: SVGSVGElement): void {
  for (const el of Array.from(svg.querySelectorAll<SVGPathElement>('g[aria-label="dot"] path'))) {
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(el.getAttribute("transform") ?? "");
    if (!m) continue;
    const x = +m[1]!, y = +m[2]!;
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: x - 4, right: x + 4, top: y - 4, bottom: y + 4, width: 8, height: 8, x: x - 4, y: y - 4 }),
      configurable: true,
    });
  }
}

/** Every pane (or the one chart) of renderChart/renderFigure, live and in the PNG. */
function everySvg(spec: ChartSpec, rows: TidyRow[]): Array<[string, Element]> {
  const out: Array<[string, Element]> = [];
  if (spec.small_multiples) {
    renderFigure(spec, rows, { width: INNER_W }).panes.forEach((p) => out.push([`renderFigure pane ${p.value}`, p.svg as Element]));
  } else {
    out.push(["renderChart", renderChart(spec, rows, { width: 720 }).svg as Element]);
  }
  const host = mount(spec, rows, 420);
  Array.from(host.querySelectorAll(".figure-pane svg, .figure-canvas svg")).forEach((s, i) => out.push([`live svg ${i}`, s]));
  out.push(["PNG", buildExportSvg(spec, rows)]);
  return out;
}

const POINT_KINDS = [
  { kind: "scatter", xs: ["1", "2"], base: { chartType: "scatter", xAxisType: "numeric" } },
  { kind: "dotplot", xs: ["u", "v"], base: { chartType: "dotplot", xAxisType: "categorical" } },
] as const;

const SHAPE_DUPS = [
  { order: ["M", "M", "N"], marks: { M: ["circle"], N: ["square"] }, legend: [["M", "circle"], ["N", "square"]] },
  { order: ["M", "N", "M"], marks: { M: ["circle"], N: ["square"] }, legend: [["M", "circle"], ["N", "square"]] },
] as const;

for (const k of POINT_KINDS) {
  for (const d of SHAPE_DUPS) {
    for (const mode of MODES) {
      describe(`${k.kind} · shape_order ${d.order.join(", ")} · ${mode}`, () => {
        const spec = specOf(k.base, SHAPE_COLS, { shape_order: [...d.order] }, mode);
        const rows = shapeRows(k.xs);

        it("every pane draws each shape with its first entry's marker", () => {
          for (const [where, svg] of everySvg(spec, rows)) expect(drawn(svg, "data-shape"), where).toEqual(d.marks);
        });

        it("the shape legend has one row per shape, keyed with the marker drawn", () => {
          const items =
            mode === "standalone" ? renderChart(spec, rows, { width: 720 }).shapeLegendItems : renderFigure(spec, rows, { width: INNER_W }).shapeLegendItems;
          expect((items ?? []).map((i) => [i.shape, i.markerSymbol])).toEqual(d.legend);
          expect(liveLegend(mount(spec, rows, 420), "data-shape")).toEqual(d.legend);
          expect(pngLegend(buildExportSvg(spec, rows))).toEqual(d.legend);
        });
      });
    }
  }
}

const SERIES_KINDS = [
  { kind: "line, points: true", xs: ["2020-01-01", "2021-01-01", "2022-01-01"], base: { chartType: "line", points: true, xAxisType: "temporal" }, cols: {} },
  { kind: "dotplot, shape = series", xs: ["u", "v"], base: { chartType: "dotplot", xAxisType: "categorical" }, cols: { shape: "series" } },
  { kind: "scatter, shape = series", xs: ["1", "2"], base: { chartType: "scatter", xAxisType: "numeric" }, cols: { shape: "series" } },
] as const;

const SERIES_DUPS = [
  { order: ["A", "A", "B"], marks: { A: ["circle"], B: ["square"] }, rows: [["A", "circle"], ["B", "square"]] },
  { order: ["B", "A", "B"], marks: { B: ["circle"], A: ["square"] }, rows: [["B", "circle"], ["A", "square"]] },
] as const;

for (const k of SERIES_KINDS) {
  for (const d of SERIES_DUPS) {
    for (const mode of MODES) {
      describe(`${k.kind} · series_order ${d.order.join(", ")} · ${mode}`, () => {
        const spec = specOf(k.base, { ...SERIES_COLS, ...k.cols }, { series_order: [...d.order] }, mode);
        const rows = seriesRows(k.xs);

        it("every pane draws each series with its first entry's marker", () => {
          for (const [where, svg] of everySvg(spec, rows)) expect(drawn(svg, "data-series"), where).toEqual(d.marks);
        });

        it("the legend and every pane's key rows have one row per series, keyed with the marker drawn", () => {
          const keyed = (rs: ReadonlyArray<{ series: string; markerSymbol?: string }> | null | undefined) =>
            (rs ?? []).map((r) => [r.series, r.markerSymbol]);
          if (mode === "standalone") {
            const r = renderChart(spec, rows, { width: 720 });
            expect(keyed(r.legendItems)).toEqual(d.rows);
            expect(keyed(r.seriesKeyRows)).toEqual(d.rows);
          } else {
            const fig = renderFigure(spec, rows, { width: INNER_W });
            expect(keyed(fig.legendItems)).toEqual(d.rows);
            for (const p of fig.panes) expect(keyed(p.seriesKeyRows), `pane ${p.value}`).toEqual(d.rows);
          }
          expect(liveLegend(mount(spec, rows, 420), "data-series")).toEqual(d.rows);
          expect(pngLegend(buildExportSvg(spec, rows))).toEqual(d.rows);
        });
      });
    }
  }
}

/** Mount the coordinated two-pane figure, move the cursor across pane 0, and collect every hover dot
 *  drawn (series → symbols, by stroke colour). */
function coordDots(spec: ChartSpec, rows: TidyRow[]): Record<string, string[]> {
  const host = mount(spec, rows, 420);
  const fig = renderFigure(spec, rows, { width: 838, height: 420 });
  const seriesByColor = new Map([...fig.panes[0]!.colors!].map(([s, c]) => [c, s] as const));
  const panes = Array.from(host.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
  expect(panes.length).toBe(2);
  panes.forEach(mockRect1to1);
  panes.forEach(mockPathMarks);
  const pane = panes[0]!;
  const out: Record<string, Set<string>> = {};
  const W = pane.viewBox.baseVal.width;
  for (let i = 1; i < 20; i++) {
    pane.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
      new PointerEvent("pointermove", { clientX: (W * i) / 20, clientY: pane.viewBox.baseVal.height / 2, bubbles: true }),
    );
    for (const dot of Array.from(host.querySelectorAll(".tbl-coord-dot"))) {
      (out[seriesByColor.get(dot.getAttribute("stroke")!) ?? "?"] ??= new Set()).add(symbolOf(dot));
    }
  }
  return Object.fromEntries(Object.entries(out).map(([s, v]) => [s, [...v]]));
}

for (const k of SERIES_KINDS.filter((k) => k.kind !== "scatter, shape = series")) {
  for (const d of SERIES_DUPS) {
    for (const mode of ["shared", "per-pane"] as const) {
      it(`${k.kind} · series_order ${d.order.join(", ")} · ${mode}: each coordinated hover dot is the series' drawn marker`, () => {
        const spec = specOf(k.base, { ...SERIES_COLS, ...k.cols }, { series_order: [...d.order] }, mode);
        expect(coordDots(spec, seriesRows(k.xs))).toEqual(d.marks);
      });
    }
  }
}

for (const mode of MODES) {
  it(`scatter, shape = series · series_order A, A, B · ${mode}: the point card keys the drawn marker`, () => {
    const spec = specOf(
      { chartType: "scatter", xAxisType: "numeric" },
      { ...SERIES_COLS, shape: "series" },
      { series_order: ["A", "A", "B"] },
      mode,
    );
    const host = mount(spec, seriesRows(["1", "2"]), 420);
    const seen: Record<string, Set<string>> = {};
    for (const m of Array.from(host.querySelectorAll('g[aria-label="dot"] [data-series]'))) {
      m.dispatchEvent(new PointerEvent("pointerenter"));
      const swatch = document.body.querySelector(".tbl-tooltip .tbl-tooltip-head path, .tbl-tooltip .tbl-tooltip-head circle");
      (seen[m.getAttribute("data-series")!] ??= new Set()).add(swatch ? symbolOf(swatch) : "none");
    }
    expect(Object.fromEntries(Object.entries(seen).map(([s, v]) => [s, [...v]]))).toEqual({ A: ["circle"], B: ["square"] });
  });
}

for (const mode of ["shared", "per-pane"] as const) {
  it(`dotplot · shape_order M, M, N · ${mode}: each hover dot is its point's drawn marker`, () => {
    const spec = specOf(POINT_KINDS[1].base, SHAPE_COLS, { shape_order: ["M", "M", "N"] }, mode);
    // A draws M at u and N at v; B the reverse, so both shapes sit at every category.
    const rows = (["P", "Q"] as const).flatMap((pane) => [
      { pane, series: "A", shp: "M", x: "u", value: "1" },
      { pane, series: "B", shp: "N", x: "u", value: "2" },
      { pane, series: "A", shp: "N", x: "v", value: "3" },
      { pane, series: "B", shp: "M", x: "v", value: "4" },
    ]) as unknown as TidyRow[];
    const host = mount(spec, rows, 420);
    const fig = renderFigure(spec, rows, { width: 838, height: 420 });
    const seriesByColor = new Map([...fig.panes[0]!.colors!].map(([s, c]) => [c, s] as const));
    const panes = Array.from(host.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    panes.forEach(mockRect1to1);
    panes.forEach(mockPathMarks);
    const pane = panes[1]!;
    for (const cat of ["u", "v"]) {
      const marks = Array.from(pane.querySelectorAll(`g[aria-label="dot"] [data-category="${cat}"]`));
      expect(marks.length).toBeGreaterThan(0);
      const cx = marks.reduce((a, m) => a + +/translate\(\s*([-\d.]+)/.exec(m.getAttribute("transform") ?? "")![1]!, 0) / marks.length;
      pane.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
        new PointerEvent("pointermove", { clientX: cx, clientY: pane.viewBox.baseVal.height / 2, bubbles: true }),
      );
      const drawnAt = Object.fromEntries(marks.map((m) => [m.getAttribute("data-series")!, symbolOf(m)]));
      expect(drawnAt, cat).toEqual(cat === "u" ? { A: "circle", B: "square" } : { A: "square", B: "circle" });
      const dots = Object.fromEntries(
        Array.from(pane.querySelectorAll(".tbl-coord-dot")).map((d) => [seriesByColor.get(d.getAttribute("stroke")!) ?? "?", symbolOf(d)]),
      );
      expect(dots, cat).toEqual(drawnAt);
    }
  });
}

// Panes that do not all carry every value: every pane draws a value with ONE marker, its first
// entry's position, so the panes agree with each other and with the legend.
const RAGGED_FIGS = [
  {
    name: "shape_order M, M, N; pane P draws only N",
    kinds: POINT_KINDS.map((k) => ({ ...k, cols: SHAPE_COLS })),
    extra: { shape_order: ["M", "M", "N"] },
    rows: (xs: readonly string[]) => [...shapeRows(xs, ["Q"]), ...shapeRows(xs, ["P"]).filter((r) => (r as unknown as { shp: string }).shp === "N")],
    attr: "data-shape" as const,
    expected: { M: "circle", N: "square" },
  },
  {
    name: "series_order A, A, B; pane P draws only B",
    kinds: SERIES_KINDS.map((k) => ({ ...k, cols: { ...SERIES_COLS, ...k.cols } })),
    extra: { series_order: ["A", "A", "B"] },
    rows: (xs: readonly string[]) => [...seriesRows(xs, ["Q"]), ...seriesRows(xs, ["P"]).filter((r) => (r as unknown as { series: string }).series === "B")],
    attr: "data-series" as const,
    expected: { A: "circle", B: "square" },
  },
];

for (const f of RAGGED_FIGS) {
  for (const k of f.kinds) {
    for (const mode of ["shared", "per-pane"] as const) {
      it(`${k.kind} · ${f.name} · ${mode}: every pane draws a value with one marker`, () => {
        const spec = specOf(k.base, k.cols, f.extra, mode);
        for (const [where, svg] of everySvg(spec, f.rows(k.xs))) {
          for (const [v, syms] of Object.entries(drawn(svg, f.attr))) expect(syms, `${where}, ${v}`).toEqual([f.expected[v as keyof typeof f.expected]]);
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Every exported renderer entry drops the repeat itself, not only the wrappers above: a direct call
// with a repeat equals the same call with the repeat removed.

/** A render result, serialised whole: SVG elements as markup (clip ids made stable), Maps and Sets
 *  as their entries, functions by name only. */
function serialised(v: unknown): string {
  return stable(JSON.stringify(v, (_k, x: unknown) => {
    if (x instanceof Element) return x.outerHTML;
    if (x instanceof Map) return { map: [...x.entries()] };
    if (x instanceof Set) return { set: [...x] };
    if (typeof x === "function") return "fn";
    return x;
  }));
}

describe("a direct renderer call with a repeat equals the call without it", () => {
  it("renderPane · stacked · series_order A, A (two net dots before)", () => {
    const base = {
      chartType: "stacked", title: "t", xAxisType: "categorical", data: "d.csv",
      columns: { x: "x", value: "value", series: "series" },
    };
    const rows = [{ x: "X", series: "A", value: "-3" }, { x: "Y", series: "A", value: "2" }] as unknown as TidyRow[];
    const got = renderPane({ ...base, series_order: ["A", "A"] } as unknown as ChartSpec, rows, { width: 720 });
    const want = renderPane({ ...base, series_order: ["A"] } as unknown as ChartSpec, rows, { width: 720 });
    expect(got.seriesNames).toEqual(["A"]);
    expect(serialised(got)).toBe(serialised(want));
  });

  it("renderPane · scatter, shape column · shape_order M, M, N", () => {
    const spec = (shape_order: string[]): ChartSpec => specOf(
      { chartType: "scatter", xAxisType: "numeric" }, SHAPE_COLS, { shape_order }, "standalone");
    const rows = shapeRows(["1", "2"], ["P"]);
    const got = renderPane(spec(["M", "M", "N"]), rows, { width: 720 });
    const want = renderPane(spec(["M", "N"]), rows, { width: 720 });
    expect(got.layers.shapeNames).toEqual(["M", "N"]);
    expect(serialised(got)).toBe(serialised(want));
  });

  it("shapeDomainOver · shape_order N, M, N", () => {
    const spec = (shape_order: string[]): ChartSpec => specOf(
      { chartType: "scatter", xAxisType: "numeric" }, SHAPE_COLS, { shape_order }, "standalone");
    const rows = shapeRows(["1", "2"], ["P"]);
    expect(shapeDomainOver(spec(["N", "M", "N"]), rows)).toEqual(shapeDomainOver(spec(["N", "M"]), rows));
    expect(shapeDomainOver(spec(["N", "M", "N"]), rows)).toEqual(["N", "M"]);
  });

  it("renderTreemap · series_order A, A, B (three legend rows before)", () => {
    const base = {
      chartType: "treemap", title: "t", xAxisType: "categorical", data: "d.csv",
      columns: { x: "name", value: "amount", series: "group" },
    };
    const rows = [
      { name: "a1", amount: "300", group: "A" }, { name: "a2", amount: "100", group: "A" },
      { name: "b1", amount: "200", group: "B" },
    ] as unknown as TidyRow[];
    const got = renderTreemap({ ...base, series_order: ["A", "A", "B"] } as unknown as ChartSpec, rows, { width: 720 });
    const want = renderTreemap({ ...base, series_order: ["A", "B"] } as unknown as ChartSpec, rows, { width: 720 });
    expect(got.seriesKeyRows!.map((r) => r.series)).toEqual(["A", "B"]);
    expect(serialised(got)).toBe(serialised(want));
  });

  it("renderTimeline · series_order policy, cohort, policy", () => {
    const base = {
      chartType: "timeline", title: "t", xAxisType: "temporal", data: "d.csv",
      columns: { x: "date", label: "title", series: "kind" }, timeline: { lanes: true },
    };
    const rows = [
      { date: "2026", title: "Policy begins", kind: "policy" },
      { date: "2030", title: "First cohort", kind: "cohort" },
      { date: "2034", title: "Second step", kind: "policy" },
    ] as unknown as TidyRow[];
    const got = renderTimeline({ ...base, series_order: ["policy", "cohort", "policy"] } as unknown as ChartSpec, rows, { width: 720 });
    const want = renderTimeline({ ...base, series_order: ["policy", "cohort"] } as unknown as ChartSpec, rows, { width: 720 });
    expect(serialised(got)).toBe(serialised(want));
  });
});
