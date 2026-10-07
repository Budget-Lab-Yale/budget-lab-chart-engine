// @vitest-environment jsdom
//
// EVERY PANE DRAWS A SERIES WITH THE MARKER THE FIGURE LEGEND KEYS IT WITH — live and in the PNG.
//
// The legend assigns marker symbols by position in the FIGURE's series list (renderFigure's
// `figureSeries`). A pane used to assign them by position in its OWN list, so a pane that lacked a
// series, or met its series in a different order, drew a series with a marker the legend gave to
// another one. Colours never had this problem: panes index `paletteSeries`. Markers now index it too.
import { describe, it, expect, afterEach } from "vitest";
import { renderFigure } from "../src/engine/figure";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { MARKER_SYMBOLS } from "../src/engine/theme";
import { symbolPathD } from "../src/engine/symbols";
import { mockRect1to1, hoverFirstMark, PLOT_MIDDLE } from "./helpers/hover-harness";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

afterEach(() => document.body.replaceChildren());

/** A d3 symbol's path is identified by its command letters alone (size only scales the numbers);
 *  the seven marker symbols each have a distinct sequence, which the first test pins. */
const letters = (d: string): string => d.replace(/[^A-Za-z]/g, "");
const BY_LETTERS = new Map(MARKER_SYMBOLS.map((s) => [letters(symbolPathD(s, 50)), s as string] as const));
const symbolOf = (el: Element): string =>
  el.tagName.toLowerCase() === "circle" ? "circle" : BY_LETTERS.get(letters(el.getAttribute("d") ?? "")) ?? "?";

/** series → the set of symbols its data markers are drawn with, in this element. */
function drawnSymbols(root: Element): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const el of Array.from(root.querySelectorAll('g[aria-label="dot"] [data-series]'))) {
    const s = el.getAttribute("data-series")!;
    if (!out.has(s)) out.set(s, new Set());
    out.get(s)!.add(symbolOf(el));
  }
  return out;
}

const row = (pane: string, series: string, x: string, value: number): TidyRow =>
  ({ pane, series, x, value: String(value) }) as unknown as TidyRow;

// Codex's repro: C sits only in pane R, which pane_order leaves out, so the legend indexes [C, A, B]
// (A = square, B = triangle) while pane P indexed [A, B] and pane Q [B].
const RAGGED = { name: "ragged (a pane-less series, a pane missing a series)", order: [["R", "C"], ["P", "A"], ["P", "B"], ["Q", "B"]], pane_order: ["P", "Q"] } as const;
// No series_order and no missing series: pane Q simply meets B first.
const REORDERED = { name: "panes meet their series in different orders", order: [["P", "A"], ["P", "B"], ["Q", "B"], ["Q", "A"]] } as const;

const rowsFor = (f: { order: ReadonlyArray<readonly [string, string]> }, xs: string[]): TidyRow[] =>
  f.order.flatMap(([p, s]) => xs.map((x, i) => row(p, s, x, 1 + i)));

const KINDS = [
  { kind: "line, points: true", xs: ["2020-01-01", "2021-01-01"], base: { chartType: "line", points: true, xAxisType: "temporal" }, shape: false },
  { kind: "dotplot, shape = series", xs: ["u", "v"], base: { chartType: "dotplot", xAxisType: "categorical" }, shape: true },
  { kind: "scatter, shape = series", xs: ["1", "2"], base: { chartType: "scatter", xAxisType: "numeric" }, shape: true },
] as const;

const specFor = (k: (typeof KINDS)[number], mode: "shared" | "per-pane", pane_order?: readonly string[]): ChartSpec =>
  ({
    ...k.base,
    title: "t",
    data: "d.csv",
    columns: { x: "x", value: "value", series: "series", facet: "pane", ...(k.shape ? { shape: "series" } : {}) },
    small_multiples: { columns: 2, mode, ...(pane_order ? { pane_order: [...pane_order] } : {}) },
  }) as unknown as ChartSpec;

it("harness: the seven marker symbols are told apart by their path commands", () => {
  expect(BY_LETTERS.size).toBe(MARKER_SYMBOLS.length);
});

