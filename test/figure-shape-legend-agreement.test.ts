// @vitest-environment jsdom
//
// A SEPARATE SHAPE CHANNEL (`columns.shape` not the series) DRAWS EACH SHAPE WITH THE MARKER THE
// FIGURE'S SHAPE LEGEND KEYS IT WITH — in every pane, live and in the PNG — and the coordinated
// hover dot draws the marker of the point it sits on.
//
// Each pane used to number its symbols by its OWN shape list, and the shape legend was pane 0's.
// A pane lacking a shape drew the next one with the wrong marker (even with `shape_order`), and a
// shape pane 0 lacked had no legend row at all. The figure now resolves one shape list (as it does
// one series list for colours) and every pane, and the legend, index it. Separately, the dot plot's
// coordinated hover dot chose a symbol per SERIES, discarding the shape the point is drawn with.
import { describe, it, expect, afterEach } from "vitest";
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

/** shape value → the set of symbols its markers are drawn with, in this element. */
function drawnShapes(root: Element): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const el of Array.from(root.querySelectorAll('g[aria-label="dot"] [data-shape]'))) {
    const s = el.getAttribute("data-shape")!;
    if (!out.has(s)) out.set(s, new Set());
    out.get(s)!.add(symbolOf(el));
  }
  return out;
}

type Obs = readonly [pane: string, series: string, shape: string];
const rowsFor = (obs: readonly Obs[], xs: readonly string[]): TidyRow[] =>
  obs.flatMap(([pane, series, shp]) =>
    xs.map((x, i) => ({ pane, series, shp, x, value: String(1 + i + (series === "B" ? 0.5 : 0)) }) as unknown as TidyRow),
  );

const FIXTURES = [
  {
    // Codex's case 1: pane Q lacks s1, so it numbered s2 first.
    name: "a pane lacks a shape",
    obs: [["P", "A", "s1"], ["P", "B", "s2"], ["Q", "A", "s2"], ["Q", "B", "s2"]],
    legend: { s1: "circle", s2: "square" },
  },
  {
    // The same, with shape_order: the pane FILTERED the order to its own shapes before numbering.
    name: "a pane lacks a shape, with shape_order",
    obs: [["P", "A", "s1"], ["P", "B", "s2"], ["Q", "A", "s2"], ["Q", "B", "s2"]],
    extra: { shape_order: ["s1", "s2"] },
    legend: { s1: "circle", s2: "square" },
  },
  {
    // Codex's case 2: pane 0 lacks s1, so the legend (pane 0's) had no s1 row; pane Q met s1 first.
    name: "the first pane lacks a shape",
    obs: [["P", "A", "s2"], ["P", "B", "s2"], ["Q", "A", "s1"], ["Q", "B", "s2"]],
    legend: { s2: "circle", s1: "square" },
  },
  {
    // shape_order is a filter as well as an order: s1 is drawn nowhere and keyed nowhere.
    name: "shape_order leaves a shape out",
    obs: [["P", "A", "s1"], ["P", "B", "s2"], ["Q", "A", "s2"], ["Q", "B", "s3"]],
    extra: { shape_order: ["s3", "s2"] },
    legend: { s3: "circle", s2: "square" },
  },
  {
    // A shape found only in a pane pane_order leaves out is drawn nowhere: it gets no legend row and
    // takes no symbol position, so the drawn shapes number as the panes always numbered them.
    name: "a shape only in an excluded pane",
    obs: [["R", "A", "s0"], ["P", "A", "s1"], ["P", "B", "s2"], ["Q", "A", "s2"], ["Q", "B", "s2"]],
    pane_order: ["P", "Q"],
    legend: { s1: "circle", s2: "square" },
  },
  {
    // shape_order may name the blank shape value. The pane keeps it in its domain (and draws it), so
    // the figure's list must too: it was dropped there, and both shapes drew the figure's first
    // marker while the shape legend lost the blank row.
    name: "shape_order names the blank shape",
    obs: [["P", "A", ""], ["P", "B", "M"], ["Q", "A", ""], ["Q", "B", "M"]],
    extra: { shape_order: ["", "M"], shape_labels: { "": "Other", M: "Main" } },
    labels: { "": "Other", M: "Main" },
    legend: { "": "circle", M: "square" },
  },
] as const;

