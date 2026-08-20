// @vitest-environment jsdom
//
// Events (#30, Task 7): onHover / onRender / onLegendSelect. Unlike the five programmatic hooks
// (Tasks 1-6), these are the ONLY customisation surface that survives publishing — a CLI-published
// standalone figure JSON-serialises spec + rows (src/cli/index.ts -> buildStandaloneHtml), so a
// function cannot cross that boundary, but a bubbling CustomEvent can be heard by the host page.
// Each event is therefore BOTH a MountOptions callback and a bubbling `tbl-*` CustomEvent from the
// card root, mirroring the existing `tbl-title-select` pattern (render-live.ts).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

// The "mount" phase of onRender is deliberately deferred one microtask past mountChart()'s own
// return (see render-live.ts's dispatch comment: a throwing onRender at mount would otherwise
// make mountChart() itself throw, so the caller never gets the teardown and the ResizeObserver
// never attaches). Tests asserting the mount-phase event must flush the microtask queue first.
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

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
  it("fires with phase: \"mount\" once, with the mounted svg (deferred one microtask past mountChart's own return)", async () => {
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onRender: (ctx) => seen.push(ctx),
    });
    // Not yet: the mount-phase dispatch is deferred past mountChart()'s own synchronous return.
    expect(seen.length).toBe(0);
    await flushMicrotasks();
    expect(seen.length).toBe(1);
    expect(seen[0]!.phase).toBe("mount");
    expect(seen[0]!.svg).toBe(container.querySelector(".figure-canvas svg"));
  });

  it("a bubbling tbl-render CustomEvent (same detail) reaches an ancestor listener", async () => {
    let detail: { svg: SVGSVGElement; phase: string } | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    document.body.addEventListener("tbl-render", (e) => {
      detail = (e as CustomEvent<{ svg: SVGSVGElement; phase: string }>).detail;
    });
    mountChart(container, { spec: stackedSpec(), rows: STACKED_ROWS, width: 600, height: 360 });
    await flushMicrotasks();
    expect(detail?.phase).toBe("mount");
    expect(detail?.svg).toBe(container.querySelector(".figure-canvas svg"));
  });

  it("mountChart still returns its teardown function even when onRender throws at mount, and the error still surfaces (unhandled, on its own microtask)", async () => {
    const container = document.createElement("div");
    let caught: unknown;
    // queueMicrotask's callback throwing surfaces as an uncaughtException in Node (verified: it
    // is NOT a promise rejection here, since notify() is called directly inside the microtask
    // callback, not inside a .then()). Capture it so the test doesn't fail the whole process
    // while still proving the throw was NOT swallowed.
    const onUncaught = (err: unknown): void => { caught = err; };
    process.once("uncaughtException", onUncaught);
    let destroy: (() => void) | undefined;
    expect(() => {
      destroy = mountChart(container, {
        spec: stackedSpec(),
        rows: STACKED_ROWS,
        width: 600,
        height: 360,
        onRender: () => { throw new Error("boom"); },
      });
    }).not.toThrow();
    // The caller DID receive the teardown -- the whole point of deferring.
    expect(typeof destroy).toBe("function");
    await flushMicrotasks();
    expect((caught as Error | undefined)?.message).toBe("boom");
    process.removeListener("uncaughtException", onUncaught);
  });

  // The deferral itself opens a second hole: a synchronous mount-then-teardown (React
  // StrictMode's dev double-invoke does exactly this) would otherwise let the queued "mount"
  // dispatch fire AFTER the caller has already torn the chart down -- handing onRender a
  // detached svg for a chart the consumer explicitly disposed of. The companion assertion (no
  // teardown call) proves this is the disposed-guard doing the suppressing, not microtask timing
  // just happening to be slow.
  it("does NOT fire onRender's mount phase if the mount is torn down before the deferred microtask runs", async () => {
    const container = document.createElement("div");
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const destroy = mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onRender: (ctx) => seen.push(ctx),
    });
    destroy(); // synchronous, immediately -- before the deferred microtask has run
    await flushMicrotasks();
    expect(seen.length).toBe(0);
  });

  it("(companion) DOES fire onRender's mount phase when the mount is left standing -- proving the guard, not slow microtasks", async () => {
    const container = document.createElement("div");
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    mountChart(container, {
      spec: stackedSpec(),
      rows: STACKED_ROWS,
      width: 600,
      height: 360,
      onRender: (ctx) => seen.push(ctx),
    });
    // No destroy() call.
    await flushMicrotasks();
    expect(seen.length).toBe(1);
    expect(seen[0]!.phase).toBe("mount");
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

describe("onHover / onRender / onLegendSelect — small multiples (wireFigureSvg / mountFigure forward)", () => {
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

  it("onRender fires once PER PANE at mount, each with that pane's own svg (mount is deferred, same as the standalone path)", async () => {
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: FACETED_SPEC,
      rows: FACETED_ROWS,
      width: 838,
      height: 420,
      onRender: (ctx) => seen.push(ctx),
    });
    expect(seen.length).toBe(0); // deferred past mountChart()'s own synchronous return
    await flushMicrotasks();
    const panes = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    expect(panes.length).toBe(2);
    expect(seen.length).toBe(2);
    expect(seen.every((c) => c.phase === "mount")).toBe(true);
    expect(seen.map((c) => c.svg)).toEqual(panes);
  });

  // Same disposed-guard concern as the standalone path's identical pair (mountFigure got the
  // exact same "mount" deferral, for the exact same reason -- its own ResizeObserver/teardown
  // construction also comes after the initial draw() call).
  it("does NOT fire onRender's mount phase on any pane if torn down before the deferred microtask runs", async () => {
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    const destroy = mountChart(container, {
      spec: FACETED_SPEC,
      rows: FACETED_ROWS,
      width: 838,
      height: 420,
      onRender: (ctx) => seen.push(ctx),
    });
    destroy();
    await flushMicrotasks();
    expect(seen.length).toBe(0);
  });

  it("(companion) DOES fire onRender's mount phase per pane when left standing -- proving the guard, not slow microtasks", async () => {
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: FACETED_SPEC,
      rows: FACETED_ROWS,
      width: 838,
      height: 420,
      onRender: (ctx) => seen.push(ctx),
    });
    await flushMicrotasks();
    expect(seen.length).toBe(2);
  });

  // onLegendSelect's dispatch site inside mountFigure (its own renderLegend onHighlight,
  // structurally identical to mountChart's) was previously untested -- only the standalone path
  // was exercised.
  it("onLegendSelect fires on the faceted path too, with the active series set", () => {
    const seen: Array<{ active: string[] }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: FACETED_SPEC,
      rows: FACETED_ROWS,
      width: 838,
      height: 420,
      onLegendSelect: (ctx) => seen.push(ctx),
    });
    document.body.appendChild(container);
    const btn = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="Up"]')!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]!.active).toEqual(["Up"]);
  });

  it("a bubbling tbl-legend-select CustomEvent reaches an ancestor listener on the faceted path", () => {
    let detail: { active: string[] } | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    document.body.addEventListener("tbl-legend-select", (e) => {
      detail = (e as CustomEvent<{ active: string[] }>).detail;
    });
    mountChart(container, { spec: FACETED_SPEC, rows: FACETED_ROWS, width: 838, height: 420 });
    const btn = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="Down"]')!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(detail?.active).toEqual(["Down"]);
  });
});

