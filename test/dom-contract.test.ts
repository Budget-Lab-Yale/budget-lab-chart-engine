// @vitest-environment jsdom
//
// Task 8 (issue #30): every addressable hover-chrome element carries a class, and
// `MountOptions.tooltipContainer` lets a consumer reparent the floating tooltip card.
//
// Two concrete problems from issue #30's workaround table:
//   1. The coordinated-cursor's value-pill capsule and its x-axis "band echo" box are both
//      unclassed <rect>s sharing the SAME presentation attributes (rx="3", fill, etc.) — so a
//      consumer stylesheet can only tell them apart via `rect[rx="3"]`.
//   2. The floating tooltip is hard-appended to `document.body`, so no selector scoped under a
//      figure's own container can reach it.
//
// This file asserts the fix WITHOUT depending on `rx` (or any other presentation attribute) to
// select either rect, and asserts the fix changes NOTHING visually: the rects' presentation
// attributes must still match crosshair.ts's addCoordPill/addCoordAxisLabel exactly.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { attachSecondaryLineCursor } from "../src/engine/crosshair";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

beforeEach(() => {
  // The floating tooltip is module-level shared state (crosshair.ts's getSharedTooltip) keyed by
  // its parent element. A stale element left over from a prior test (still a child of
  // document.body) would make `parent.contains(existing)` true and get silently reused, so clear
  // document.body between tests.
  document.body.innerHTML = "";
});

/** Map every text element's (mocked) layout so `makeAxisRows`/`findAxisLabelBox` in crosshair.ts
 *  — which read real `getBoundingClientRect()` geometry, unavailable in jsdom — treat every
 *  non-y-tick text label as sitting on one row well below the plot (a real x-axis category
 *  label's actual position doesn't matter here; only "below the plot, non-zero width" does). */
function mockAxisLabelLayout(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({
      width: vb.width, height: vb.height, top: 0, left: 0,
      right: vb.width, bottom: vb.height, x: 0, y: 0,
    }),
    configurable: true,
  });
  for (const t of Array.from(svg.querySelectorAll("text"))) {
    if (t.closest(".tbl-y-tick-label")) continue;
    Object.defineProperty(t, "getBoundingClientRect", {
      value: () => ({ width: 24, height: 12, top: 1000, bottom: 1012, left: 100, right: 124, x: 100, y: 1000 }),
      configurable: true,
    });
  }
}

// A cumulative (all-positive, netDisplay: "text") 2-series stack: no net dot forces the tooltip,
// so hovering drives the COORDINATED-CURSOR pills (task 17), not the floating tooltip card —
// the path that draws the coord-pill capsule and (on the active pane) the axis-label echo box.
const STACK_SPEC: ChartSpec = {
  chartType: "stacked",
  title: "dom-contract stacked",
  xAxisType: "categorical",
  series_order: ["Up", "Down"],
  barStack: { netDisplay: "text" },
  data: "inline",
};
const STACK_ROWS: TidyRow[] = [
  { time: "A", series: "Up", value: "6" },
  { time: "A", series: "Down", value: "4" },
  { time: "B", series: "Up", value: "5" },
  { time: "B", series: "Down", value: "2" },
];

/** Mount STACK_SPEC and hover the first bar, returning its (now-active) chart SVG. */
function mountAndHoverStack(container: HTMLElement, opts: Partial<Parameters<typeof mountChart>[1]> = {}): SVGSVGElement {
  mountChart(container, { spec: STACK_SPEC, rows: STACK_ROWS, width: 600, height: 360, ...opts });
  const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
  mockAxisLabelLayout(svg);
  document.body.appendChild(container);
  const rect = svg.querySelector<SVGRectElement>('g[aria-label="bar"] rect')!;
  const cx = parseFloat(rect.getAttribute("x") ?? "0") + parseFloat(rect.getAttribute("width") ?? "0") / 2;
  const hit = svg.querySelector(".tbl-band-crosshair-hit")!;
  hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
  return svg;
}