for (const k of KINDS) {
  for (const f of [RAGGED, REORDERED]) {
    for (const mode of ["shared", "per-pane"] as const) {
      describe(`${k.kind} · ${f.name} · ${mode}`, () => {
        const s = specFor(k, mode, "pane_order" in f ? f.pane_order : undefined);
        const rows = rowsFor(f, [...k.xs]);

        it("renderFigure: every pane draws each series with its legend marker", () => {
          const fig = renderFigure(s, rows, { width: INNER_W });
          const legend = new Map((fig.legendItems ?? []).map((i) => [i.series, i.markerSymbol]));
          expect(legend.size, "no legend, so this measures nothing").toBeGreaterThan(1);
          // The legend keeps indexing the FULL list (CONFIG-SPEC pane_order): C, drawn nowhere,
          // still holds the first marker, so A and B keep the markers they have with R included.
          if (f === RAGGED) expect(Object.fromEntries(legend)).toEqual({ A: "square", B: "triangle" });
          for (const p of fig.panes) {
            const drawn = drawnSymbols(p.svg as SVGSVGElement);
            expect(drawn.size, `pane ${p.value} drew no markers`).toBeGreaterThan(0);
            for (const [series, syms] of drawn) expect([...syms], `pane ${p.value}, series ${series}`).toEqual([legend.get(series)]);
          }
        });

        it("live: every pane's markers match the live legend's swatch", () => {
          const host = document.createElement("div");
          document.body.append(host);
          mountChart(host, { spec: s, rows, width: INNER_W });
          const legend = new Map(
            Array.from(host.querySelectorAll(".tbl-legend-item[data-series]")).map((b) => [
              b.getAttribute("data-series")!,
              symbolOf(b.querySelector(".tbl-legend-swatch path, .tbl-legend-swatch circle")!),
            ]),
          );
          expect(legend.size, "no legend, so this measures nothing").toBeGreaterThan(1);
          const panes = Array.from(host.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
          expect(panes.length).toBe(2);
          for (const svg of panes) {
            for (const [series, syms] of drawnSymbols(svg)) expect([...syms], `series ${series}`).toEqual([legend.get(series)]);
          }
        });

        it("PNG export: every pane's markers match the export legend's icons", () => {
          const fig = renderFigure(s, rows, { width: INNER_W });
          const order = (fig.legendItems ?? []).map((i) => i.series);
          const png = buildExportSvg(s, rows);
          const icons = Array.from(png.querySelectorAll("g.tbl-icon path, g.tbl-icon circle"));
          expect(icons.length, "legend icons not found, so this measures nothing").toBe(order.length);
          const legend = new Map(order.map((series, i) => [series, symbolOf(icons[i]!)]));
          const drawn = drawnSymbols(png);
          expect(drawn.size).toBeGreaterThan(0);
          for (const [series, syms] of drawn) expect([...syms], `series ${series}`).toEqual([legend.get(series)]);
        });
      });
    }
  }
}

// The coordinated cursor's hover dot takes the series' marker too (wireFigureSvg's `symbols`), so it
// has to index the same list: on pane Q of REORDERED it drew A as a circle over A's square marker.
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

for (const k of [KINDS[0], KINDS[1]]) {
  describe(`${k.kind} · coordinated hover dot`, () => {
    it("draws each series with its legend marker on a pane that meets the series in another order", () => {
      const s = specFor(k, "shared");
      const rows = rowsFor(REORDERED, [...k.xs]);
      const host = document.createElement("div");
      document.body.append(host);
      mountChart(host, { spec: s, rows, width: 838, height: 420 });
      const fig = renderFigure(s, rows, { width: 838, height: 420 });
      const legend = new Map((fig.legendItems ?? []).map((i) => [i.color!, i.markerSymbol]));
      const panes = Array.from(host.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
      panes.forEach(mockRect1to1);
      panes.forEach(mockPathMarks);
      hoverFirstMark(panes[1]!, PLOT_MIDDLE);
      const dots = Array.from(panes[1]!.querySelectorAll(".tbl-coord-dot"));
      expect(dots.length, "no hover dots, so this measures nothing").toBe(2);
      for (const d of dots) expect(symbolOf(d)).toBe(legend.get(d.getAttribute("stroke")!));
    });
  });
}

// A series the figure legend has NO row for — `series_legend: false`, `legend: false`, or a figure
// that draws one series — takes its hover-card key from the PANE's key rows instead
// (icon.ts resolveTooltipIcons). Those rows numbered markers by the pane's own list after the marks
// had moved to the figure's, so pane P of RAGGED drew A as a square under a card keying it a circle.
/** series → the marker symbol its row in the shown card is keyed with. */
function cardSymbols(): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of Array.from(document.body.querySelectorAll(".tbl-tooltip .tbl-tooltip-row"))) {
    const label = (r.querySelector(".tbl-tooltip-label")?.textContent ?? "").replace(/:$/, "");
    const mark = r.querySelector(".tbl-tooltip-swatch path, .tbl-tooltip-swatch circle");
    if (label && mark) out.set(label, symbolOf(mark));
  }
  return out;
}

// C sits only in pane R, which pane_order leaves out: the figure draws one series, A, as the
// figure's second marker (square), in a single pane.
const ONE_DRAWN = { name: "one drawn series", order: [["R", "C"], ["P", "A"]], pane_order: ["P"] } as const;
const NO_KEY = [
  { why: "series_legend: false", f: RAGGED, extra: { series_legend: false } },
  { why: "legend: false", f: RAGGED, extra: { legend: false } },
  { why: "one drawn series (no series rows)", f: ONE_DRAWN, extra: {} },
] as const;

for (const k of [KINDS[0], KINDS[1]]) {
  for (const c of NO_KEY) {
    for (const mode of ["shared", "per-pane"] as const) {
      describe(`${k.kind} · ${c.why} · ${mode} · hover card`, () => {
        it("keys each series with the marker its pane draws", () => {
          const s = {
            ...specFor(k, mode, c.f.pane_order),
            ...c.extra,
            small_multiples: { columns: 2, mode, pane_order: [...c.f.pane_order], coordinated_cursor: false },
          } as unknown as ChartSpec;
          const rows = rowsFor(c.f, [...k.xs]);
          const host = document.createElement("div");
          document.body.append(host);
          mountChart(host, { spec: s, rows, width: 838, height: 420 });
          const pane = host.querySelector<SVGSVGElement>(".figure-pane svg")!;
          mockRect1to1(pane);
          mockPathMarks(pane);
          hoverFirstMark(pane, PLOT_MIDDLE);
          const card = cardSymbols();
          const drawn = drawnSymbols(pane);
          expect(card.size, "no card rows, so this measures nothing").toBe(drawn.size);
          for (const [series, syms] of drawn) expect(card.get(series), `card key for ${series}`).toBe([...syms][0]);
          // The figure's list is [C, A, B]: A is its second marker wherever it is drawn.
          expect([...drawn.get("A")!]).toEqual(["square"]);
        });
      });
    }
  }
}