// ---------------------------------------------------------------------------
// onRender — resize dispatch sees the finished DOM (Part 1, second review wave)
// ---------------------------------------------------------------------------
// The per-pane dispatch must fire AFTER the legend is rebuilt and every pane is wired (the true
// end of drawGrid), not right after the pane SVGs are appended -- else a SYNCHRONOUS resize (or
// reselect) dispatch hands a consumer the PREVIOUS render's legend, and the
// legendSlot.replaceChildren() a few lines later wipes any DOM the consumer just applied.
// Asserting only that the callback fired would not catch this -- the callback fires either way,
// before or after the fix. The marker's SURVIVAL past the redraw is the assertion that actually
// distinguishes "dispatched before replaceChildren" from "dispatched after".

describe("onRender — resize dispatch sees the finished DOM (Part 1)", () => {
  /** Minimal ResizeObserver stub — jsdom has none. Captures the callback so a test can invoke it
   *  directly to simulate the engine's own resize re-render, same pattern as
   *  title-selector-live.test.ts's FakeResizeObserver. */
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      FakeResizeObserver.instances.push(this);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    FakeResizeObserver.instances = [];
  });

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

  it("a resize's onRender finds the legend present, and a marker it appends survives the redraw", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const container = document.createElement("div");
    document.body.appendChild(container);

    let legendPresentAtResize: boolean | undefined;
    mountChart(container, {
      spec: FACETED_SPEC,
      rows: FACETED_ROWS,
      width: 838,
      height: 420,
      onRender: (ctx) => {
        if (ctx.phase !== "resize") return;
        const legendSlot = container.querySelector(".figure-legend-slot");
        legendPresentAtResize = !!legendSlot && legendSlot.childElementCount > 0;
        const marker = document.createElement("span");
        marker.className = "consumer-marker";
        legendSlot?.appendChild(marker);
      },
    });

    // No resize has happened yet.
    expect(legendPresentAtResize).toBeUndefined();
    expect(container.querySelector(".consumer-marker")).toBeNull();

    // Force a genuinely different pane-grid signature so the resize handler doesn't take
    // drawGrid's `sig === lastSig` same-width early-return branch -- jsdom's card.clientWidth is
    // always 0, so without this override the resize call would just re-resolve to the SAME width
    // as mount and skip the redraw (and the dispatch) entirely.
    const cardEl = container.querySelector<HTMLElement>(".figure-card")!;
    Object.defineProperty(cardEl, "clientWidth", { value: 480, configurable: true });

    expect(FakeResizeObserver.instances.length).toBeGreaterThan(0);
    for (const inst of FakeResizeObserver.instances) inst.cb([], inst as unknown as ResizeObserver);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

    expect(legendPresentAtResize).toBe(true);
    // The critical assertion: the marker the consumer appended DURING the dispatch must still be
    // in the DOM afterward -- not wiped by a legendSlot.replaceChildren() later in the same draw.
    expect(container.querySelector(".consumer-marker")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onRender — phase: "restack" (area chart legend-driven click-to-restack)
// ---------------------------------------------------------------------------
// A fourth real re-render occasion beyond mount/resize/reselect: pinning a series on an area
// chart moves it to the bottom of the stack and forces its own draw() (render-live.ts's
// onHighlight, gated on spec.chartType === "area" && !suppressRestack). onRender must fire for
// it too -- silence here is a silent-tweak-death bug for a consumer using onRender as a
// MutationObserver replacement, not a merely cosmetic gap.
//
// Task 6 (hooks.afterRender) shipped a double-fire from a throwaway pre-render once already, so
// this asserts the COUNT, not just that the phase value is reachable: exactly ONE "restack" event
// per user click, not one per pin the restoration loop (currentLegendHandle.toggle(s), fired
// while suppressRestack is still true) re-toggles afterward.
describe('onRender — phase: "restack" (area click-to-restack)', () => {
  const AREA_SPEC: ChartSpec = {
    chartType: "area",
    title: "Area",
    xAxisType: "temporal",
    series_order: ["A", "B", "C"],
    data: "inline",
  } as unknown as ChartSpec;
  const AREA_ROWS: TidyRow[] = ["2024-01-01", "2024-02-01"].flatMap((t) => [
    { time: t, series: "A", value: "1" },
    { time: t, series: "B", value: "2" },
    { time: t, series: "C", value: "3" },
  ]) as unknown as TidyRow[];
  const legendItem = (c: HTMLElement, s: string): HTMLElement | undefined =>
    [...c.querySelectorAll<HTMLElement>(".tbl-legend-item")].find((b) => b.getAttribute("data-series") === s);

  it("fires exactly once per pin, with phase: \"restack\" and the freshly re-rendered svg", () => {
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: AREA_SPEC,
      rows: AREA_ROWS,
      onRender: (ctx) => seen.push(ctx),
    });
    // The mount-phase event is deferred (see the onRender describe block above) so it hasn't
    // arrived yet regardless; either way, no "restack" has happened yet.
    expect(seen.filter((c) => c.phase === "restack").length).toBe(0);

    legendItem(container, "C")!.click();

    const restackEvents = seen.filter((c) => c.phase === "restack");
    expect(restackEvents.length).toBe(1); // not 2+ from the pin-restoration re-toggle loop
    expect(restackEvents[0]!.svg).toBe(container.querySelector(".figure-canvas svg"));
  });

  it("a bubbling tbl-render CustomEvent with phase: \"restack\" reaches an ancestor listener, exactly once per pin", () => {
    const details: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    document.body.addEventListener("tbl-render", (e) => {
      details.push((e as CustomEvent<{ svg: SVGSVGElement; phase: string }>).detail);
    });
    mountChart(container, { spec: AREA_SPEC, rows: AREA_ROWS });

    legendItem(container, "B")!.click();
    expect(details.filter((d) => d.phase === "restack").length).toBe(1);

    legendItem(container, "C")!.click();
    expect(details.filter((d) => d.phase === "restack").length).toBe(2); // one more, for the second pin
  });

  it("does not fire \"restack\" for a NON-area chart's legend pin (no restack feature there)", () => {
    const seen: Array<{ svg: SVGSVGElement; phase: string }> = [];
    const container = document.createElement("div");
    mountChart(container, {
      spec: { ...stackedSpec(), series_order: ["Up", "Down"] },
      rows: STACKED_ROWS,
      onRender: (ctx) => seen.push(ctx),
    });
    document.body.appendChild(container);
    const btn = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="Up"]')!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen.filter((c) => c.phase === "restack").length).toBe(0);
  });

  // The critical case: a throwing onRender must not permanently corrupt the mount. jsdom (matching
  // the WHATWG DOM spec) does NOT propagate a listener's throw out of dispatchEvent()/.click() to
  // the caller -- it reports it via process's "uncaughtException" instead (verified directly: a
  // plain `btn.addEventListener("click", () => { throw ... }); btn.click();` does not throw
  // synchronously at the call site). So this asserts the OUTCOME state, not a thrown call.
  it("a throwing onRender during a restack does not desync the legend's pins or permanently disable future restacks", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let restackCount = 0;
    mountChart(container, {
      spec: AREA_SPEC,
      rows: AREA_ROWS,
      onRender: (ctx) => {
        if (ctx.phase !== "restack") return;
        restackCount++;
        if (restackCount === 1) throw new Error("consumer bug in onRender");
      },
    });
    const caught: unknown[] = [];
    const onUncaught = (err: unknown): void => { caught.push(err); };
    process.once("uncaughtException", onUncaught);

    // First pin: triggers the first restack, whose onRender throws. jsdom logs the stack trace to
    // stderr as part of its own error reporting (expected, harmless noise -- see the comment above).
    legendItem(container, "C")!.click();
    process.removeListener("uncaughtException", onUncaught);
    expect(caught.length).toBe(1);
    expect((caught[0] as Error).message).toBe("consumer bug in onRender");
    expect(restackCount).toBe(1);

    // NOT desynced: the throw happened AFTER draw() rebuilt the legend (fresh, unpinned) but the
    // finally-guarded pin-restoration loop still re-pinned "C" on that fresh legend.
    const cBtn = legendItem(container, "C")!;
    expect(cBtn.getAttribute("aria-pressed")).toBe("true");
    expect(cBtn.classList.contains("is-pinned")).toBe(true);

    // STILL restackable: suppressRestack must have been reset to false in the finally, not left
    // stuck true by the throw -- pinning a second series must trigger a SECOND restack.
    legendItem(container, "B")!.click();
    expect(restackCount).toBe(2);
    const order = [...container.querySelectorAll('g[aria-label="area"] path[data-series]')].map((p) =>
      p.getAttribute("data-series"),
    );
    expect(order.slice(0, 2)).toEqual(["C", "B"]); // C first (pinned first) then B, at the bottom
  });

  // The SECOND throw site in the same restack, and the reason the outer try/finally alone was not
  // enough: the pin-restoration loop itself calls legend.toggle(s) -> applyHighlight -> onHighlight
  // -> notify(onLegendSelect). A consumer callback that throws THERE throws from inside the
  // `finally`, which is not covered by that finally -- so `suppressRestack = false` was skipped and
  // every later restack on the mount was silently dead. Unlike the onRender case above, this throw
  // is NOT swallowed by jsdom at the toggle call (we call toggle() directly, not via dispatchEvent);
  // it propagates up to the legend button's click listener, where jsdom reports it.
  it("a throwing onLegendSelect during pin restoration does not permanently disable future restacks", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    // Armed only for the first notify carrying a NON-EMPTY active set after the click. Call order
    // inside one restack is: draw()'s fresh legend build (active = [], skipped by the length test),
    // then the pin-restoration toggle (active = ["C"]) -- the site under test.
    let armed = false;
    const seen: string[][] = [];
    mountChart(container, {
      spec: AREA_SPEC,
      rows: AREA_ROWS,
      onLegendSelect: (ctx) => {
        seen.push(ctx.active);
        if (armed && ctx.active.length > 0) {
          armed = false;
          throw new Error("consumer bug in onLegendSelect");
        }
      },
    });
    const caught: unknown[] = [];
    const onUncaught = (err: unknown): void => { caught.push(err); };
    process.once("uncaughtException", onUncaught);
    armed = true;
    legendItem(container, "C")!.click();
    process.removeListener("uncaughtException", onUncaught);
    expect(caught.length).toBe(1);
    expect((caught[0] as Error).message).toBe("consumer bug in onLegendSelect");

    // The pin itself was restored (togglePin mutates its state and the DOM BEFORE it notifies).
    expect(legendItem(container, "C")!.getAttribute("aria-pressed")).toBe("true");

    // The observable proof that suppressRestack was reset: a SUBSEQUENT restack still works. With
    // the reset skipped, clicking "B" re-renders nothing and the band order stays ["C", "A", ...].
    legendItem(container, "B")!.click();
    const order = [...container.querySelectorAll('g[aria-label="area"] path[data-series]')].map((p) =>
      p.getAttribute("data-series"),
    );
    expect(order.slice(0, 2)).toEqual(["C", "B"]);
  });

  // BOTH throw sites firing in the SAME restack. The render failure comes first and is the more
  // informative of the two -- the legend error is a consequence of cleaning up after it -- but the
  // cleanup ran inside a `finally`, and an exception thrown from a `finally` REPLACES the pending
  // one, so the render failure was discarded and the consumer only ever saw the legend error.
  it("surfaces the FIRST error when both onRender and onLegendSelect throw in one restack", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let restackCount = 0;
    let armed = false;
    mountChart(container, {
      spec: AREA_SPEC,
      rows: AREA_ROWS,
      onRender: (ctx) => {
        if (ctx.phase !== "restack") return;
        restackCount++;
        if (restackCount === 1) throw new Error("E1-onRender");
      },
      onLegendSelect: (ctx) => {
        // Same arming as the test above: only the pin-restoration toggle carries a non-empty set.
        if (armed && ctx.active.length > 0) {
          armed = false;
          throw new Error("E2-onLegendSelect");
        }
      },
    });
    const caught: unknown[] = [];
    const onUncaught = (err: unknown): void => { caught.push(err); };
    process.once("uncaughtException", onUncaught);
    armed = true;
    legendItem(container, "C")!.click();
    process.removeListener("uncaughtException", onUncaught);

    expect(caught.length).toBe(1);
    // The render failure, not the cleanup's.
    expect((caught[0] as Error).message).toBe("E1-onRender");
    // The later one is not silently dropped either -- it rides along as the cause.
    expect(((caught[0] as Error).cause as Error | undefined)?.message).toBe("E2-onLegendSelect");
    expect(restackCount).toBe(1);

    // Both established requirements still hold: the pin was restored on the fresh legend, and
    // suppressRestack was reset so a SECOND pin still restacks.
    expect(legendItem(container, "C")!.getAttribute("aria-pressed")).toBe("true");
    legendItem(container, "B")!.click();
    expect(restackCount).toBe(2);
    const order2 = [...container.querySelectorAll('g[aria-label="area"] path[data-series]')].map((p) =>
      p.getAttribute("data-series"),
    );
    expect(order2.slice(0, 2)).toEqual(["C", "B"]);
  });
});