const KINDS = [
  { kind: "scatter", xs: ["1", "2"], base: { chartType: "scatter", xAxisType: "numeric" } },
  { kind: "dotplot", xs: ["u", "v"], base: { chartType: "dotplot", xAxisType: "categorical" } },
] as const;

type SpecBits = { readonly name: string; readonly extra?: object; readonly pane_order?: readonly string[] };
const specFor = (k: (typeof KINDS)[number], f: SpecBits, mode: "shared" | "per-pane"): ChartSpec =>
  ({
    ...k.base,
    title: "t",
    data: "d.csv",
    columns: { x: "x", value: "value", series: "series", facet: "pane", shape: "shp" },
    ...(f.extra ?? {}),
    small_multiples: { columns: 2, mode, ...(f.pane_order ? { pane_order: [...f.pane_order] } : {}) },
  }) as unknown as ChartSpec;

it("harness: the seven marker symbols are told apart by their path commands", () => {
  expect(BY_LETTERS.size).toBe(MARKER_SYMBOLS.length);
});

/** The shape legend, renderFigure's panes, the live figure and the PNG all key and draw each shape
 *  with the marker `expected` pins. `labels` maps a shape to its `shape_labels` name (the PNG legend
 *  is read by label). */
function agreementChecks(s: ChartSpec, rows: TidyRow[], expected: Record<string, string>, labels: Record<string, string> = {}): void {
  it("renderFigure: the shape legend keys every drawn shape, and every pane draws it so", () => {
    const fig = renderFigure(s, rows, { width: INNER_W });
    const legend = Object.fromEntries((fig.shapeLegendItems ?? []).map((i) => [i.shape, i.markerSymbol]));
    expect(legend).toEqual(expected);
    const everyDrawn = new Set<string>();
    for (const p of fig.panes) {
      const drawn = drawnShapes(p.svg as SVGSVGElement);
      expect(drawn.size, `pane ${p.value} drew no markers`).toBeGreaterThan(0);
      for (const [shape, syms] of drawn) {
        everyDrawn.add(shape);
        expect([...syms], `pane ${p.value}, shape ${shape}`).toEqual([legend[shape]]);
      }
    }
    // ... and lists exactly the shapes some pane draws.
    expect([...everyDrawn].sort()).toEqual(Object.keys(legend).sort());
  });

  it("live: every pane's markers match the live shape legend's swatch", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: s, rows, width: INNER_W });
    const legend = Object.fromEntries(
      Array.from(host.querySelectorAll(".tbl-legend-item[data-shape]")).map((b) => [
        b.getAttribute("data-shape")!,
        symbolOf(b.querySelector(".tbl-legend-swatch path, .tbl-legend-swatch circle")!),
      ]),
    );
    expect(legend).toEqual(expected);
    const panes = Array.from(host.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    expect(panes.length).toBe(2);
    for (const svg of panes) {
      for (const [shape, syms] of drawnShapes(svg)) expect([...syms], `shape ${shape}`).toEqual([legend[shape]]);
    }
  });

  it("PNG export: every pane's markers match the export shape legend's icons", () => {
    const png = buildExportSvg(s, rows);
    const shapeByLabel = new Map(Object.entries(labels).map(([shape, label]) => [label, shape] as const));
    // Each legend icon is followed by its label; the colour rows are chips (<rect>), the shape
    // rows symbols. Series are A/B and shapes s0-s3, M and N (or their labels), so the labels
    // cannot collide.
    const legend: Record<string, string> = {};
    for (const g of Array.from(png.querySelectorAll("g.tbl-icon"))) {
      const mark = g.querySelector("path, circle");
      const label = g.nextElementSibling?.textContent ?? "?";
      if (mark) legend[shapeByLabel.get(label) ?? label] = symbolOf(mark);
    }
    expect(legend).toEqual(expected);
    const drawn = drawnShapes(png);
    expect(drawn.size).toBeGreaterThan(0);
    for (const [shape, syms] of drawn) expect([...syms], `shape ${shape}`).toEqual([legend[shape]]);
  });
}

