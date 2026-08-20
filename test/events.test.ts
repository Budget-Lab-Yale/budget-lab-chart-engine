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
});