// The exact presentation attributes set at crosshair.ts's addCoordPill (~:1976-1983) and
// addCoordAxisLabel (~:2150-2157) — both rects use the SAME frosted-glass styling. Naming the
// rects with a class must not touch any of these.
const FROSTED_RECT_ATTRS = {
  rx: "3",
  fill: "#ffffff",
  "fill-opacity": "0.82",
  stroke: "#c8cdd7",
  "stroke-opacity": "0.7",
};

describe("hover-chrome elements each carry a class (issue #30)", () => {
  it("the coord-pill capsule carries tbl-coord-pill, not tbl-coord-axis-label", () => {
    const container = document.createElement("div");
    const svg = mountAndHoverStack(container);

    const pills = svg.querySelectorAll<SVGRectElement>("g.tbl-coord rect.tbl-coord-pill");
    expect(pills.length).toBeGreaterThan(0); // one per hovered-category segment (Up + Down)
    for (const pill of Array.from(pills)) {
      expect(pill.classList.contains("tbl-coord-axis-label")).toBe(false);
      for (const [attr, val] of Object.entries(FROSTED_RECT_ATTRS)) {
        expect(pill.getAttribute(attr)).toBe(val);
      }
    }
  });

  it("each pill's VALUE TEXT carries tbl-coord-pill-text", () => {
    const container = document.createElement("div");
    const svg = mountAndHoverStack(container);

    const pillTexts = svg.querySelectorAll<SVGTextElement>("g.tbl-coord text.tbl-coord-pill-text");
    expect(pillTexts.length).toBeGreaterThan(0); // one per hovered-category segment (Up + Down)
    for (const t of Array.from(pillTexts)) {
      expect(t.classList.contains("tbl-coord-axis-label-text")).toBe(false);
      expect(t.textContent).not.toBe("");
    }
  });

  it("the axis-label echo box carries tbl-coord-axis-label, not tbl-coord-pill, and is a DIFFERENT element from the pills", () => {
    const container = document.createElement("div");
    const svg = mountAndHoverStack(container);

    const axisLabels = svg.querySelectorAll<SVGRectElement>("g.tbl-coord rect.tbl-coord-axis-label");
    expect(axisLabels.length).toBe(1); // one echo box for the hovered category's x value
    const axisLabel = axisLabels[0]!;
    expect(axisLabel.classList.contains("tbl-coord-pill")).toBe(false);
    for (const [attr, val] of Object.entries(FROSTED_RECT_ATTRS)) {
      expect(axisLabel.getAttribute(attr)).toBe(val);
    }

    const pill = svg.querySelector<SVGRectElement>("g.tbl-coord rect.tbl-coord-pill")!;
    expect(pill).not.toBeNull();
    expect(axisLabel).not.toBe(pill);
  });

  it("the axis-label echo box's CATEGORY TEXT carries tbl-coord-axis-label-text", () => {
    const container = document.createElement("div");
    const svg = mountAndHoverStack(container);

    const axisLabelTexts = svg.querySelectorAll<SVGTextElement>("g.tbl-coord text.tbl-coord-axis-label-text");
    expect(axisLabelTexts.length).toBe(1); // one echo box for the hovered category's x value
    const t = axisLabelTexts[0]!;
    expect(t.classList.contains("tbl-coord-pill-text")).toBe(false);
    expect(t.textContent).not.toBe("");
  });

  it("no rule in CHART_CSS selects either rect by its rx attribute (the workaround this task removes)", () => {
    expect(CHART_CSS).not.toMatch(/\[\s*rx\s*=/);
  });
});

describe("tooltipContainer (issue #30)", () => {
  // The plain (non-categorical) crosshair path shows the floating tooltip unconditionally at
  // attach time — getSharedTooltip runs once per attach/redraw, independent of any hover — so
  // mounting alone is enough to observe where the card was parented.
  const LINE_SPEC: ChartSpec = {
    chartType: "line",
    title: "dom-contract line",
    xAxisType: "temporal",
    data: "inline",
  };
  const LINE_ROWS: TidyRow[] = [
    { time: "2020-01-01", series: "A", value: "1" },
    { time: "2020-02-01", series: "A", value: "2" },
    { time: "2020-03-01", series: "A", value: "3" },
  ];

  it("defaults to document.body when tooltipContainer is not passed", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: LINE_SPEC, rows: LINE_ROWS });
    expect(document.body.querySelector(".tbl-tooltip")).not.toBeNull();
    expect(container.querySelector(".tbl-tooltip")).toBeNull();
  });

  it("parents the tooltip into the given element when tooltipContainer is passed", () => {
    const container = document.createElement("div");
    const custom = document.createElement("div");
    mountChart(container, { spec: LINE_SPEC, rows: LINE_ROWS, tooltipContainer: custom });
    expect(custom.querySelector(".tbl-tooltip")).not.toBeNull();
    expect(document.body.querySelector(".tbl-tooltip")).toBeNull();
  });

  it("two mounts with the SAME default (no tooltipContainer) still share ONE tooltip element in document.body", () => {
    const c1 = document.createElement("div");
    const c2 = document.createElement("div");
    mountChart(c1, { spec: LINE_SPEC, rows: LINE_ROWS });
    mountChart(c2, { spec: LINE_SPEC, rows: LINE_ROWS });
    expect(document.body.querySelectorAll(".tbl-tooltip").length).toBe(1);
  });

  it("two mounts with DIFFERENT tooltipContainer values get their OWN element, not one shared/fought-over node", () => {
    const c1 = document.createElement("div");
    const c2 = document.createElement("div");
    const wrapA = document.createElement("div");
    const wrapB = document.createElement("div");
    mountChart(c1, { spec: LINE_SPEC, rows: LINE_ROWS, tooltipContainer: wrapA });
    mountChart(c2, { spec: LINE_SPEC, rows: LINE_ROWS, tooltipContainer: wrapB });

    const tipA = wrapA.querySelector(".tbl-tooltip");
    const tipB = wrapB.querySelector(".tbl-tooltip");
    expect(tipA).not.toBeNull();
    expect(tipB).not.toBeNull();
    expect(tipA).not.toBe(tipB);
    expect(wrapA.querySelectorAll(".tbl-tooltip").length).toBe(1);
    expect(wrapB.querySelectorAll(".tbl-tooltip").length).toBe(1);
    // Neither leaked to document.body (the historical shared parent).
    expect(document.body.querySelector(".tbl-tooltip")).toBeNull();
  });
});

