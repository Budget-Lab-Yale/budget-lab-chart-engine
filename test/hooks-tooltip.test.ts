// @vitest-environment jsdom
//
// hooks.tooltip (#30, Task 5): a screen-only content hook — the consumer replaces the band
// tooltip's CONTENT while the engine keeps doing the hit-testing, positioning and band highlight
// (see spec/hooks.ts's module note: there is no export-parity guarantee here, unlike every other
// hook, because a static PNG has no hover state).
//
// SCOPE: this hook reaches buildBandTooltipHtml's two call sites only — attachBandCrosshair (bar/
// stacked/waterfall) and attachCategoricalLineCrosshair (dot plots, dumbbells, categorical-x line
// charts). attachCrosshair / attachFacetCrosshair / attachHistogramHover / attachPointHover build
// their card markup elsewhere and are NOT reached (documented at Task 9 / CONFIG-SPEC.md).
//
// A builder-only test cannot prove the option actually reaches the DOM: this branch has already
// shipped two "forgot the forward" defects of exactly this shape (an internal crosshair.ts forward,
// and a render-live.ts call site). So this file pairs pure buildBandTooltipHtml assertions with
// live-DOM mountChart tests through BOTH call sites, plus the small-multiples (wireFigureSvg) path.
import { describe, it, expect, beforeEach } from "vitest";
import { buildBandTooltipHtml, CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { TooltipHookCtx } from "../src/spec/hooks";

type BandRow = { _xc?: string; series: string; _y: number | null };

// The shared tooltip card is module-level singleton state (crosshair.ts's `activeTooltip`), reused
// across mounts as long as it is still attached to `document.body` — so `.tbl-tooltip` assertions
// are order-dependent unless the body is cleared between tests.
beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// buildBandTooltipHtml — pure
// ---------------------------------------------------------------------------

describe("buildBandTooltipHtml + tooltipHook", () => {
  const ROWS: BandRow[] = [
    { _xc: "A", series: "Up", _y: 6 },
    { _xc: "A", series: "Down", _y: -4 },
  ];

  it("uses the hook's returned HTML instead of the engine's own card", () => {
    const html = buildBandTooltipHtml("A", ROWS, {
      seriesOrder: ["Up", "Down"],
      tooltipHook: () => '<div class="mine">hooked</div>',
    });
    expect(html).toBe('<div class="mine">hooked</div>');
  });

  it("a null return keeps the engine's own card, byte-identical to no hook at all", () => {
    const withHook = buildBandTooltipHtml("A", ROWS, {
      seriesOrder: ["Up", "Down"],
      tooltipHook: () => null,
    });
    const withoutHook = buildBandTooltipHtml("A", ROWS, { seriesOrder: ["Up", "Down"] });
    expect(withHook).toBe(withoutHook);
    expect(withoutHook).toContain("tbl-tooltip-head");
  });

  it("ctx.category and ctx.series carry the hovered category and its ordered series list", () => {
    let seen: TooltipHookCtx | undefined;
    buildBandTooltipHtml("A", ROWS, {
      seriesOrder: ["Up", "Down"],
      tooltipHook: (ctx) => { seen = ctx; return null; },
    });
    expect(seen?.category).toBe("A");
    expect(seen?.series).toEqual(["Up", "Down"]);
  });

  it("ctx.values carries the hovered category's per-series numbers", () => {
    let seen: TooltipHookCtx | undefined;
    buildBandTooltipHtml("A", ROWS, {
      seriesOrder: ["Up", "Down"],
      tooltipHook: (ctx) => { seen = ctx; return null; },
    });
    expect(seen?.values).toEqual({ Up: 6, Down: -4 });
  });

  it("ctx.rendered is the engine's own generated markup — a genuine pass-through hook is a no-op", () => {
    let capturedRendered = "";
    const passThrough = buildBandTooltipHtml("A", ROWS, {
      seriesOrder: ["Up", "Down"],
      tooltipHook: (ctx) => { capturedRendered = ctx.rendered; return ctx.rendered; },
    });
    const engineOnly = buildBandTooltipHtml("A", ROWS, { seriesOrder: ["Up", "Down"] });
    expect(capturedRendered).toBe(engineOnly);
    expect(passThrough).toBe(engineOnly);
  });

  it("ctx.total is present when a stacked Total row would actually be shown", () => {
    let seen: TooltipHookCtx | undefined;
    buildBandTooltipHtml("A", ROWS, {
      isStacked: true,
      totalRow: "dot",
      seriesOrder: ["Up", "Down"],
      tooltipHook: (ctx) => { seen = ctx; return null; },
    });
    expect(seen?.total).toBe(2); // 6 + (-4)
  });

  // `total` is honest, not the raw series sum unconditionally: attachCategoricalLineCrosshair's
  // call into this builder never passes isStacked/totalRow at all (line/dot/dumbbell charts have
  // no stack to total), so a hook there must not be handed a number mislabelled as a stack total.
  it("ctx.total is absent when there is no Total row (isStacked/totalRow unset, as the categorical-line call site leaves them)", () => {
    let seen: TooltipHookCtx | undefined;
    buildBandTooltipHtml("A", ROWS, {
      seriesOrder: ["Up", "Down"],
      tooltipHook: (ctx) => { seen = ctx; return null; },
    });
    expect(seen?.total).toBeUndefined();
  });

  it("ctx.total is absent for a stacked chart whose totalRow is 'none'", () => {
    let seen: TooltipHookCtx | undefined;
    buildBandTooltipHtml("A", ROWS, {
      isStacked: true,
      totalRow: "none",
      seriesOrder: ["Up", "Down"],
      tooltipHook: (ctx) => { seen = ctx; return null; },
    });
    expect(seen?.total).toBeUndefined();
  });

  it("no tooltipHook at all renders identically to an explicit undefined", () => {
    const a = buildBandTooltipHtml("A", ROWS, { seriesOrder: ["Up", "Down"] });
    const b = buildBandTooltipHtml("A", ROWS, { seriesOrder: ["Up", "Down"], tooltipHook: undefined });
    expect(b).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// Live DOM, call site 1: attachBandCrosshair (bar/stacked) via mountChart
// ---------------------------------------------------------------------------
// A plain all-positive 2-series stack resolves hoverMode "pills" and never shows a floating card
// at all — chrome or hooks aside — leaving every assertion below vacuously true (this exact defect
// shipped in Task 1's brief). `barStack.hover: "tooltip"` forces the card deterministically.

const STACKED_SPEC: ChartSpec = {
  chartType: "stacked",
  title: "Stacked",
  xAxisType: "categorical",
  series_order: ["Up", "Down"],
  barStack: { hover: "tooltip" },
  data: "inline",
};
const STACKED_ROWS: TidyRow[] = [
  { time: "A", series: "Up", value: "6" },
  { time: "A", series: "Down", value: "4" },
  { time: "B", series: "Up", value: "5" },
  { time: "B", series: "Down", value: "2" },
];

function hoverFirstBar(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
  const vb = svg.viewBox.baseVal;
  // jsdom has no real layout: map the SVG's own getBoundingClientRect 1:1 onto its viewBox so a
  // pointer's clientX/Y map directly to SVG user-space coords (readCategoryBands reads rect x/width
  // ATTRIBUTES, not getBoundingClientRect, so no further per-element mocking is needed here).
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ width: vb.width, height: vb.height, top: 0, left: 0, right: vb.width, bottom: vb.height, x: 0, y: 0 }),
    configurable: true,
  });
  const rect = svg.querySelector<SVGRectElement>('g[aria-label="bar"] rect')!;
  const cx = parseFloat(rect.getAttribute("x") ?? "0") + parseFloat(rect.getAttribute("width") ?? "0") / 2;
  document.body.appendChild(container);
  // CROSSHAIR_HIT_SELECTOR (crosshair.ts) lists all five hit-rect classes; probing a hardcoded
  // class name risks matching a DIFFERENT chart type's hit rect that happens to also be present.
  const hit = svg.querySelector(CROSSHAIR_HIT_SELECTOR)!;
  hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
  return svg;
}

describe("hooks.tooltip — live DOM via attachBandCrosshair (mountChart)", () => {
  it("replaces the floating tooltip's content when hovering a bar", () => {
    const container = document.createElement("div");
    mountChart(container, {
      spec: STACKED_SPEC,
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      hooks: { tooltip: (ctx) => `<div class="mine">${ctx.category}:${JSON.stringify(ctx.values)}</div>` },
    });
    hoverFirstBar(container);
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    expect(tip.innerHTML).toContain('class="mine"');
    expect(tip.innerHTML).not.toContain("tbl-tooltip-head");
  });

  it("a null-returning hook keeps the engine's own card", () => {
    const container = document.createElement("div");
    mountChart(container, {
      spec: STACKED_SPEC,
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      hooks: { tooltip: () => null },
    });
    hoverFirstBar(container);
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    expect(tip.querySelector(".tbl-tooltip-head")).not.toBeNull();
  });

  it("chrome.tooltip: false suppresses the card even with a tooltip hook set — the consumer draws its own", () => {
    const container = document.createElement("div");
    const spec: ChartSpec = { ...STACKED_SPEC, chrome: { tooltip: false } };
    mountChart(container, {
      spec,
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      hooks: { tooltip: () => '<div class="mine">hooked</div>' },
    });
    const svg = hoverFirstBar(container);
    expect(document.body.querySelectorAll(".tbl-tooltip").length).toBe(0);
    // Only the floating card is suppressed — the hit area and band highlight (what makes the hook
    // still worth having: the engine keeps doing hit-testing/positioning) survive untouched.
    expect(svg.querySelectorAll(".tbl-band-crosshair-hit").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".tbl-band-crosshair-hl").length).toBeGreaterThan(0);
  });

  it("renders byte-identically with hooks: {} vs no hooks at all", () => {
    const a = document.createElement("div");
    mountChart(a, { spec: STACKED_SPEC, rows: STACKED_ROWS, width: 600, height: 360 });
    const b = document.createElement("div");
    mountChart(b, { spec: STACKED_SPEC, rows: STACKED_ROWS, width: 600, height: 360, hooks: {} });
    expect(b.innerHTML).toBe(a.innerHTML);
  });
});