// ---------------------------------------------------------------------------
// onRender — the deferred "mount" dispatch and a re-render that beats it
// ---------------------------------------------------------------------------
// The mount notification is queued on a microtask (see the onRender describe block above) closing
// over the svg it was built with. A host that changes a title selector SYNCHRONOUSLY after
// mountChart() returns reaches requestAccentRedraw first, so the observed order is
// reselect(current) then mount(the svg canvas.replaceChildren has already removed). Anything the
// consumer's mount handler does to that svg is invisible — a silent no-op in the one callback that
// exists to let a consumer decorate the chart it just mounted.
//
// Asserting only that the callback FIRED passes either way (it always fires; `disposed` is false).
// The assertion that distinguishes them is whether the mount handler's own DOM mutation is
// reachable from the container afterward.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Appends a `<rect data-render-phase="…">` to whatever svg the dispatch handed us. */
const markPhase = (ctx: { svg: SVGSVGElement; phase: string }): void => {
  const marker = ctx.svg.ownerDocument.createElementNS(SVG_NS, "rect");
  marker.setAttribute("data-render-phase", ctx.phase);
  ctx.svg.appendChild(marker);
};

/** Drive the inline title selector to its second option, synchronously (same tick). */
function pickSecondOption(container: HTMLElement): void {
  container.querySelector<HTMLButtonElement>("button.inline-select")!.click();
  container.querySelector<HTMLLIElement>('li[data-id="country"]')!.click();
}

