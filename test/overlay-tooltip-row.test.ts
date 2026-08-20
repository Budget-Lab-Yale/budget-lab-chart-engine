// @vitest-environment jsdom
//
// `overlays[].tooltip` — a per-overlay opt-in (default false) that adds ONE hover-tooltip row per
// drawn overlay line, showing that line's value at the hovered x.
//
// Three lines on a chart and a tooltip reporting one of them is the defect this closes. The row is
// opt-in because an overlay is usually chrome (a reference slope, a target) whose value at an
// arbitrary x means nothing; a fitted trend is the case where it means a lot.
//
// The value shown is read off the SAME polyline the mark draws (engine/overlays.ts
// `ResolvedOverlay.points`, drawn by `Plot.line` with its default `curve: "linear"`), so the number
// in the card is the number the line is at that pixel — there is no second evaluator to disagree
// with the first. That is also what makes the `domain` crop and the `facet` scoping free: a line
// resolveOverlays already cropped or filtered out has no point at that x to read.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { validateSpec } from "../src/spec/validate";
import { overlayValueAt } from "../src/engine/overlays";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const W = 720;
const H = 400;

// x = 0..3, one series, plus a precomputed `fit` column so the overlay's value at a data x is
// EXACT (a `column` overlay's polyline has a vertex at every row's x) and can be asserted as text.
const ROWS: TidyRow[] = [
  { t: "0", v: "10", s: "A", fit: "1" },
  { t: "1", v: "12", s: "A", fit: "2" },
  { t: "2", v: "11", s: "A", fit: "3" },
  { t: "3", v: "13", s: "A", fit: "4" },
] as unknown as TidyRow[];

const BASE = {
  chartType: "line",
  title: "t",
  xAxisType: "numeric",
  data: "data.csv",
  columns: { x: "t", value: "v", series: "s" },
} as unknown as ChartSpec;

function spec(patch: Record<string, unknown>): ChartSpec {
  return { ...BASE, ...patch } as ChartSpec;
}

function mount(s: ChartSpec, rows: TidyRow[] = ROWS): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  mountChart(el, { spec: s, rows, width: W, height: H });
  return el;
}

/** Stub the all-zero jsdom rect so `attachCrosshair` can map clientX → svg x (mirrors
 *  test/chrome-switches.test.ts's `mountAndHover`), then hover the plot position of `xValue`
 *  on this chart's x-domain. The crosshair snaps to the nearest DATA x, so passing a data x
 *  lands exactly on it. */
function hoverAt(svg: SVGSVGElement, xValue: number, xMin = 0, xMax = 3): void {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({
      width: vb.width, height: vb.height, top: 0, left: 0,
      right: vb.width, bottom: vb.height, x: 0, y: 0,
    }),
    configurable: true,
  });
  const ml = +(svg.dataset.marginLeft ?? "") || 0;
  const mr = +(svg.dataset.marginRight ?? "") || 8;
  const plotW = vb.width - ml - mr;
  const px = ml + ((xValue - xMin) / (xMax - xMin)) * plotW;
  svg
    .querySelector(".tbl-crosshair-hit")!
    .dispatchEvent(new PointerEvent("pointermove", { clientX: px, clientY: vb.height / 2, bubbles: true }));
}

/** Every tooltip row as `label|value`, in card order. */
function rows(): string[] {
  return [...document.querySelectorAll(".tbl-tooltip .tbl-tooltip-row")].map((r) => {
    const label = r.querySelector(".tbl-tooltip-label")?.textContent ?? "";
    const value = r.querySelector(".tbl-tooltip-value")?.textContent ?? "";
    return `${label.replace(/:$/, "")}|${value}`;
  });
}

function chartSvg(el: HTMLElement): SVGSVGElement {
  return el.querySelector<SVGSVGElement>(".figure-canvas svg")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("overlayValueAt — the value the DRAWN line has at x", () => {
  it("interpolates between the polyline's vertices, exactly as the linear-curve mark draws", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 100 }];
    expect(overlayValueAt(pts, 0)).toBe(0);
    expect(overlayValueAt(pts, 10)).toBe(100);
    expect(overlayValueAt(pts, 2.5)).toBeCloseTo(25, 10);
  });

  it("has no value outside the drawn extent — a `domain` crop is not extrapolated", () => {
    const pts = [{ x: 2, y: 5 }, { x: 4, y: 9 }];
    expect(overlayValueAt(pts, 1.99)).toBeNull();
    expect(overlayValueAt(pts, 4.01)).toBeNull();
  });

  it("has no value across a BREAK — a blank `column` cell is a gap, not a bridge", () => {
    // engine/overlays.ts emits `y: null` for a blank cell; marks/overlay.ts splits the line there,
    // so nothing is drawn between x=1 and x=3 and the tooltip must agree.
    const pts = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: null }, { x: 3, y: 4 }, { x: 4, y: 5 }];
    expect(overlayValueAt(pts, 1)).toBe(2);
    expect(overlayValueAt(pts, 2)).toBeNull();
    expect(overlayValueAt(pts, 2.5)).toBeNull();
    expect(overlayValueAt(pts, 3)).toBe(4);
    expect(overlayValueAt(pts, 3.5)).toBeCloseTo(4.5, 10);
  });
});

