// @vitest-environment jsdom
//
// The hover band on a sectioned horizontal chart covers exactly the hovered row's slot (one row
// pitch, centred on the row) — never the section gap or its header — and, like the standalone
// horizontal bar's coordinated cursor, it runs left under the row's category label, whose text is
// darkened and bolded while hovered. Checked on the stack's tooltip hover, the bar's pill hover and
// the dumbbell's band hover, standalone and in small-multiple panes. Live only: nothing here renders
// into the export.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { mockRect1to1 } from "./helpers/hover-harness";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});
beforeEach(() => {
  document.body.innerHTML = "";
});

const DARK = "#1A1A2E";

// --- fixtures: two sections, two rows each ---
const SERIES = ["Income", "Gains", "Corporate"];
const CATS: Array<[string, string]> = [
  ["Alpha one", "First"],
  ["Alpha two", "First"],
  ["Beta one", "Second"],
  ["Beta two", "Second"],
];
const stackRows = (vals: Record<string, number[]>, pane?: string): TidyRow[] =>
  SERIES.flatMap((s) =>
    CATS.map(([bar, sec], i) => ({ ...(pane ? { pane } : {}), bar, sec, tax: s, v: String(vals[s]![i]) })),
  ) as unknown as TidyRow[];
/** Negative segments → a net dot → the stack hovers with its tooltip card and its own band. */
const NEG = { Income: [10, 20, 30, 40], Gains: [5, 15, 25, 35], Corporate: [-30, -6, -40, -2] };
const STACK: ChartSpec = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "bar", series: "tax", value: "v", section: "sec" },
  series_order: SERIES,
  data: "d.csv",
};
/** The step-up demo's shape: net as text, hover forced to the card. */
const STACK_TEXT_TOOLTIP: ChartSpec = { ...STACK, barStack: { netDisplay: "text", hover: "tooltip" } };
const STACK_FIG: ChartSpec = {
  ...STACK,
  columns: { ...STACK.columns, facet: "pane" },
  small_multiples: { columns: 2, mode: "shared", pane_order: ["P1", "P2"] },
};

const BAR: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "bar", value: "v", section: "sec" },
  data: "d.csv",
};
const barRows = CATS.map(([bar, sec], i) => ({ bar, sec, v: String(5 + i) })) as unknown as TidyRow[];

const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { category: "bar", series: "m", value: "v", section: "sec" },
  series_order: ["Cash", "Accrual"],
  data: "d.csv",
};
const dbRows = (pane?: string): TidyRow[] =>
  CATS.flatMap(([bar, sec], i) => [
    { ...(pane ? { pane } : {}), bar, sec, m: "Cash", v: String(20 + i) },
    { ...(pane ? { pane } : {}), bar, sec, m: "Accrual", v: String(8 + i) },
  ]) as unknown as TidyRow[];
const DUMBBELL_FIG: ChartSpec = {
  ...DUMBBELL,
  columns: { ...DUMBBELL.columns, facet: "pane" },
  small_multiples: { pane_order: ["P1", "P2"] },
};

// --- geometry (jsdom has no layout: attributes + ancestor translates) ---
function translateY(el: Element, svg: Element): number {
  let y = 0;
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) y += Number(m[2]);
  }
  return y;
}
const labels = (svg: SVGSVGElement): SVGTextElement[] => Array.from(svg.querySelectorAll<SVGTextElement>("g.tbl-cat-label text"));
const labelOf = (svg: SVGSVGElement, cat: string): SVGTextElement => labels(svg).find((t) => t.textContent === cat)!;
/** Each row's centre, from the (label-bearing) pane's labels. */
const centre = (svg: SVGSVGElement, cat: string): number => translateY(labelOf(svg, cat), svg);
const widthOf = (svg: SVGSVGElement): number => svg.viewBox.baseVal.width;

function hover(svg: SVGSVGElement, y: number): void {
  svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
    new PointerEvent("pointermove", { clientX: widthOf(svg) * 0.7, clientY: y, bubbles: true }),
  );
}
function leave(svg: SVGSVGElement): void {
  svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
}
const box = (el: Element | null) => ({
  x: Number(el?.getAttribute("x")),
  y: Number(el?.getAttribute("y")),
  w: Number(el?.getAttribute("width")),
  h: Number(el?.getAttribute("height")),
});