const SELECTOR_SPEC: ChartSpec = {
  chartType: "line",
  title: "Real GDP by {dimension}",
  xAxisType: "temporal",
  data: "inline",
  title_selectors: {
    dimension: {
      options: [
        { id: "sector", label: "Sector" },
        { id: "country", label: "Country" },
      ],
      default: "sector",
    },
  },
} as unknown as ChartSpec;

const LINE_ROWS: TidyRow[] = [
  { time: "2024-01-01", series: "A", value: "1" },
  { time: "2024-02-01", series: "A", value: "2" },
];

describe("onRender — a synchronous re-render before the deferred mount dispatch", () => {
  it("standalone: the mount handler's DOM mutation is visible in the live chart, not on a detached svg", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, {
      spec: SELECTOR_SPEC,
      rows: LINE_ROWS,
      width: 720,
      height: 360,
      onRender: markPhase,
    });

    // Same tick as the mount: this reaches requestAccentRedraw -> draw(…, "reselect"), which
    // replaces the canvas' svg before the queued mount microtask runs.
    pickSecondOption(container);
    await flushMicrotasks();

    // The reselect dispatch is synchronous, so its marker is on the live svg either way — it is
    // the control, proving the interleaving really happened.
    expect(container.querySelector('svg [data-render-phase="reselect"]')).not.toBeNull();
    expect(container.querySelector('svg [data-render-phase="mount"]')).not.toBeNull();
  });

  it("small multiples: each pane's mount handler mutation is visible in the live panes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, {
      spec: {
        ...SELECTOR_SPEC,
        chartType: "bar",
        xAxisType: "categorical",
        columns: { x: "time", value: "value", facet: "pane" },
        small_multiples: { columns: 2, mode: "shared" },
      } as unknown as ChartSpec,
      rows: [
        { pane: "P1", time: "A", value: "1" },
        { pane: "P1", time: "B", value: "2" },
        { pane: "P2", time: "A", value: "3" },
        { pane: "P2", time: "B", value: "4" },
      ] as unknown as TidyRow[],
      width: 838,
      height: 420,
      onRender: markPhase,
    });

    pickSecondOption(container);
    await flushMicrotasks();

    expect(container.querySelectorAll('svg [data-render-phase="reselect"]').length).toBe(2);
    expect(container.querySelectorAll('svg [data-render-phase="mount"]').length).toBe(2);
  });
});
