// @vitest-environment jsdom
//
// A DUPLICATED `shape_order` OR `series_order` ENTRY RENDERS AS IT DID BEFORE THE FIGURE NUMBERED
// MARKERS FROM ONE LIST (pre-F12, 8844050) — standalone and faceted, live and in the PNG.
//
// Validation accepts `[M, M, N]`. Two things read such a list, differently, and always have:
//  - Plot's ordinal symbol scale keeps the FIRST occurrence of each value and pairs the k-th distinct
//    value with the k-th range entry, so M draws a circle and N a square;
//  - every list the engine builds row by row (the shape legend, the series key rows behind the legend
//    and the hover card, the hover-dot and tooltip symbol maps) numbers its rows by position, so the
//    legend reads M circle, M square, N triangle.
// When panes began taking each value's position in the FIGURE's list (indexOf), a duplicate made both
// readings collapse onto the first occurrence: N drew M's circle and the legend lost its square row.
// These tests pin the pre-F12 output, which is not a claim that it is right: it is the output every
// published figure with such a list already has (Ruling 65).
import { describe, it, expect, afterEach } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderFigure } from "../src/engine/figure";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { MARKER_SYMBOLS } from "../src/engine/theme";
import { symbolPathD } from "../src/engine/symbols";
import { mockRect1to1 } from "./helpers/hover-harness";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

afterEach(() => document.body.replaceChildren());

const letters = (d: string): string => d.replace(/[^A-Za-z]/g, "");
const BY_LETTERS = new Map(MARKER_SYMBOLS.map((s) => [letters(symbolPathD(s, 50)), s as string] as const));
const symbolOf = (el: Element): string =>
  el.tagName.toLowerCase() === "circle" ? "circle" : BY_LETTERS.get(letters(el.getAttribute("d") ?? "")) ?? "?";

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

const mount = (spec: ChartSpec, rows: TidyRow[]): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  mountChart(host, { spec, rows, width: 838, height: 420 });
  return host;
};

type Mode = "standalone" | "shared" | "per-pane";
const MODES: Mode[] = ["standalone", "shared", "per-pane"];

/** Both panes carry M at the first x and N at the second, for series A and B. */
const shapeRows = (xs: readonly string[], panes: readonly string[] = ["P", "Q"]): TidyRow[] =>
  panes.flatMap((pane) =>
    (["A", "B"] as const).flatMap((series, j) => [
      { pane, series, shp: "M", x: xs[0]!, value: String(1 + j) },
      { pane, series, shp: "N", x: xs[1]!, value: String(3 + j) },
    ]),
  ) as unknown as TidyRow[];
/** Both panes carry A and B at every x. */
const seriesRows = (xs: readonly string[], panes: readonly string[] = ["P", "Q"]): TidyRow[] =>
  panes.flatMap((pane) =>
    xs.flatMap((x, i) => [
      { pane, series: "A", x, value: String(1 + i) },
      { pane, series: "B", x, value: String(2 + i) },
    ]),
  ) as unknown as TidyRow[];

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

/** Every pane (or the one chart) of renderChart/renderFigure, live and in the PNG. */
function everySvg(spec: ChartSpec, rows: TidyRow[]): Array<[string, Element]> {
  const out: Array<[string, Element]> = [];
  if (spec.small_multiples) {
    renderFigure(spec, rows, { width: INNER_W }).panes.forEach((p) => out.push([`renderFigure pane ${p.value}`, p.svg as Element]));
  } else {
    out.push(["renderChart", renderChart(spec, rows, { width: 720 }).svg as Element]);
  }
  const host = mount(spec, rows);
  Array.from(host.querySelectorAll(".figure-pane svg, .figure-canvas svg")).forEach((s, i) => out.push([`live svg ${i}`, s]));
  out.push(["PNG", buildExportSvg(spec, rows)]);
  return out;
}

const POINT_KINDS = [
  { kind: "scatter", xs: ["1", "2"], base: { chartType: "scatter", xAxisType: "numeric" } },
  { kind: "dotplot", xs: ["u", "v"], base: { chartType: "dotplot", xAxisType: "categorical" } },
] as const;
const SHAPE_COLS = { x: "x", value: "value", series: "series", facet: "pane", shape: "shp" };

// ---------------------------------------------------------------------------------------------------
// A duplicated shape_order entry.

const SHAPE_DUPS = [
  { order: ["M", "M", "N"], marks: { M: ["circle"], N: ["square"] }, legend: [["M", "circle"], ["M", "square"], ["N", "triangle"]] },
  { order: ["M", "N", "M"], marks: { M: ["circle"], N: ["square"] }, legend: [["M", "circle"], ["N", "square"], ["M", "triangle"]] },
] as const;

