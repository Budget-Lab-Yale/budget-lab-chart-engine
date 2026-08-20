// @vitest-environment jsdom
//
// `chrome` turns engine hover chrome OFF from the spec, so the decision survives the publish
// boundary (spec + rows are JSON-serialised into the standalone HTML; a function could not).
// Hiding chrome in CSS is what this replaces — that never reached the PNG export.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "Q1", value: "10", series: "A" },
  { time: "Q1", value: "20", series: "B" },
  { time: "Q2", value: "30", series: "A" },
  { time: "Q2", value: "40", series: "B" },
] as unknown as TidyRow[];

function spec(chrome?: Record<string, unknown>): ChartSpec {
  return {
    chartType: "stacked",
    title: "t",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "time", value: "value", series: "series" },
    // Forces hoverMode "tooltip" deterministically (spec/bar-stack.ts resolveHoverMode: a plain
    // additive 2-series stack with no explicit barStack config defaults to hoverMode "pills", so
    // the floating card would never attach at all — chrome or no chrome — leaving the tooltip
    // assertions below vacuously true). barStack.hover exists for exactly this: "DETERMINISM".
    barStack: { hover: "tooltip" },
    ...(chrome ? { chrome } : {}),
  } as unknown as ChartSpec;
}

function mount(s: ChartSpec): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  mountChart(el, { spec: s, rows: ROWS, width: 720, height: 400 });
  return el;
}

// The shared tooltip card is module-level singleton state (crosshair.ts `activeTooltip`), reused
// across mounts as long as it is still attached to `document.body`. Clearing the body between
// tests keeps `.tbl-tooltip` assertions independent of execution order.
beforeEach(() => {
  document.body.innerHTML = "";
});

describe("chrome validation", () => {
  it("accepts both switches", () => {
    expect(validateSpec(spec({ tooltip: false, valuePills: false })).valid).toBe(true);
  });

  it("rejects an unknown chrome key", () => {
    expect(validateSpec(spec({ toolTip: false })).valid).toBe(false);
  });
});

describe("chrome.tooltip: false", () => {
  it("attaches no tooltip card, but keeps the hit area and highlight", () => {
    const el = mount(spec({ tooltip: false }));
    expect(document.querySelectorAll(".tbl-tooltip").length).toBe(0);
    // Only the floating card is gated — attachBandCrosshair's hit rect and band highlight (the
    // rest of its hover chrome) are untouched, and Task 5/7's onHover hook (not yet built) will
    // still have something to fire from.
    const svg = el.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(svg.querySelectorAll(".tbl-band-crosshair-hit").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".tbl-band-crosshair-hl").length).toBeGreaterThan(0);
  });

  it("still attaches one by default", () => {
    mount(spec());
    expect(document.querySelectorAll(".tbl-tooltip").length).toBeGreaterThan(0);
  });
});

describe("chrome.valuePills: false", () => {
  // `spec()` above forces `barStack.hover: "tooltip"` so the tooltip-card assertions are
  // deterministic — but that means it never reaches the "pills" hover path at all, so it can't
  // exercise chrome.valuePills against the pills a reader actually sees. This spec omits
  // `barStack.hover`: a plain additive 2-series stack with no explicit config defaults to
  // hoverMode "pills" (spec/bar-stack.ts resolveHoverMode).
  function pillsSpec(chrome?: Record<string, unknown>): ChartSpec {
    return {
      chartType: "stacked",
      title: "t",
      xAxisType: "categorical",
      data: "data.csv",
      columns: { x: "time", value: "value", series: "series" },
      ...(chrome ? { chrome } : {}),
    } as unknown as ChartSpec;
  }

  /** Mount `pillsSpec` and hover the first bar (dispatches pointermove on the band-crosshair hit
   *  rect), returning the chart's SVG in its now-active hovered state. Stubs the SVG's
   *  `getBoundingClientRect` (jsdom's real one is all-zero), matching dom-contract.test.ts's
   *  `mockAxisLabelLayout` — the hit-test maps `clientX/Y` through this rect. */
  function mountAndHover(s: ChartSpec): SVGSVGElement {
    const el = mount(s);
    const svg = el.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        width: vb.width, height: vb.height, top: 0, left: 0,
        right: vb.width, bottom: vb.height, x: 0, y: 0,
      }),
      configurable: true,
    });
    const rect = svg.querySelector<SVGRectElement>('g[aria-label="bar"] rect')!;
    const cx = parseFloat(rect.getAttribute("x") ?? "0") + parseFloat(rect.getAttribute("width") ?? "0") / 2;
    const hit = svg.querySelector(".tbl-band-crosshair-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
    return svg;
  }

  it("hovering a band produces no value pills (the documented behaviour)", () => {
    const svg = mountAndHover(pillsSpec({ valuePills: false }));
    // Neither pill source fires: the legend-gesture renderer (.tbl-hl-pills, gated at attach) nor
    // the coordinated band-cursor's per-segment pills (.tbl-coord-pill, drawn on hover) — these are
    // the pills a reader actually sees hovering a band in "pills" mode (CONFIG-SPEC.md).
    expect(svg.querySelectorAll(".tbl-hl-pills").length).toBe(0);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBe(0);
    // Hit-testing and the band highlight are untouched — only the value pills are gated, mirroring
    // chrome.tooltip's contract.
    expect(svg.querySelectorAll(".tbl-band-crosshair-hit").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".tbl-coord-region").length).toBeGreaterThan(0);
  });

  it("hovering a band shows value pills by default", () => {
    const svg = mountAndHover(pillsSpec());
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBeGreaterThan(0);
  });
});