for (const k of KINDS) {
  for (const f of FIXTURES) {
    for (const mode of ["shared", "per-pane"] as const) {
      describe(`${k.kind} · ${f.name} · ${mode}`, () => {
        agreementChecks(specFor(k, f, mode), rowsFor(f.obs, k.xs), f.legend, "labels" in f ? f.labels : {});
      });
    }
  }
}

// A figure whose panes ALREADY drew every shape with one marker, which the legend keyed, must render
// as it did before the figure resolved one shape list: that list is the panes' own rule (their rows,
// their category order) applied over every drawn pane, so it is the list each pane resolved. Each of
// these resolved a different list from the raw rows, and moved every marker. Pinned to the output
// before the change.
const tidy = (pane: string, series: string, shp: string, x: string, value: number): TidyRow =>
  ({ pane, series, shp, x, value: String(value) }) as unknown as TidyRow;
/** Both panes: M at the first x, N at the second, for series A and B. */
const consistentPanes = (xs: readonly string[]): TidyRow[] =>
  ["P", "Q"].flatMap((pane) => [
    tidy(pane, "A", "M", xs[0]!, 1),
    tidy(pane, "B", "M", xs[0]!, 2),
    tidy(pane, "A", "N", xs[1]!, 3),
    tidy(pane, "B", "N", xs[1]!, 4),
  ]);
const CONSISTENT = [
  {
    // The pane meets its rows in x_order, so v (shape N) first: N is the first marker.
    name: "x_order puts the second shape's category first",
    kinds: ["dotplot"],
    extra: { x_order: ["v", "u"] },
    rows: (xs: readonly string[]) => consistentPanes(xs),
    legend: { N: "circle", M: "square" },
  },
  {
    name: "the first row sits in a pane pane_order leaves out",
    kinds: ["scatter", "dotplot"],
    pane_order: ["P", "Q"],
    rows: (xs: readonly string[]) => [tidy("R", "A", "N", xs[0]!, 1), ...consistentPanes(xs)],
    legend: { M: "circle", N: "square" },
  },
  {
    name: "the first row has a blank facet cell",
    kinds: ["scatter", "dotplot"],
    rows: (xs: readonly string[]) => [tidy("", "A", "N", xs[0]!, 1), ...consistentPanes(xs)],
    legend: { M: "circle", N: "square" },
  },
  {
    // A row whose x the axis cannot place is dropped by the pane before it reads shapes.
    name: "the first row has an x the axis drops",
    kinds: ["scatter", "dotplot"],
    rows: (xs: readonly string[], bad: string) => [tidy("P", "A", "N", bad, 1), ...consistentPanes(xs)],
    legend: { M: "circle", N: "square" },
  },
] as const;
const BAD_X: Record<string, string> = { scatter: "n/a", dotplot: "" };

