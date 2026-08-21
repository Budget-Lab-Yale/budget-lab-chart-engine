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

// The faceted LINE/AREA coordinated cursor (attachSecondaryLineCursor) had no gate on its
// per-series value pills at all -- chrome.valuePills: false suppressed the primary hover's guide
// tooltip pills (it draws none) and the legend-hover pills (none exist for a line chart either),
// but not the coordinated cursor's own pills on the OTHER panes. Same shape of bug as the faceted
// histogram fix above this file's sibling test (test/facet-crosshair.test.ts), for the chart type
// most likely to actually appear in the published archive faceted over time.
describe("chrome.valuePills: false on a faceted LINE figure's coordinated cursor", () => {
  const LINE_FACETED_ROWS: TidyRow[] = [
    { pane: "P1", time: "2024-01-01", value: "10", series: "A" },
    { pane: "P1", time: "2024-01-01", value: "20", series: "B" },
    { pane: "P1", time: "2024-02-01", value: "30", series: "A" },
    { pane: "P1", time: "2024-02-01", value: "40", series: "B" },
    { pane: "P2", time: "2024-01-01", value: "5", series: "A" },
    { pane: "P2", time: "2024-01-01", value: "15", series: "B" },
    { pane: "P2", time: "2024-02-01", value: "25", series: "A" },
    { pane: "P2", time: "2024-02-01", value: "35", series: "B" },
  ] as unknown as TidyRow[];

  function lineFacetedSpec(chrome?: Record<string, unknown>): ChartSpec {
    return {
      chartType: "line",
      title: "faceted line",
      xAxisType: "temporal",
      data: "data.csv",
      columns: { x: "time", value: "value", series: "series", facet: "pane" },
      small_multiples: { columns: 2, mode: "shared" },
      ...(chrome ? { chrome } : {}),
    } as unknown as ChartSpec;
  }

  function mockRect1to1(svg: SVGSVGElement): void {
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        width: vb.width, height: vb.height, top: 0, left: 0,
        right: vb.width, bottom: vb.height, x: 0, y: 0,
      }),
      configurable: true,
    });
  }

  /** Mount the faceted line figure, hover the first x value on pane 0, and return both panes. */
  function mountAndHover(s: ChartSpec): { pane0: SVGSVGElement; pane1: SVGSVGElement } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: s, rows: LINE_FACETED_ROWS, width: 838, height: 420 });
    const [pane0, pane1] = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg")) as [
      SVGSVGElement,
      SVGSVGElement,
    ];
    mockRect1to1(pane0);
    const ml = Number(pane0.dataset.marginLeft) || 0;
    const hit = pane0.querySelector(".tbl-crosshair-hit")!;
    // Hover just inside the plot's left edge -- the first (2024-01-01) x value.
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: ml + 2, clientY: 100, bubbles: true }));
    return { pane0, pane1 };
  }

  it("regression guard: the echoed pane DOES show a pill by default (selector proven to match)", () => {
    const { pane1 } = mountAndHover(lineFacetedSpec());
    const echo = pane1.querySelector<SVGGElement>('g.tbl-coord[opacity="1"]');
    expect(echo).not.toBeNull();
    expect(echo!.querySelector(".tbl-coord-pill")).not.toBeNull();
  });

  it("chrome.valuePills: false suppresses the coordinated cursor's pills -- guide and dot survive", () => {
    const { pane0, pane1 } = mountAndHover(lineFacetedSpec({ valuePills: false }));

    const echo = pane1.querySelector<SVGGElement>("g.tbl-coord");
    expect(echo).not.toBeNull();
    expect(echo!.getAttribute("opacity")).toBe("1");
    // The guide line and the per-series highlight dot are untouched by the switch.
    expect(echo!.querySelector("line")).not.toBeNull();
    expect(echo!.querySelector(".tbl-coord-dot")).not.toBeNull();
    // No pill on the echoed pane...
    expect(echo!.querySelector(".tbl-coord-pill")).toBeNull();
    // ...nor on the source (actively-hovered) pane's own coordinated cursor.
    const sourceCoord = pane0.querySelector<SVGGElement>('g.tbl-coord[opacity="1"]');
    expect(sourceCoord).not.toBeNull();
    expect(sourceCoord!.querySelector(".tbl-coord-pill")).toBeNull();
  });
});