// Every hover-chrome feature in this engine has a standalone `mountChart` attach site AND a
// separate faceted-pane attach site inside `wireFigureSvg` — gating only the standalone pair
// would leave a small-multiples figure ignoring `chrome` entirely, and no golden would catch it
// (goldens are static SVG and never hover).
describe("chrome switches on a faceted (small multiples) figure", () => {
  const FACETED_ROWS: TidyRow[] = [
    { pane: "P1", time: "Q1", value: "10", series: "A" },
    { pane: "P1", time: "Q1", value: "20", series: "B" },
    { pane: "P1", time: "Q2", value: "30", series: "A" },
    { pane: "P1", time: "Q2", value: "40", series: "B" },
    { pane: "P2", time: "Q1", value: "5", series: "A" },
    { pane: "P2", time: "Q1", value: "15", series: "B" },
    { pane: "P2", time: "Q2", value: "25", series: "A" },
    { pane: "P2", time: "Q2", value: "35", series: "B" },
  ] as unknown as TidyRow[];

  function facetedSpec(chrome?: Record<string, unknown>): ChartSpec {
    return {
      chartType: "bar",
      title: "faceted",
      xAxisType: "categorical",
      data: "data.csv",
      columns: { x: "time", value: "value", series: "series", facet: "pane" },
      // coordinated_cursor: false is what reaches each pane's floating tooltip rather than the
      // coordinated in-place pills (see test/band-crosshair.test.ts) — otherwise the pane's band
      // crosshair attaches `emitOnly` and `.tbl-tooltip` never appears, chrome or not.
      small_multiples: { columns: 2, mode: "shared", coordinated_cursor: false },
      ...(chrome ? { chrome } : {}),
    } as unknown as ChartSpec;
  }

  function mountFaceted(s: ChartSpec): HTMLElement {
    const el = document.createElement("div");
    document.body.appendChild(el);
    mountChart(el, { spec: s, rows: FACETED_ROWS, width: 838, height: 420 });
    return el;
  }

  it("chrome.tooltip: false suppresses the pane's tooltip card", () => {
    mountFaceted(facetedSpec({ tooltip: false }));
    expect(document.querySelectorAll(".tbl-tooltip").length).toBe(0);
  });

  it("attaches a tooltip card by default", () => {
    mountFaceted(facetedSpec());
    expect(document.querySelectorAll(".tbl-tooltip").length).toBeGreaterThan(0);
  });

  it("chrome.valuePills: false suppresses every pane's highlight-pills group", () => {
    const el = mountFaceted(facetedSpec({ valuePills: false }));
    expect(el.querySelectorAll(".tbl-hl-pills").length).toBe(0);
  });

  it("attaches a highlight-pills group per pane by default", () => {
    const el = mountFaceted(facetedSpec());
    expect(el.querySelectorAll(".tbl-hl-pills").length).toBeGreaterThan(0);
  });
});