function mountOne(spec: ChartSpec, rows: TidyRow[]): SVGSVGElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  mountChart(c, { spec, rows, width: 720, height: 500 });
  const svg = c.querySelector(".figure-canvas svg") as SVGSVGElement;
  mockRect1to1(svg);
  return svg;
}
function mountPanes(spec: ChartSpec, rows: TidyRow[]): SVGSVGElement[] {
  const c = document.createElement("div");
  document.body.appendChild(c);
  mountChart(c, { spec, rows, width: 900 });
  const panes = Array.from(c.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
  panes.forEach(mockRect1to1);
  return panes;
}

/** The band is exactly the row's slot: one pitch, centred on the row, from the SVG's left edge. */
function expectRowBand(band: Element | null, svg: SVGSVGElement, rowCentre: number, pitch: number, what: string): void {
  expect(band, what).not.toBeNull();
  const b = box(band);
  // Within 1px: the labels the centre is read from carry Plot's 0.5px crisp-edge offset.
  expect(Math.abs(b.y - (rowCentre - pitch / 2)), `${what} top ${b.y}`).toBeLessThanOrEqual(1);
  expect(Math.abs(b.h - pitch), `${what} height ${b.h}`).toBeLessThanOrEqual(1);
  expect(b.x, `${what} left`).toBe(0);
  expect(b.x + b.w, `${what} right`).toBeGreaterThanOrEqual(widthOf(svg));
}
/** The rows either side of the section gap — where a band used to spread over the gap and header. */
const GAP_ROWS = ["Alpha two", "Beta one"];
/** The first row's band never rises above the plot top into the first header's margin. */
function expectBelowPlotTop(band: Element | null, svg: SVGSVGElement): void {
  expect(box(band).y).toBeGreaterThanOrEqual(Number(svg.dataset.marginTop) - 0.5);
}

/** Only `cat`'s label is darkened + bolded. */
function expectAccent(svg: SVGSVGElement, cat: string | null): void {
  for (const t of labels(svg)) {
    const on = t.textContent === cat;
    expect(t.getAttribute("font-weight") === "700", `${t.textContent} bold`).toBe(on);
    if (on) expect(t.getAttribute("fill")).toBe(DARK);
  }
}

const shownHl = (svg: SVGSVGElement, sel: string): Element | null => {
  const el = svg.querySelector(sel);
  return el && el.getAttribute("opacity") !== "0" ? el : null;
};

describe("sectioned horizontal stack, tooltip hover: the band is the hovered row only", () => {
  for (const [name, spec, rows] of [
    ["net dot", STACK, stackRows(NEG)],
    ["net text, hover: tooltip (step-up shape)", STACK_TEXT_TOOLTIP, stackRows(NEG)],
  ] as Array<[string, ChartSpec, TidyRow[]]>) {
    it(`${name}: the rows either side of the gap get a one-pitch band under their label`, () => {
      const svg = mountOne(spec, rows);
      const pitch = centre(svg, "Alpha two") - centre(svg, "Alpha one");
      for (const cat of GAP_ROWS) {
        const c = centre(svg, cat);
        hover(svg, c);
        expectRowBand(shownHl(svg, ".tbl-band-crosshair-hl"), svg, c, pitch, cat);
        expectAccent(svg, cat);
      }
      hover(svg, centre(svg, "Alpha one"));
      expectBelowPlotTop(shownHl(svg, ".tbl-band-crosshair-hl"), svg);
      leave(svg);
      expectAccent(svg, null);
    });
  }

  it("small multiples: each pane's own band is the row's slot, from the pane's left edge; the label pane accents", () => {
    const panes = mountPanes(STACK_FIG, [...stackRows(NEG, "P1"), ...stackRows(NEG, "P2")]);
    expect(panes).toHaveLength(2);
    const [p0, p1] = panes as [SVGSVGElement, SVGSVGElement];
    const pitch = centre(p0, "Alpha two") - centre(p0, "Alpha one");
    for (const svg of [p0, p1]) {
      const c = centre(p0, "Beta one");
      hover(svg, c);
      expectRowBand(shownHl(svg, ".tbl-band-crosshair-hl"), svg, c, pitch, "Beta one");
      leave(svg);
    }
    hover(p0, centre(p0, "Beta one"));
    expectAccent(p0, "Beta one");
  });
});

describe("sectioned horizontal bar, pill hover: the band is the hovered row only", () => {
  it("the rows either side of the gap get a one-pitch band under their label, which accents", () => {
    const svg = mountOne(BAR, barRows);
    const pitch = centre(svg, "Alpha two") - centre(svg, "Alpha one");
    for (const cat of GAP_ROWS) {
      const c = centre(svg, cat);
      hover(svg, c);
      expectRowBand(svg.querySelector(".tbl-coord-region"), svg, c, pitch, cat);
      expectAccent(svg, cat);
    }
    hover(svg, centre(svg, "Alpha one"));
    expectBelowPlotTop(svg.querySelector(".tbl-coord-region"), svg);
  });
});

describe("sectioned horizontal dumbbell: the band runs under the label, which accents", () => {
  it("standalone: the rows either side of the gap get a one-pitch band from the left edge", () => {
    const svg = mountOne(DUMBBELL, dbRows());
    const pitch = centre(svg, "Alpha two") - centre(svg, "Alpha one");
    for (const cat of GAP_ROWS) {
      const c = centre(svg, cat);
      hover(svg, c);
      expectRowBand(shownHl(svg, ".tbl-catline-hl"), svg, c, pitch, cat);
      expectAccent(svg, cat);
    }
    hover(svg, centre(svg, "Alpha one"));
    expectBelowPlotTop(shownHl(svg, ".tbl-catline-hl"), svg);
    leave(svg);
    expectAccent(svg, null);
  });

  it("small multiples: the hovered pane's band and the other pane's echo both start at the left edge", () => {
    const panes = mountPanes(DUMBBELL_FIG, [...dbRows("P1"), ...dbRows("P2")]);
    expect(panes).toHaveLength(2);
    const [p0, p1] = panes as [SVGSVGElement, SVGSVGElement];
    const pitch = centre(p0, "Alpha two") - centre(p0, "Alpha one");
    const c0 = centre(p0, "Beta one");
    hover(p0, c0);
    expectRowBand(shownHl(p0, ".tbl-catline-hl"), p0, c0, pitch, "hovered pane");
    expectAccent(p0, "Beta one");
    expectRowBand(p1.querySelector(".tbl-coord-region"), p1, centre(p1, "Beta one"), pitch, "echo pane");
    expectAccent(p1, "Beta one");
  });
});