// Audit follow-through: the two rects the brief names are not the only unclassed elements in the
// coordinated-cursor chrome. These are the others found and classed (see task-8-report.md for the
// full audit, including what was left alone and why).
describe("other coordinated-cursor elements found in the audit (issue #30)", () => {
  it("the coordinated band-cursor's shaded region carries tbl-coord-region", () => {
    const container = document.createElement("div");
    const svg = mountAndHoverStack(container);
    expect(svg.querySelector("g.tbl-coord rect.tbl-coord-region")).not.toBeNull();
  });

  it("the coordinated line-cursor's guide and highlight ring carry tbl-coord-guide / tbl-coord-dot", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("width", "600");
    svg.setAttribute("height", "400");
    // A real Plot-rendered SVG carries a working `.scale()`; this synthetic one needs it stubbed
    // so the coordinated dot (gated on a resolved y-scale) renders too, not just the guide.
    (svg as unknown as { scale: (axis: string) => { domain: number[]; range: number[] } | undefined }).scale =
      (axis) => (axis === "y" ? { domain: [0, 10], range: [370, 18] } : undefined);
    document.body.appendChild(svg);

    const drive = attachSecondaryLineCursor(svg, {
      rows: [
        { time: "2020-01-01", series: "A", value: 3 },
        { time: "2021-01-01", series: "A", value: 5 },
      ],
      xField: "time",
      yField: "value",
      seriesField: "series",
      colors: new Map([["A", "#f00"]]),
    });
    drive(+new Date("2021-01-01"));

    const coord = svg.querySelector("g.tbl-coord")!;
    expect(coord.querySelector("line.tbl-coord-guide")).not.toBeNull();
    expect(coord.querySelector("circle.tbl-coord-dot")).not.toBeNull();
  });
});