for (const k of KINDS) {
  for (const f of CONSISTENT) {
    if (!(f.kinds as readonly string[]).includes(k.kind)) continue;
    for (const mode of ["shared", "per-pane"] as const) {
      describe(`${k.kind} · already consistent: ${f.name} · ${mode}`, () => {
        agreementChecks(specFor(k, f, mode), f.rows(k.xs, BAD_X[k.kind]!), f.legend);
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// The dot plot's coordinated hover dot: the symbol of the point it sits on.

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

const markX = (el: Element): number => {
  const m = /translate\(\s*([-\d.]+)/.exec(el.getAttribute("transform") ?? "");
  return m ? +m[1]! : +(el.getAttribute("cx") ?? 0);
};

/** Mount a coordinated two-pane dot plot, hover category `cat` on pane 1, and return pane 1's
 *  hover dots (series → symbol, by stroke colour) beside its drawn markers at that category. */
function hoverDots(spec: ChartSpec, rows: TidyRow[], cat: string) {
  const host = document.createElement("div");
  document.body.append(host);
  mountChart(host, { spec, rows, width: 838, height: 420 });
  const fig = renderFigure(spec, rows, { width: 838, height: 420 });
  const panes = Array.from(host.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
  expect(panes.length).toBe(2);
  panes.forEach(mockRect1to1);
  panes.forEach(mockPathMarks);
  const pane = panes[1]!;
  const marks = Array.from(pane.querySelectorAll(`g[aria-label="dot"] [data-category="${cat}"]`));
  expect(marks.length, `no markers at ${cat}, so this measures nothing`).toBeGreaterThan(0);
  const cx = marks.reduce((a, m) => a + markX(m), 0) / marks.length;
  pane.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
    new PointerEvent("pointermove", { clientX: cx, clientY: pane.viewBox.baseVal.height / 2, bubbles: true }),
  );
  const seriesByColor = new Map([...fig.colors].map(([s, c]) => [c, s] as const));
  const dots = new Map(
    Array.from(pane.querySelectorAll(".tbl-coord-dot")).map((d) => [seriesByColor.get(d.getAttribute("stroke")!) ?? "?", symbolOf(d)] as const),
  );
  const drawn = new Map(marks.map((m) => [m.getAttribute("data-series")!, symbolOf(m)] as const));
  return { dots, drawn };
}

for (const mode of ["shared", "per-pane"] as const) {
  const DOT_BASE = {
    chartType: "dotplot",
    xAxisType: "categorical",
    title: "t",
    data: "d.csv",
    small_multiples: { columns: 2, mode },
  } as const;

  describe(`dotplot · ${mode} · coordinated hover dot draws the drawn point's marker`, () => {
    // Codex's repro: shape_order [M, N] with A's shape N and B's shape M — A draws squares and B
    // circles, while the cursor drew A a circle and B a square (series positions).
    const rows = (["P", "Q"] as const).flatMap((pane) =>
      (["u", "v"] as const).flatMap((x, i) => [
        { pane, series: "A", shp: "N", x, value: String(1 + i) },
        { pane, series: "B", shp: "M", x, value: String(2 + i) },
      ]),
    ) as unknown as TidyRow[];
    const spec = {
      ...DOT_BASE,
      columns: { x: "x", value: "value", series: "series", facet: "pane", shape: "shp" },
      shape_order: ["M", "N"],
    } as unknown as ChartSpec;

    it("a separate shape column: each dot takes its point's shape", () => {
      const { dots, drawn } = hoverDots(spec, rows, "u");
      expect(Object.fromEntries(drawn)).toEqual({ A: "square", B: "circle" });
      expect(Object.fromEntries(dots)).toEqual(Object.fromEntries(drawn));
    });

    it("a shape that varies within a series across categories: the dot follows the category", () => {
      const varied = rows.map((r) => {
        const o = r as unknown as Record<string, string>;
        return (o.series === "A" && o.x === "v" ? { ...o, shp: "M" } : o) as unknown as TidyRow;
      });
      for (const cat of ["u", "v"]) {
        const { dots, drawn } = hoverDots(spec, varied, cat);
        expect(drawn.get("A"), cat).toBe(cat === "u" ? "square" : "circle");
        expect(Object.fromEntries(dots), cat).toEqual(Object.fromEntries(drawn));
        document.body.replaceChildren();
      }
    });

    it("an observation shape_order leaves out draws no point, and gets no dot", () => {
      const only = { ...spec, shape_order: ["M"] } as unknown as ChartSpec;
      const { dots, drawn } = hoverDots(only, rows, "u");
      expect([...drawn.keys()]).toEqual(["B"]);
      expect(Object.fromEntries(dots)).toEqual({ B: "circle" });
    });

    it("no shape column: every point is a circle, and so is every dot", () => {
      const plain = { ...DOT_BASE, columns: { x: "x", value: "value", series: "series", facet: "pane" } } as unknown as ChartSpec;
      const { dots, drawn } = hoverDots(plain, rows, "u");
      expect(Object.fromEntries(drawn)).toEqual({ A: "circle", B: "circle" });
      expect(Object.fromEntries(dots)).toEqual({ A: "circle", B: "circle" });
    });

    it("shape = series: each dot takes its series' marker (unchanged)", () => {
      const same = { ...DOT_BASE, columns: { x: "x", value: "value", series: "series", facet: "pane", shape: "series" } } as unknown as ChartSpec;
      const { dots, drawn } = hoverDots(same, rows, "u");
      expect(Object.fromEntries(drawn)).toEqual({ A: "circle", B: "square" });
      expect(Object.fromEntries(dots)).toEqual(Object.fromEntries(drawn));
    });
  });
}
