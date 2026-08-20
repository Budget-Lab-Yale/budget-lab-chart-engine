// @vitest-environment jsdom
//
// Events (#30, Task 7): onHover / onRender / onLegendSelect. Unlike the five programmatic hooks
// (Tasks 1-6), these are the ONLY customisation surface that survives publishing — a CLI-published
// standalone figure JSON-serialises spec + rows (src/cli/index.ts -> buildStandaloneHtml), so a
// function cannot cross that boundary, but a bubbling CustomEvent can be heard by the host page.
// Each event is therefore BOTH a MountOptions callback and a bubbling `tbl-*` CustomEvent from the
// card root, mirroring the existing `tbl-title-select` pattern (render-live.ts).
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { BandHoverCtx } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// The shared tooltip card is module-level singleton state (crosshair.ts's `activeTooltip`), reused
// across mounts as long as it is still attached to `document.body` — see hooks-tooltip.test.ts's
// identical concern. Clearing the body between tests keeps `.tbl-tooltip` assertions independent.
beforeEach(() => {
  document.body.innerHTML = "";
});

// A plain all-positive 2-series stack resolves `hoverMode: "pills"` (spec/bar-stack.ts's
// resolveHoverMode: netMode undefined -> "pills"), which attaches attachBandCrosshair with
// `emitOnly: true` and shows NO floating tooltip at all — exactly the shape the consumer this task
// exists for actually hits. `barStack.hover: "tooltip"` forces the alternate (floating-card) path
// so both are covered; see the two describe blocks below.
const STACKED_ROWS: TidyRow[] = [
  { time: "A", series: "Up", value: "6" },
  { time: "A", series: "Down", value: "4" },
  { time: "B", series: "Up", value: "5" },
  { time: "B", series: "Down", value: "2" },
];

function stackedSpec(extra?: Partial<ChartSpec>): ChartSpec {
  return {
    chartType: "stacked",
    title: "Stacked",
    xAxisType: "categorical",
    series_order: ["Up", "Down"],
    data: "inline",
    ...extra,
  } as unknown as ChartSpec;
}

/** Mount, attach the container to the document, and return the rendered SVG plus its
 *  band-crosshair hit rect's SVG-space geometry so a caller can build clientX/Y for a category. */
function mountAndFindHit(container: HTMLElement): { svg: SVGSVGElement; barCenterX: (n: number) => number } {
  document.body.appendChild(container);
  const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
  const vb = svg.viewBox.baseVal;
  // jsdom has no real layout: map the SVG's own getBoundingClientRect 1:1 onto its viewBox so a
  // pointer's clientX/Y map directly to SVG user-space coords (readCategoryBands reads rect x/width
  // ATTRIBUTES, not getBoundingClientRect — see hooks-tooltip.test.ts's identical setup).
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ width: vb.width, height: vb.height, top: 0, left: 0, right: vb.width, bottom: vb.height, x: 0, y: 0 }),
    configurable: true,
  });
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect'));
  const barCenterX = (n: number): number => {
    const rect = rects[n]!;
    return parseFloat(rect.getAttribute("x") ?? "0") + parseFloat(rect.getAttribute("width") ?? "0") / 2;
  };
  return { svg, barCenterX };
}

function hoverAt(svg: SVGSVGElement, clientX: number): void {
  // CROSSHAIR_HIT_SELECTOR (crosshair.ts) lists all five hit-rect classes; probing a hardcoded
  // class name risks matching a DIFFERENT chart type's hit rect that happens to also be present —
  // the exact trap this task's brief calls out.
  const hit = svg.querySelector(CROSSHAIR_HIT_SELECTOR)!;
  hit.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY: 20, bubbles: true }));
}