describe("overlays[].tooltip on a continuous line chart", () => {
  it("adds NO row by default — three lines, one reported, is the state this documents", () => {
    const el = mount(spec({ overlays: [{ column: "fit", label: "Trend" }] }));
    hoverAt(chartSvg(el), 1);
    expect(rows()).toEqual(["A|12.00"]);
  });

  it("adds one row carrying the line's value at the hovered x when opted in", () => {
    const el = mount(spec({ overlays: [{ column: "fit", label: "Trend", tooltip: true }] }));
    hoverAt(chartSvg(el), 1);
    expect(rows()).toEqual(["A|12.00", "Trend|2.00"]);
  });

  it("follows the cursor — a different x reports that x's value", () => {
    const el = mount(spec({ overlays: [{ column: "fit", label: "Trend", tooltip: true }] }));
    const svg = chartSvg(el);
    hoverAt(svg, 3);
    expect(rows()).toEqual(["A|13.00", "Trend|4.00"]);
  });

  it("reports a `fun` line through the expression parser — no eval, no second evaluator", () => {
    // Linear, so reading the sampled polyline is exact rather than merely close.
    const el = mount(spec({ overlays: [{ fun: "2*x + 1", label: "Rule", tooltip: true, domain: "axis" }] }));
    hoverAt(chartSvg(el), 2);
    expect(rows()).toEqual(["A|11.00", "Rule|5.00"]);
  });

  it("reports a `slope`+`intercept` abline", () => {
    const el = mount(spec({ overlays: [{ slope: 3, intercept: 1, label: "Ref", tooltip: true }] }));
    hoverAt(chartSvg(el), 2);
    expect(rows()).toEqual(["A|11.00", "Ref|7.00"]);
  });

  it("reports a `method` fit", () => {
    // Least-squares straight fit of (0,10) (1,12) (2,11) (3,13): slope 0.8, intercept 10.3, so 11.1
    // at x=1. The polyline is two vertices for a degree-1 fit, and interpolation between them is
    // exact.
    const el = mount(spec({ overlays: [{ method: "lm", label: "Fit", tooltip: true }] }));
    hoverAt(chartSvg(el), 1);
    expect(rows()).toEqual(["A|12.00", "Fit|11.10"]);
  });

  it("omits the row where the overlay's `domain` does not draw — no extrapolation", () => {
    const el = mount(
      spec({ overlays: [{ fun: "2*x + 1", label: "Rule", tooltip: true, domain: [0, 1] }] }),
    );
    const svg = chartSvg(el);
    hoverAt(svg, 3);
    expect(rows()).toEqual(["A|13.00"]);
    hoverAt(svg, 1);
    expect(rows()).toEqual(["A|12.00", "Rule|3.00"]);
  });

  it("still needs a label — `tooltip: true` alone has no row text", () => {
    expect(validateSpec(spec({ overlays: [{ column: "fit", tooltip: true }] })).valid).toBe(false);
    expect(validateSpec(spec({ overlays: [{ column: "fit", tooltip: true, label: "Trend" }] })).valid).toBe(
      true,
    );
  });

  it("is a known key — the schema stays closed against a typo", () => {
    expect(validateSpec(spec({ overlays: [{ column: "fit", label: "T", toolTip: true }] })).valid).toBe(
      false,
    );
  });

  it("is suppressed with the rest of the card by chrome.tooltip: false", () => {
    const el = mount(
      spec({ overlays: [{ column: "fit", label: "Trend", tooltip: true }], chrome: { tooltip: false } }),
    );
    hoverAt(chartSvg(el), 1);
    expect(document.querySelectorAll(".tbl-tooltip").length).toBe(0);
  });

  it("keys the row with a LINE swatch in the line's own colour and dash", () => {
    // A modelled value in a list of observed ones needs a marker, and the dash is the engine's own
    // statement of which kind of claim the line is (CONFIG-SPEC `overlays[].style`): `fun` defaults
    // dashed, `column` solid.
    const el = mount(
      spec({
        overlays: [
          { column: "fit", label: "Trend", tooltip: true, color: "#123456" },
          { fun: "x", label: "Rule", tooltip: true, color: "#654321" },
        ],
      }),
    );
    hoverAt(chartSvg(el), 1);
    const swatches = [...document.querySelectorAll(".tbl-tooltip .tbl-tooltip-row--overlay")].map(
      (r) => r.querySelector(".tbl-tooltip-swatch svg line")!,
    );
    expect(swatches).toHaveLength(2);
    expect(swatches[0]!.getAttribute("style")).toContain("stroke:#123456");
    expect(swatches[0]!.getAttribute("stroke-dasharray")).toBeNull();
    expect(swatches[1]!.getAttribute("style")).toContain("stroke:#654321");
    expect(swatches[1]!.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("reaches an AREA chart too — same continuous crosshair, and its Total row stays above", () => {
    const el = mount(spec({ chartType: "area", overlays: [{ column: "fit", label: "Trend", tooltip: true }] }));
    hoverAt(chartSvg(el), 1);
    expect(rows()).toEqual(["A|12.00", "Total|12.00", "Trend|2.00"]);
  });

  it("omits the row across a BREAK — a blank `column` cell is a gap, not a bridge", () => {
    const gappy: TidyRow[] = [
      { t: "0", v: "10", s: "A", fit: "1" },
      { t: "1", v: "12", s: "A", fit: "" },
      { t: "2", v: "11", s: "A", fit: "3" },
      { t: "3", v: "13", s: "A", fit: "4" },
    ] as unknown as TidyRow[];
    const el = mount(spec({ overlays: [{ column: "fit", label: "Trend", tooltip: true }] }), gappy);
    const svg = chartSvg(el);
    hoverAt(svg, 1);
    expect(rows()).toEqual(["A|12.00"]);
    hoverAt(svg, 2);
    expect(rows()).toEqual(["A|11.00", "Trend|3.00"]);
  });

  it("names the series on a per-series fit, so two rows of one label are told apart", () => {
    const multi: TidyRow[] = [
      { t: "0", v: "10", s: "A", fit: "1" },
      { t: "1", v: "12", s: "A", fit: "2" },
      { t: "0", v: "20", s: "B", fit: "5" },
      { t: "1", v: "24", s: "B", fit: "6" },
    ] as unknown as TidyRow[];
    const el = mount(
      spec({
        overlays: [{ column: "fit", label: "Trend", tooltip: true }],
        series_labels: { A: "Alpha", B: "Beta" },
      }),
      multi,
    );
    hoverAt(chartSvg(el), 1, 0, 1);
    expect(rows()).toEqual(["Alpha|12.00", "Beta|24.00", "Trend (Alpha)|2.00", "Trend (Beta)|6.00"]);
  });
});

describe("overlays[].tooltip on a scatter chart's point hover", () => {
  const SCATTER = {
    ...BASE,
    chartType: "scatter",
  } as unknown as ChartSpec;

  it("adds the row to the hovered point's card, and only when opted in", () => {
    for (const optIn of [false, true]) {
      document.body.innerHTML = "";
      const el = mount({
        ...SCATTER,
        overlays: [{ column: "fit", label: "Trend", ...(optIn ? { tooltip: true } : {}) }],
      } as ChartSpec);
      const marker = chartSvg(el).querySelector('g[aria-label="dot"] circle')!;
      marker.dispatchEvent(new Event("pointerenter"));
      const labels = rows().map((r) => r.split("|")[0]);
      expect(labels.includes("Trend")).toBe(optIn);
    }
  });

  it("omits another series' fit — that line is not this point's trend", () => {
    const multi: TidyRow[] = [
      { t: "0", v: "10", s: "A", fit: "1" },
      { t: "1", v: "12", s: "A", fit: "2" },
      { t: "0", v: "20", s: "B", fit: "5" },
      { t: "1", v: "24", s: "B", fit: "6" },
    ] as unknown as TidyRow[];
    const el = mount(
      { ...SCATTER, overlays: [{ column: "fit", label: "Trend", tooltip: true }] } as ChartSpec,
      multi,
    );
    // Markers follow dataInScope order, so index 0 is series A at x = 0 (its fit is 1; B's is 5).
    chartSvg(el).querySelectorAll('g[aria-label="dot"] circle')[0]!
      .dispatchEvent(new Event("pointerenter"));
    expect(rows()).toEqual(["x|0", "Value|10.00", "Trend|1.00"]);
  });

  it("reports the fit at the hovered POINT's x", () => {
    const el = mount({
      ...SCATTER,
      overlays: [{ column: "fit", label: "Trend", tooltip: true }],
    } as ChartSpec);
    // Markers are in dataInScope order, so index 2 is the row at x = 2 (fit = 3).
    const markers = chartSvg(el).querySelectorAll('g[aria-label="dot"] circle');
    markers[2]!.dispatchEvent(new Event("pointerenter"));
    expect(rows()).toEqual(["x|2", "Value|11.00", "Trend|3.00"]);
  });
});

describe("overlays[].tooltip on a small-multiples pane", () => {
  const FACET_ROWS: TidyRow[] = [
    { pane: "P1", t: "0", v: "10", s: "A", fit: "1" },
    { pane: "P1", t: "1", v: "12", s: "A", fit: "2" },
    { pane: "P2", t: "0", v: "20", s: "A", fit: "5" },
    { pane: "P2", t: "1", v: "24", s: "A", fit: "6" },
  ] as unknown as TidyRow[];

  function facetSpec(overlays: unknown[]): ChartSpec {
    return {
      ...BASE,
      columns: { x: "t", value: "v", series: "s", facet: "pane" },
      // coordinated_cursor: false is what leaves each pane its own tooltip card rather than the
      // coordinated in-place cursor (see test/chrome-switches.test.ts's faceted block).
      small_multiples: { columns: 2, mode: "per-pane", coordinated_cursor: false },
      overlays,
    } as unknown as ChartSpec;
  }

  it("reaches a faceted pane's tooltip too — gating only the standalone site is the known gap", () => {
    const el = mount(facetSpec([{ column: "fit", label: "Trend", tooltip: true }]), FACET_ROWS);
    const panes = el.querySelectorAll<SVGSVGElement>(".figure-grid svg");
    expect(panes.length).toBe(2);
    hoverAt(panes[0]!, 1, 0, 1);
    expect(rows()).toEqual(["A|12.00", "Trend|2.00"]);
  });

  it("respects `facet` — a pane the overlay does not draw in gets no row", () => {
    const el = mount(
      facetSpec([{ column: "fit", label: "Trend", tooltip: true, facet: "P1" }]),
      FACET_ROWS,
    );
    const panes = el.querySelectorAll<SVGSVGElement>(".figure-grid svg");
    hoverAt(panes[1]!, 1, 0, 1);
    expect(rows()).toEqual(["A|24.00"]);
    hoverAt(panes[0]!, 1, 0, 1);
    expect(rows()).toEqual(["A|12.00", "Trend|2.00"]);
  });
});

describe("overlays[].tooltip is ignored on a histogram", () => {
  // A histogram's hover resolves a bin RANGE, not an x, so there is no one value for a fitted or
  // asserted line to report there. CONFIG-SPEC.md states the flag is silently ignored on this chart
  // type; "silently ignored on chart type X" is a fact an author needs, so it is pinned here rather
  // than left to be discovered.
  it("hovering a bin adds no overlay row, even with tooltip: true", () => {
    const s = {
      chartType: "histogram",
      title: "h",
      xAxisType: "numeric",
      histogram: { bins: 4, domain: [0, 20] },
      columns: { x: "amount" },
      data: "inline",
      overlays: [{ fun: "1", label: "Rule", tooltip: true, domain: "axis" }],
    } as unknown as ChartSpec;
    const el = mount(s, Array.from({ length: 8 }, (_, i) => ({ amount: String(i) })) as TidyRow[]);
    const svg = chartSvg(el);
    // The overlay line IS drawn — this is about the tooltip, not about the mark.
    expect(svg.querySelectorAll("g.tbl-overlay-line path").length).toBeGreaterThan(0);
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        width: vb.width, height: vb.height, top: 0, left: 0,
        right: vb.width, bottom: vb.height, x: 0, y: 0,
      }),
      configurable: true,
    });
    const bar = svg.querySelector<SVGRectElement>('g[aria-label="rect"] rect')!;
    const cx = parseFloat(bar.getAttribute("x")!) + parseFloat(bar.getAttribute("width")!) / 2;
    svg
      .querySelector(".tbl-hist-hover-hit")!
      .dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 100, bubbles: true }));
    expect(document.querySelectorAll(".tbl-tooltip .tbl-tooltip-row").length).toBeGreaterThan(0);
    expect(rows().some((r) => r.startsWith("Rule|"))).toBe(false);
  });
});