// ---------------------------------------------------------------------------
// Live DOM, call site 2: attachCategoricalLineCrosshair (categorical-x LINE) via mountChart
// ---------------------------------------------------------------------------
// Proves the SECOND buildBandTooltipHtml call site is hooked — the exact gap this task exists to
// close (works on stacked bars, silently not on a categorical line chart).

const CATLINE_SPEC: ChartSpec = {
  chartType: "line",
  title: "Categorical line",
  xAxisType: "categorical",
  series_order: ["A", "B"],
  data: "inline",
};
const CATLINE_ROWS: TidyRow[] = [
  { time: "18-21", series: "A", value: "1" },
  { time: "22-25", series: "A", value: "2" },
  { time: "18-21", series: "B", value: "3" },
  { time: "22-25", series: "B", value: "4" },
];

// jsdom has no real text layout: attachCategoricalLineCrosshair resolves category centers via each
// x-axis label's getBoundingClientRect (readCategoryCentersFromAxis), which jsdom always reports as
// an all-zero rect — silently skipped by that function's own `if (!r.width) continue`, so a real
// pointermove would never resolve a category at all. Plot still writes each label's true position
// as SVG `transform="translate(x,y)"` attributes (on the <text> and its wrapping <g>), so this
// derives the same absolute position from those attributes instead of fabricating one.
function mockAxisLabelRects(svg: SVGSVGElement): void {
  const translate = (el: Element): { x: number; y: number } => {
    const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)/.exec(el.getAttribute("transform") ?? "");
    return { x: m ? +m[1]! : 0, y: m ? +m[2]! : 0 };
  };
  for (const t of Array.from(svg.querySelectorAll("text"))) {
    const self = translate(t);
    const parent = t.parentElement ? translate(t.parentElement) : { x: 0, y: 0 };
    const x = self.x + parent.x;
    const y = self.y + parent.y;
    Object.defineProperty(t, "getBoundingClientRect", {
      value: () => ({ left: x - 5, right: x + 5, top: y - 5, bottom: y + 5, width: 10, height: 10 }),
      configurable: true,
    });
  }
}