function leaveAt(svg: SVGSVGElement): void {
  const hit = svg.querySelector(CROSSHAIR_HIT_SELECTOR)!;
  hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// onHover — the coordinated/pills path (emitOnly, no floating card at all)
// ---------------------------------------------------------------------------

describe("onHover — default hover mode (pills, emitOnly — no floating tooltip)", () => {
  it("fires with the resolved category and its per-series values", () => {
    const seen: Array<BandHoverCtx | null> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onHover: (ctx) => seen.push(ctx),
    });
    const { svg, barCenterX } = mountAndFindHit(container);
    hoverAt(svg, barCenterX(0));
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1]!;
    expect(last).not.toBeNull();
    expect(last!.category).toBe("A");
    expect(last!.series).toEqual(["Up", "Down"]);
    expect(last!.values).toEqual({ Up: 6, Down: 4 });
    // No floating card in this hover mode — proving onHover is not merely piggy-backing on one.
    expect(document.body.querySelectorAll(".tbl-tooltip").length).toBe(0);
  });

  // Trap: a single-category assertion would pass even if the engine handed back the FIRST
  // category's values every time. Hovering a SECOND, different bar must report DIFFERENT values.
  it("reports different values for a different category — not a first-in-list confound", () => {
    const seen: Array<BandHoverCtx | null> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onHover: (ctx) => seen.push(ctx),
    });
    const { svg, barCenterX } = mountAndFindHit(container);
    // Stacked bars: rects[0]/[1] are category A's two segments (Up, Down) at the same x; the
    // NEXT category's bar starts at rects[2].
    hoverAt(svg, barCenterX(0));
    hoverAt(svg, barCenterX(2));
    const [first, second] = seen.filter((c): c is BandHoverCtx => c != null).slice(-2);
    expect(first!.category).toBe("A");
    expect(first!.values).toEqual({ Up: 6, Down: 4 });
    expect(second!.category).toBe("B");
    expect(second!.values).toEqual({ Up: 5, Down: 2 });
  });

  it("fires with null on pointer-leave", () => {
    const seen: Array<BandHoverCtx | null> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onHover: (ctx) => seen.push(ctx),
    });
    const { svg, barCenterX } = mountAndFindHit(container);
    hoverAt(svg, barCenterX(0));
    expect(seen[seen.length - 1]).not.toBeNull();
    leaveAt(svg);
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("a bubbling tbl-hover CustomEvent (same detail) reaches a listener on an ancestor", () => {
    let detail: BandHoverCtx | null | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    document.body.addEventListener("tbl-hover", (e) => {
      detail = (e as CustomEvent<BandHoverCtx | null>).detail;
    });
    mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
    });
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ width: vb.width, height: vb.height, top: 0, left: 0, right: vb.width, bottom: vb.height, x: 0, y: 0 }),
      configurable: true,
    });
    const rect = svg.querySelector<SVGRectElement>('g[aria-label="bar"] rect')!;
    const cx = parseFloat(rect.getAttribute("x") ?? "0") + parseFloat(rect.getAttribute("width") ?? "0") / 2;
    hoverAt(svg, cx);
    expect(detail).not.toBeUndefined();
    expect(detail).not.toBeNull();
    expect(detail!.category).toBe("A");
    expect(detail!.values).toEqual({ Up: 6, Down: 4 });
  });
});

// ---------------------------------------------------------------------------
// onHover — the tooltip path (barStack.hover: "tooltip") — the OTHER hoverMode
// ---------------------------------------------------------------------------

describe("onHover — tooltip hover mode", () => {
  it("still fires with chrome.tooltip: false — the consumer's actual use case", () => {
    const seen: Array<BandHoverCtx | null> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: stackedSpec({ barStack: { hover: "tooltip" }, chrome: { tooltip: false } }),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onHover: (ctx) => seen.push(ctx),
    });
    const { svg, barCenterX } = mountAndFindHit(container);
    hoverAt(svg, barCenterX(0));
    expect(document.body.querySelectorAll(".tbl-tooltip").length).toBe(0);
    const last = seen[seen.length - 1]!;
    expect(last).not.toBeNull();
    expect(last!.category).toBe("A");
    expect(last!.values).toEqual({ Up: 6, Down: 4 });
  });

  it("also fires normally when the tooltip card IS shown", () => {
    const seen: Array<BandHoverCtx | null> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: stackedSpec({ barStack: { hover: "tooltip" } }),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onHover: (ctx) => seen.push(ctx),
    });
    const { svg, barCenterX } = mountAndFindHit(container);
    hoverAt(svg, barCenterX(0));
    expect(document.body.querySelectorAll(".tbl-tooltip").length).toBe(1);
    expect(seen[seen.length - 1]).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onRender
// ---------------------------------------------------------------------------

describe("onRender", () => {
  it("fires with phase: \"mount\" once, with the mounted svg", () => {
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onRender: (ctx) => seen.push(ctx),
    });
    expect(seen.length).toBe(1);
    expect(seen[0]!.phase).toBe("mount");
    expect(seen[0]!.svg).toBe(container.querySelector(".figure-canvas svg"));
  });

  it("a bubbling tbl-render CustomEvent (same detail) reaches an ancestor listener", () => {
    let detail: { svg: SVGSVGElement; phase: string } | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    document.body.addEventListener("tbl-render", (e) => {
      detail = (e as CustomEvent<{ svg: SVGSVGElement; phase: string }>).detail;
    });
    mountChart(container, { spec: stackedSpec(), rows: STACKED_ROWS, width: 600, height: 360 });
    expect(detail?.phase).toBe("mount");
    expect(detail?.svg).toBe(container.querySelector(".figure-canvas svg"));
  });
});

// ---------------------------------------------------------------------------
// onLegendSelect
// ---------------------------------------------------------------------------