for (const k of POINT_KINDS) {
  for (const d of SHAPE_DUPS) {
    for (const mode of MODES) {
      describe(`${k.kind} · shape_order ${d.order.join(", ")} · ${mode}`, () => {
        const spec = specOf(k.base, SHAPE_COLS, { shape_order: [...d.order] }, mode);
        const rows = shapeRows(k.xs);

        it("every pane draws each shape as Plot's scale reads the list (first occurrence)", () => {
          for (const [where, svg] of everySvg(spec, rows)) expect(drawn(svg, "data-shape"), where).toEqual(d.marks);
        });

        it("the shape legend numbers its rows by position, duplicate included", () => {
          const items =
            mode === "standalone" ? renderChart(spec, rows, { width: 720 }).shapeLegendItems : renderFigure(spec, rows, { width: INNER_W }).shapeLegendItems;
          expect((items ?? []).map((i) => [i.shape, i.markerSymbol])).toEqual(d.legend);
          expect(liveLegend(mount(spec, rows), "data-shape")).toEqual(d.legend);
          expect(pngLegend(buildExportSvg(spec, rows))).toEqual(d.legend);
        });
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// A duplicated series_order entry, where the series carries a marker.

const SERIES_KINDS = [
  { kind: "line, points: true", xs: ["2020-01-01", "2021-01-01", "2022-01-01"], base: { chartType: "line", points: true, xAxisType: "temporal" }, cols: {} },
  { kind: "dotplot, shape = series", xs: ["u", "v"], base: { chartType: "dotplot", xAxisType: "categorical" }, cols: { shape: "series" } },
  { kind: "scatter, shape = series", xs: ["1", "2"], base: { chartType: "scatter", xAxisType: "numeric" }, cols: { shape: "series" } },
] as const;

const SERIES_DUPS = [
  { order: ["A", "A", "B"], marks: { A: ["circle"], B: ["square"] }, rows: [["A", "circle"], ["A", "square"], ["B", "triangle"]] },
  { order: ["B", "A", "B"], marks: { B: ["circle"], A: ["square"] }, rows: [["B", "circle"], ["A", "square"], ["B", "triangle"]] },
] as const;

for (const k of SERIES_KINDS) {
  for (const d of SERIES_DUPS) {
    for (const mode of MODES) {
      describe(`${k.kind} · series_order ${d.order.join(", ")} · ${mode}`, () => {
        const spec = specOf(k.base, { x: "x", value: "value", series: "series", facet: "pane", ...k.cols }, { series_order: [...d.order] }, mode);
        const rows = seriesRows(k.xs);

        it("every pane draws each series as Plot's scale reads the list (first occurrence)", () => {
          for (const [where, svg] of everySvg(spec, rows)) expect(drawn(svg, "data-series"), where).toEqual(d.marks);
        });

        it("the legend and every pane's key rows number by position, duplicate included", () => {
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
          expect(liveLegend(mount(spec, rows), "data-series")).toEqual(d.rows);
          expect(pngLegend(buildExportSvg(spec, rows))).toEqual(d.rows);
        });
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Hover: the coordinated hover dot (line, dot plot) and the scatter point card's marker. Each keys a
// series or shape through a MAP built row by row from the numbered list, so the later duplicate's
// number wins: pre-F12 they drew A a square and B a triangle under [A, A, B], and B a triangle under
// [B, A, B].

const HOVER_DOTS = [
  { order: ["A", "A", "B"], dots: { A: ["square"], B: ["triangle"] } },
  { order: ["B", "A", "B"], dots: { A: ["square"], B: ["triangle"] } },
] as const;

/** Mount the coordinated two-pane figure, move the cursor across pane 0, and collect every hover dot
 *  drawn (series → symbols, by stroke colour). */
function coordDots(spec: ChartSpec, rows: TidyRow[]): Record<string, string[]> {
  const host = mount(spec, rows);
  // The PANE's colours: under a duplicated series_order the figure's own colour map numbers the later
  // duplicate (buildColorMap overwrites), while panes index the figure list. Pre-F12, unchanged.
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
  for (const d of HOVER_DOTS) {
    for (const mode of ["shared", "per-pane"] as const) {
      it(`${k.kind} · series_order ${d.order.join(", ")} · ${mode}: the coordinated hover dots`, () => {
        const spec = specOf(k.base, { x: "x", value: "value", series: "series", facet: "pane", ...k.cols }, { series_order: [...d.order] }, mode);
        expect(coordDots(spec, seriesRows(k.xs))).toEqual(d.dots);
      });
    }
  }
}

for (const mode of MODES) {
  it(`scatter, shape = series · series_order A, A, B · ${mode}: the point card's marker`, () => {
    const spec = specOf(
      { chartType: "scatter", xAxisType: "numeric" },
      { x: "x", value: "value", series: "series", facet: "pane", shape: "series" },
      { series_order: ["A", "A", "B"] },
      mode,
    );
    const host = mount(spec, seriesRows(["1", "2"]));
    const seen: Record<string, Set<string>> = {};
    for (const m of Array.from(host.querySelectorAll('g[aria-label="dot"] [data-series]'))) {
      m.dispatchEvent(new PointerEvent("pointerenter"));
      const swatch = document.body.querySelector(".tbl-tooltip .tbl-tooltip-head path, .tbl-tooltip .tbl-tooltip-head circle");
      (seen[m.getAttribute("data-series")!] ??= new Set()).add(swatch ? symbolOf(swatch) : "none");
    }
    expect(Object.fromEntries(Object.entries(seen).map(([s, v]) => [s, [...v]]))).toEqual({ A: ["square"], B: ["triangle"] });
  });
}

// ---------------------------------------------------------------------------------------------------
// A separate shape column on a dot plot: the hover dot draws the marker of the point it sits on
// (F12 fix 1), a duplicated shape_order entry included.

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
    const host = mount(spec, rows);
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

// ---------------------------------------------------------------------------------------------------
// Panes that do not all carry every value: every pane draws a value with ONE marker, its first
// occurrence's position in the figure's list (Plot's own reading of the list), so the panes agree.

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
    kinds: SERIES_KINDS.map((k) => ({ ...k, cols: { x: "x", value: "value", series: "series", facet: "pane", ...k.cols } })),
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