function hoverCatLineCategory(container: HTMLElement, categoryText: string): void {
  const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ width: vb.width, height: vb.height, top: 0, left: 0, right: vb.width, bottom: vb.height, x: 0, y: 0 }),
    configurable: true,
  });
  mockAxisLabelRects(svg);
  document.body.appendChild(container);
  const label = Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === categoryText)!;
  const rect = label.getBoundingClientRect();
  const cx = (rect.left + rect.right) / 2;
  const hit = svg.querySelector(CROSSHAIR_HIT_SELECTOR)!;
  hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
}

describe("hooks.tooltip — live DOM via attachCategoricalLineCrosshair (mountChart)", () => {
  it("replaces the floating tooltip's content on a categorical-x LINE chart", () => {
    const container = document.createElement("div");
    mountChart(container, {
      spec: CATLINE_SPEC,
      rows: CATLINE_ROWS,
      width: 720,
      height: 400,
      hooks: { tooltip: (ctx) => `<div class="mine">${ctx.category}</div>` },
    });
    hoverCatLineCategory(container, "18-21");
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    expect(tip.innerHTML).toBe('<div class="mine">18-21</div>');
  });

  it("a null-returning hook keeps the engine's own card on this call site too", () => {
    const container = document.createElement("div");
    mountChart(container, {
      spec: CATLINE_SPEC,
      rows: CATLINE_ROWS,
      width: 720,
      height: 400,
      hooks: { tooltip: () => null },
    });
    hoverCatLineCategory(container, "18-21");
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    expect(tip.querySelector(".tbl-tooltip-head")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Live DOM: small multiples — wireFigureSvg's own forward (a THIRD render-live.ts site)
// ---------------------------------------------------------------------------
// Every hover-chrome feature in this engine has a standalone mountChart attach site AND a separate
// faceted-pane attach site inside wireFigureSvg (see test/chrome-switches.test.ts's identical
// concern for `chrome`) — gating/forwarding only the standalone pair would leave a small-multiples
// figure silently ignoring the hook.

describe("hooks.tooltip — small multiples (wireFigureSvg forward)", () => {
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

  const FACETED_SPEC: ChartSpec = {
    chartType: "bar",
    title: "faceted",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "time", value: "value", series: "series", facet: "pane" },
    // coordinated_cursor: false is what reaches each pane's floating tooltip rather than the
    // coordinated in-place pills (see test/band-crosshair.test.ts) — otherwise the pane's band
    // crosshair attaches emitOnly and `.tbl-tooltip` never appears, hook or not.
    small_multiples: { columns: 2, mode: "shared", coordinated_cursor: false },
  } as unknown as ChartSpec;

  it("reaches each pane's floating tooltip", () => {
    const container = document.createElement("div");
    mountChart(container, {
      spec: FACETED_SPEC,
      rows: FACETED_ROWS,
      width: 838,
      height: 420,
      hooks: { tooltip: () => '<div class="mine">hooked</div>' },
    });
    const svg = container.querySelector<SVGSVGElement>(".figure-pane svg")!;
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ width: vb.width, height: vb.height, top: 0, left: 0, right: vb.width, bottom: vb.height, x: 0, y: 0 }),
      configurable: true,
    });
    const rect = svg.querySelector<SVGRectElement>('g[aria-label="bar"] rect')!;
    const cx = parseFloat(rect.getAttribute("x") ?? "0") + parseFloat(rect.getAttribute("width") ?? "0") / 2;
    document.body.appendChild(container);
    const hit = svg.querySelector(CROSSHAIR_HIT_SELECTOR)!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    expect(tip.innerHTML).toBe('<div class="mine">hooked</div>');
  });
});