describe("onLegendSelect", () => {
  it("fires with the active series set when a legend row is pinned", () => {
    const seen: Array<{ active: string[] }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onLegendSelect: (ctx) => seen.push(ctx),
    });
    document.body.appendChild(container);
    const btn = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="Up"]')!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]!.active).toEqual(["Up"]);
  });

  it("a bubbling tbl-legend-select CustomEvent reaches an ancestor listener", () => {
    let detail: { active: string[] } | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    document.body.addEventListener("tbl-legend-select", (e) => {
      detail = (e as CustomEvent<{ active: string[] }>).detail;
    });
    mountChart(container, { spec: stackedSpec(), rows: STACKED_ROWS, width: 600, height: 360 });
    const btn = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="Down"]')!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(detail?.active).toEqual(["Down"]);
  });
});

// ---------------------------------------------------------------------------
// Nothing fires / nothing changes when no callbacks are passed
// ---------------------------------------------------------------------------

describe("no callbacks passed", () => {
  it("mounts without throwing and renders byte-identically to a mount with no event fields at all", () => {
    const a = document.createElement("div");
    mountChart(a, { spec: stackedSpec(), rows: STACKED_ROWS, width: 600, height: 360 });
    const b = document.createElement("div");
    mountChart(b, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onHover: undefined,
      onRender: undefined,
      onLegendSelect: undefined,
    });
    expect(b.innerHTML).toBe(a.innerHTML);
  });

  it("tbl-hover and tbl-legend-select never fire absent any interaction", () => {
    let hoverFired = false;
    let legendSelectFired = false;
    const container = document.createElement("div");
    document.body.appendChild(container);
    document.body.addEventListener("tbl-hover", () => { hoverFired = true; });
    document.body.addEventListener("tbl-legend-select", () => { legendSelectFired = true; });
    mountChart(container, { spec: stackedSpec(), rows: STACKED_ROWS, width: 600, height: 360 });
    expect(hoverFired).toBe(false);
    expect(legendSelectFired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Small multiples (faceted) path — wireFigureSvg's own forward
// ---------------------------------------------------------------------------
// Every hover-chrome feature in this engine has a standalone mountChart attach site AND a separate
// faceted-pane attach site inside wireFigureSvg (see test/hooks-tooltip.test.ts's identical
// concern) — gating/forwarding only the standalone pair would leave a small-multiples figure
// silently ignoring the callback.

describe("onHover / onRender — small multiples (wireFigureSvg forward)", () => {
  const FACETED_ROWS: TidyRow[] = [
    { pane: "P1", time: "A", value: "6", series: "Up" },
    { pane: "P1", time: "A", value: "4", series: "Down" },
    { pane: "P2", time: "A", value: "9", series: "Up" },
    { pane: "P2", time: "A", value: "1", series: "Down" },
  ] as unknown as TidyRow[];

  const FACETED_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "faceted",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "time", value: "value", series: "series", facet: "pane" },
    small_multiples: { columns: 2, mode: "shared" },
  } as unknown as ChartSpec;

  function hoverPane(svg: SVGSVGElement): void {
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ width: vb.width, height: vb.height, top: 0, left: 0, right: vb.width, bottom: vb.height, x: 0, y: 0 }),
      configurable: true,
    });
    const rect = svg.querySelector<SVGRectElement>('g[aria-label="bar"] rect')!;
    const cx = parseFloat(rect.getAttribute("x") ?? "0") + parseFloat(rect.getAttribute("width") ?? "0") / 2;
    hoverAt(svg, cx);
  }

  it("onHover reaches each pane — two different panes report two different value sets", () => {
    const seen: Array<BandHoverCtx | null> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: FACETED_SPEC,
      rows: FACETED_ROWS,
      width: 838,
      height: 420,
      onHover: (ctx) => seen.push(ctx),
    });
    document.body.appendChild(container);
    const panes = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    expect(panes.length).toBe(2);
    for (const p of panes) hoverPane(p);
    const [first, second] = seen.filter((c): c is BandHoverCtx => c != null).slice(-2);
    expect(first!.values).toEqual({ Up: 6, Down: 4 });
    expect(second!.values).toEqual({ Up: 9, Down: 1 });
  });

  it("onRender fires once PER PANE at mount, each with that pane's own svg", () => {
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: FACETED_SPEC,
      rows: FACETED_ROWS,
      width: 838,
      height: 420,
      onRender: (ctx) => seen.push(ctx),
    });
    const panes = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    expect(panes.length).toBe(2);
    expect(seen.length).toBe(2);
    expect(seen.every((c) => c.phase === "mount")).toBe(true);
    expect(seen.map((c) => c.svg)).toEqual(panes);
  });
});