// The categorical coordinated cursor (attachSecondaryCategoricalLineCursor) — faceted dot plots and
// faceted categorical-x line charts — drew its value pills unconditionally, on EVERY pane. Wider
// than the two fixes above it: render-live's `emit` calls every driver and `i === sourceIdx` only
// picks `active` (which just bolds the pill from weight 600 to 700), so the hovered pane kept its
// pills too. Everything else the cursor draws — the guide, the band echo, the per-series dots, the
// hovered pane's category highlight, and the hit area that drives them — is outside the switch.
//
// jsdom has no layout, so `readCategoryCentersFromMarks` / `readCategoryCentersFromAxis` (both
// getBoundingClientRect-based) resolve nothing unmocked. mockLayout below stamps each mark's and
// each axis label's rect from the SVG attributes Plot already wrote, at the viewBox's 1:1 scale —
// no geometry is invented, so the category the pointer resolves to is the real one.
describe("chrome.valuePills: false on the categorical coordinated cursor (faceted dot plot / cat-x line)", () => {
  const facetRows = (values: [string, string]): TidyRow[] => {
    const out: TidyRow[] = [];
    for (const g of ["G1", "G2"]) {
      for (const cat of ["Low", "High"]) {
        out.push({ g, cat, m: "A", v: values[0] } as unknown as TidyRow);
        out.push({ g, cat, m: "B", v: values[1] } as unknown as TidyRow);
      }
    }
    return out;
  };
  const DOT_ROWS = facetRows(["0.01", "0.012"]);
  const LINE_ROWS = facetRows(["10", "20"]);

  const facetedSpec = (chartType: "dotplot" | "line", chrome?: Record<string, unknown>): ChartSpec =>
    ({
      chartType,
      title: chartType,
      xAxisType: "categorical",
      data: "data.csv",
      columns: { x: "cat", value: "v", series: "m", facet: "g" },
      series_order: ["A", "B"],
      small_multiples: { columns: 2, mode: "shared", pane_order: ["G1", "G2"] },
      ...(chrome ? { chrome } : {}),
    }) as unknown as ChartSpec;

  const rect = (x: number, y: number, w: number, h: number): DOMRect =>
    ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
  const translate = (el: Element | null): [number, number] => {
    const m = /translate\(\s*([-\d.]+)[ ,]\s*([-\d.]+)\s*\)/.exec(el?.getAttribute("transform") ?? "");
    return m ? [Number(m[1]), Number(m[2])] : [0, 0];
  };
  /** Give jsdom just enough layout for the two category-center readers: the pane's own rect at
   *  viewBox scale, each `[data-category]` dot's rect from its cx/cy/r plus its group's translate,
   *  and each `<text>`'s rect from its own + its group's translate (axis labels must land BELOW the
   *  plot for readCategoryCentersFromAxis to accept them, which their real transforms already do). */
  function mockLayout(svg: SVGSVGElement): void {
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => rect(0, 0, vb.width, vb.height),
      configurable: true,
    });
    for (const el of Array.from(svg.querySelectorAll<SVGElement>("[data-category]"))) {
      const [tx, ty] = translate(el.parentElement);
      const cx = tx + Number(el.getAttribute("cx") ?? 0);
      const cy = ty + Number(el.getAttribute("cy") ?? 0);
      const r = Number(el.getAttribute("r") ?? 3) || 3;
      Object.defineProperty(el, "getBoundingClientRect", {
        value: () => rect(cx - r, cy - r, 2 * r, 2 * r),
        configurable: true,
      });
    }
    for (const t of Array.from(svg.querySelectorAll<SVGTextElement>("text"))) {
      const [tx, ty] = translate(t.parentElement);
      const [ox, oy] = translate(t);
      const w = Math.max(6, (t.textContent ?? "").length * 5);
      Object.defineProperty(t, "getBoundingClientRect", {
        value: () => rect(tx + ox - w / 2, ty + oy - 5, w, 10),
        configurable: true,
      });
    }
  }

  /** Mount, then hover the "Low" category on pane 0. Returns the coordinated group of BOTH panes:
   *  pane 0 is the source (active = true), pane 1 is the echo. */
  function mountAndHover(s: ChartSpec, rows: TidyRow[]): { source: SVGGElement; echo: SVGGElement } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: s, rows, width: 838, height: 420 });
    const panes = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    expect(panes.length).toBe(2);
    panes.forEach(mockLayout);
    // Hit-testing must survive the switch: this IS the element the switch must not remove.
    const hit = panes[0]!.querySelector(".tbl-catline-hit");
    expect(hit).not.toBeNull();
    // 146 = the "Low" band center (both panes share the x scale under mode: "shared").
    hit!.dispatchEvent(new PointerEvent("pointermove", { clientX: 146, clientY: 150, bubbles: true }));
    const [source, echo] = panes.map((p) => p.querySelector<SVGGElement>("g.tbl-coord")!) as [
      SVGGElement,
      SVGGElement,
    ];
    expect(source.getAttribute("opacity")).toBe("1");
    expect(echo.getAttribute("opacity")).toBe("1");
    return { source, echo };
  }

  for (const chartType of ["dotplot", "line"] as const) {
    it(`regression guard: ${chartType} panes DO show pills by default (selectors proven to match)`, () => {
      const { source, echo } = mountAndHover(facetedSpec(chartType), chartType === "dotplot" ? DOT_ROWS : LINE_ROWS);
      // Both panes, not just the echo — the hovered pane's pills were the half the CONFIG-SPEC's
      // old "Known exception" note missed entirely.
      expect(source.querySelectorAll(".tbl-coord-pill").length).toBe(2);
      expect(echo.querySelectorAll(".tbl-coord-pill").length).toBe(2);
    });

    it(`chrome.valuePills: false suppresses ${chartType} pills on EVERY pane, keeping the rest`, () => {
      const { source, echo } = mountAndHover(
        facetedSpec(chartType, { valuePills: false }),
        chartType === "dotplot" ? DOT_ROWS : LINE_ROWS,
      );
      for (const g of [source, echo]) {
        expect(g.querySelectorAll(".tbl-coord-pill").length).toBe(0);
        expect(g.querySelectorAll(".tbl-coord-pill-text").length).toBe(0);
        // The per-series highlight dots are untouched.
        expect(g.querySelectorAll(".tbl-coord-dot").length).toBe(2);
        // Dot plots echo the hovered category as a shaded band; categorical-x lines draw a guide.
        if (chartType === "dotplot") expect(g.querySelectorAll(".tbl-coord-region").length).toBe(1);
        else expect(g.querySelectorAll(".tbl-coord-guide").length).toBe(1);
      }
      // The hovered pane keeps its category highlight on the axis row; the echo never had one.
      expect(source.querySelectorAll(".tbl-coord-axis-label").length).toBe(1);
      expect(echo.querySelectorAll(".tbl-coord-axis-label").length).toBe(0);
    });
  }
});
