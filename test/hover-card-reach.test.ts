// @vitest-environment jsdom
//
// WHICH CHART TYPES BUILD A FLOATING HOVER CARD AT DEFAULT SETTINGS — and therefore where
// `hooks.tooltip` can possibly fire.
//
// This file exists because the same defect shipped three times on this branch: a CONFIG-SPEC.md
// claim about "the hover tooltip" written from the standalone case, verified by a test that set a
// NON-DEFAULT dial to make the card appear (`coordinated_cursor: false`, or
// `barStack.hover: "tooltip"`), and then generalised to "standalone and faceted alike". EVERY case
// below therefore mounts at DEFAULT settings — no `small_multiples.coordinated_cursor`, no
// `barStack.hover`, no `chrome.*`. A case that needs a dial to produce a card is marked as such and
// asserts the DEFAULT outcome, with the dial only as a paired control.
//
// The two mechanisms that decide it (see crosshair.ts / spec/bar-stack.ts for the reasoning):
//   1. `emitOnly` — a coordinated small-multiples pane builds NO card (`const tip = emitOnly ? null
//      : getSharedTooltip(...)`, then `if (emitOnly) return;`). The secondary cursor draws the
//      in-place guide/dot/pill instead. Deliberate.
//   2. `resolveHoverMode` returns "pills" whenever `netMode == null`, i.e. for every plain/grouped
//      BAR and every WATERFALL, in any configuration — so those two never reach a card at all, even
//      standalone, and `barStack.hover` cannot talk them into one.
//
// `hooks.tooltip` is wired at the two `buildBandTooltipHtml` call sites (attachBandCrosshair,
// attachCategoricalLineCrosshair) and fires unconditionally whenever either builds a card — so the
// hook column below is exactly "a card was built here", never a separate forwarding question. The
// other card builders (attachCrosshair, attachHistogramHover, attachPointHover) do not call it, by
// documented design; they are asserted here so that stays a fact rather than an assumption.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import {
  mockRect1to1, mountHover as mount, cardShown, coordShown, hoverFirstMark,
  BAR_MARK as BAR, HIST_MARK as HIST, DOT_MARK, PLOT_MIDDLE,
} from "./helpers/hover-harness";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// The card is module-level singleton state (crosshair.ts's `activeTooltip`), reused across mounts
// while it stays attached to document.body — so card assertions are order-dependent unless the
// body is cleared between tests.
beforeEach(() => {
  document.body.innerHTML = "";
});


// ---------------------------------------------------------------------------
// Fixtures. Every spec here is DEFAULT apart from the fields that define the chart type; the
// faceted variants add only `columns.facet` + `small_multiples` (whose `coordinated_cursor`
// defaults to true, which is the whole point).
// ---------------------------------------------------------------------------

const sm = { small_multiples: { columns: 2, mode: "shared" } };
const facetCols = (extra: Record<string, string> = {}) => ({
  columns: { x: "time", value: "value", series: "series", facet: "pane", ...extra },
});

const spec = (s: Record<string, unknown>): ChartSpec =>
  ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;

const catRows = (series: Array<[string, number, number]>, pane?: string): TidyRow[] =>
  series.flatMap(([s, a, b]) => [
    { ...(pane ? { pane } : {}), time: "A", series: s, value: String(a) },
    { ...(pane ? { pane } : {}), time: "B", series: s, value: String(b) },
  ]) as unknown as TidyRow[];

const twoPane = (series: Array<[string, number, number]>): TidyRow[] => [
  ...catRows(series, "P1"),
  ...catRows(series.map(([s, a, b]) => [s, a / 2, b / 2] as [string, number, number]), "P2"),
];

const TEMPORAL_ROWS: TidyRow[] = ["2020-01-01", "2020-02-01", "2020-03-01"].flatMap((t, i) =>
  ["A", "B"].flatMap((s) => [
    { pane: "P1", time: t, series: s, value: String(3 + i) },
    { pane: "P2", time: t, series: s, value: String(5 + i) },
  ]),
) as unknown as TidyRow[];

const SCATTER_ROWS: TidyRow[] = [1, 2, 3, 4].flatMap((x) => [
  { pane: "P1", time: String(x), series: "A", value: String(x * 2) },
  { pane: "P2", time: String(x), series: "B", value: String(x * 3) },
]) as unknown as TidyRow[];

const scatterSpec = (faceted: boolean): ChartSpec =>
  spec({
    chartType: "scatter", xAxisType: "numeric", series_order: ["A", "B"],
    columns: { x: "time", value: "value", series: "series", ...(faceted ? { facet: "pane" } : {}) },
    ...(faceted ? { data: "d.csv", ...sm } : {}),
  });

/** Hover a single POINT. Scatter's hover is `attachPointHover`, which listens on the marker itself
 *  and adds no hit rect — so `hoverFirstMark` (which needs one) cannot reach it. */
function hoverPoint(svg: SVGSVGElement): void {
  svg.querySelector<SVGElement>(DOT_MARK)!.dispatchEvent(
    new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }),
  );
}

// ---------------------------------------------------------------------------
// No card in ANY configuration: plain/grouped bar and waterfall.
// ---------------------------------------------------------------------------

describe("no floating card exists in any configuration (hoverMode is always \"pills\")", () => {
  it("plain bar, standalone: no card, hooks.tooltip never fires", () => {
    const m = mount(spec({ chartType: "bar", xAxisType: "categorical" }), catRows([["S", 6, 4]]));
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("grouped bar, standalone: no card, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "bar", xAxisType: "categorical", series_order: ["Up", "Down"] }),
      catRows([["Up", 6, 5], ["Down", 4, 2]]),
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("plain bar, 2-pane: no card, hooks.tooltip never fires", () => {
    const m = mount(spec({ chartType: "bar", xAxisType: "categorical", data: "d.csv", ...facetCols(), ...sm }), twoPane([["S", 10, 20]]), true);
    expect(m.svgs.length).toBe(2);
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("waterfall, standalone: no card, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "waterfall", xAxisType: "categorical" }),
      [
        { time: "Start", series: "S", value: "10" },
        { time: "Up", series: "S", value: "5" },
        { time: "Down", series: "S", value: "-3" },
      ] as unknown as TidyRow[],
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("bar: even an explicit barStack.hover \"tooltip\" does NOT produce one (netMode == null)", () => {
    let calls = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, {
      spec: spec({ chartType: "bar", xAxisType: "categorical", barStack: { hover: "tooltip" } }),
      rows: catRows([["S", 6, 4]]),
      width: 720,
      height: 400,
      hooks: { tooltip: () => { calls++; return null; } },
    } as never);
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mockRect1to1(svg);
    hoverFirstMark(svg, BAR);
    expect(coordShown(svg)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stacked bar: the card is DATA-dependent (the net dot), not dial-dependent.
// ---------------------------------------------------------------------------

describe("stacked bar — a card only where the net dot is drawn", () => {
  it("all-positive, standalone: no card at defaults, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"] }),
      catRows([["Up", 6, 5], ["Down", 4, 2]]),
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("all-positive, 2-pane: no card at defaults, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["Up", 6, 5], ["Down", 4, 2]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("diverging (a negative value), standalone: card at defaults, hooks.tooltip fires", () => {
    const m = mount(
      spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"] }),
      catRows([["Up", 6, 5], ["Down", -4, -2]]),
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("diverging, 2-pane: card at defaults too — hover:tooltip beats coordination per pane", () => {
    const m = mount(
      spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["Up", 6, 5], ["Down", -4, -2]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Categorical-x line and dot plot: a card standalone, none in a coordinated pane.
// ---------------------------------------------------------------------------

describe("categorical-x line — card standalone, none in a default pane", () => {
  const rows = catRows([["A", 10, 20], ["B", 12, 22]]);

  it("standalone: card at defaults, hooks.tooltip fires", () => {
    const m = mount(spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"] }), rows);
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("2-pane: NO card at defaults, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["A", 10, 20], ["B", 12, 22]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });
});

describe("dot plot — card standalone, none in a default pane", () => {
  it("standalone: card at defaults, hooks.tooltip fires", () => {
    const m = mount(
      spec({ chartType: "dotplot", xAxisType: "categorical", series_order: ["A", "B"] }),
      catRows([["A", 10, 20], ["B", 12, 22]]),
    );
    hoverFirstMark(m.svgs[0]!, DOT_MARK);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("2-pane: NO card at defaults, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "dotplot", xAxisType: "categorical", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["A", 10, 20], ["B", 12, 22]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, DOT_MARK);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dumbbell: the one type that keeps its card in a coordinated pane, on purpose
// (render-live.ts's "NOT emitOnly" comment).
// ---------------------------------------------------------------------------

describe("dumbbell — card standalone AND in a default pane", () => {
  it("standalone: card at defaults, hooks.tooltip fires", () => {
    const m = mount(
      spec({ chartType: "dumbbell", xAxisType: "categorical", series_order: ["A", "B"] }),
      catRows([["A", 3, 4], ["B", 7, 9]]),
    );
    hoverFirstMark(m.svgs[0]!, DOT_MARK);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("2-pane: card at defaults, hooks.tooltip fires", () => {
    const m = mount(
      spec({ chartType: "dumbbell", xAxisType: "categorical", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["A", 3, 4], ["B", 7, 9]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, DOT_MARK);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// A faceted STACK that hovers with the card keeps the cross-pane band echo (issue #32) — the same
// split the dumbbell above has: the hovered pane draws its own card + highlight, the OTHER panes
// shade the same category. Before the fix, `coord = useCoord && !useTooltip` dropped the whole
// coordination for these panes, so a two-pane stack echoed nothing.
//
// The first case is at DEFAULT settings (a diverging stack's net dot makes `resolveHoverMode`
// return "tooltip" on its own). The `barStack.hover: "tooltip"` cases below are DIAL cases, marked
// as such per this file's rule, and paired with a no-dial control that must still get pills.
//
// What each pane draws is asserted by CLASS, not just by the group's opacity: `.tbl-coord-region`
// is the shaded band, `.tbl-coord-pill` the per-series value pill. The echo draws the first and
// never the second — a pill on a card pane would be the doubled read-out the tooltip mode exists
// to avoid.
// ---------------------------------------------------------------------------

describe("faceted stack with the hover card — card on the hovered pane, band echo on the others", () => {
  /** Hover the CENTRE of the first bar rect, in the pane's own user space. `hoverFirstMark` fixes
   *  clientY at the pane's mid-height, which resolves no category on a HORIZONTAL bar (categories
   *  are on Y there). Ancestor translates are accumulated because a faceted pane's marks can sit
   *  in a translated group. */
  const hoverBandCentre = (svg: SVGSVGElement): void => {
    const mark = svg.querySelector<SVGRectElement>(BAR)!;
    let dx = 0;
    let dy = 0;
    for (let el: Element | null = mark.parentElement; el && el !== svg; el = el.parentElement) {
      const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(el.getAttribute("transform") ?? "");
      if (m) { dx += +m[1]!; dy += +m[2]!; }
    }
    const cx = dx + parseFloat(mark.getAttribute("x")!) + parseFloat(mark.getAttribute("width")!) / 2;
    const cy = dy + parseFloat(mark.getAttribute("y")!) + parseFloat(mark.getAttribute("height")!) / 2;
    svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
      new PointerEvent("pointermove", { clientX: cx, clientY: cy, bubbles: true }),
    );
  };

  const leave = (svg: SVGSVGElement): void => {
    svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  };

  const stackSpec = (extra: Record<string, unknown> = {}): ChartSpec =>
    spec({
      chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"],
      data: "d.csv", ...facetCols(), ...sm, ...extra,
    });

  const count = (svg: SVGSVGElement, sel: string): number => svg.querySelectorAll(`g.tbl-coord ${sel}`).length;

  it("diverging 2-pane at DEFAULTS: card on pane 0, echo region on pane 1, no pills anywhere", () => {
    const m = mount(stackSpec(), twoPane([["Up", 6, 5], ["Down", -4, -2]]), true);
    expect(m.svgs.length).toBe(2);
    hoverBandCentre(m.svgs[0]!);

    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
    // The other pane shades the same category...
    expect(coordShown(m.svgs[1]!)).toBe(true);
    expect(count(m.svgs[1]!, ".tbl-coord-region")).toBe(1);
    // ...and the hovered pane's coordinated group stays blank: its own primary crosshair already
    // draws the highlight rect, so a second shade would read as a darker band on that pane alone.
    expect(coordShown(m.svgs[0]!)).toBe(false);
    expect(count(m.svgs[0]!, "rect")).toBe(0);
    // 0.12 is `showHighlight`'s shown state (0 is hidden) — proof the shade the echo skips here is
    // the one the primary crosshair drew, not a missing one.
    expect(m.svgs[0]!.querySelector<SVGElement>(".tbl-band-crosshair-hl")!.getAttribute("opacity")).toBe("0.12");
    // No value pills on either pane — the card is the read-out.
    for (const svg of m.svgs) expect(count(svg, ".tbl-coord-pill")).toBe(0);
  });

  it("DIAL barStack.hover \"tooltip\" on an all-positive stack: same split", () => {
    const m = mount(
      stackSpec({ barStack: { hover: "tooltip", netDisplay: "none" } }),
      twoPane([["Up", 6, 5], ["Down", 4, 2]]),
      true,
    );
    hoverBandCentre(m.svgs[0]!);

    expect(cardShown()).toBe(true);
    expect(coordShown(m.svgs[1]!)).toBe(true);
    expect(count(m.svgs[1]!, ".tbl-coord-region")).toBe(1);
    expect(coordShown(m.svgs[0]!)).toBe(false);
    for (const svg of m.svgs) expect(count(svg, ".tbl-coord-pill")).toBe(0);
  });

  it("DIAL, horizontal orientation: the echoed pane shades the category ROW", () => {
    const m = mount(
      stackSpec({ orientation: "horizontal", barStack: { hover: "tooltip", netDisplay: "none" } }),
      twoPane([["Up", 6, 5], ["Down", 4, 2]]),
      true,
    );
    hoverBandCentre(m.svgs[0]!);

    expect(cardShown()).toBe(true);
    expect(coordShown(m.svgs[1]!)).toBe(true);
    expect(count(m.svgs[1]!, ".tbl-coord-region")).toBe(1);
    expect(coordShown(m.svgs[0]!)).toBe(false);
    for (const svg of m.svgs) expect(count(svg, ".tbl-coord-pill")).toBe(0);
  });

  it("DIAL: pointer-leave clears the echo on the other pane", () => {
    const m = mount(
      stackSpec({ barStack: { hover: "tooltip", netDisplay: "none" } }),
      twoPane([["Up", 6, 5], ["Down", 4, 2]]),
      true,
    );
    hoverBandCentre(m.svgs[0]!);
    expect(coordShown(m.svgs[1]!)).toBe(true);
    leave(m.svgs[0]!);
    expect(coordShown(m.svgs[1]!)).toBe(false);
    expect(count(m.svgs[1]!, "rect")).toBe(0);
  });

  // The two halves answer to their own switches — the CONFIG-SPEC sentences that say so are only as
  // true as these two cases.
  it("DIAL + coordinated_cursor: false — the card survives, the echo does not", () => {
    const m = mount(
      stackSpec({
        barStack: { hover: "tooltip", netDisplay: "none" },
        small_multiples: { columns: 2, mode: "shared", coordinated_cursor: false },
      }),
      twoPane([["Up", 6, 5], ["Down", 4, 2]]),
      true,
    );
    hoverBandCentre(m.svgs[0]!);

    expect(cardShown()).toBe(true);
    // No secondary cursor was attached at all, so there is no group to be blank.
    for (const svg of m.svgs) expect(svg.querySelector("g.tbl-coord")).toBeNull();
  });

  it("DIAL + chrome.tooltip: false — the echo survives, the card does not", () => {
    const m = mount(
      stackSpec({ barStack: { hover: "tooltip", netDisplay: "none" }, chrome: { tooltip: false } }),
      twoPane([["Up", 6, 5], ["Down", 4, 2]]),
      true,
    );
    hoverBandCentre(m.svgs[0]!);

    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
    // `onResolve` runs ahead of the card, so hit-testing and the echo are untouched by the switch.
    expect(coordShown(m.svgs[1]!)).toBe(true);
    expect(count(m.svgs[1]!, ".tbl-coord-region")).toBe(1);
    expect(m.svgs[0]!.querySelector<SVGElement>(".tbl-band-crosshair-hl")!.getAttribute("opacity")).toBe("0.12");
  });

  // The paired control for the two DIAL cases: without the tooltip hover mode, a 2-pane stack is
  // still the pills figure it always was — the echo carries the numbers instead of a card. Asserted
  // by the same pill class, so "no pills" above cannot pass because the selector stopped matching.
  it("no-dial control: an all-positive 2-pane stack still gets pills on BOTH panes and no card", () => {
    const m = mount(stackSpec(), twoPane([["Up", 6, 5], ["Down", 4, 2]]), true);
    hoverBandCentre(m.svgs[0]!);

    expect(cardShown()).toBe(false);
    for (const svg of m.svgs) {
      expect(coordShown(svg)).toBe(true);
      expect(count(svg, ".tbl-coord-pill")).toBeGreaterThan(0);
    }
  });

  // The LEGEND-highlight pills (`.tbl-hl-pills`, a legend gesture) are a different renderer from
  // the cursor's `.tbl-coord-pill` above, and the figure bus suppresses the hovered category in
  // them (`emit` → `setSuppressedCategory`) so they don't double up with the cursor's own pill.
  // In tooltip mode the cursor draws NO pill to double up with, so there is nothing to suppress:
  // the standalone chart in the same mode passes no `onResolve` at all and never suppresses
  // ("Legend-highlight pills stay in BOTH modes", render-live.ts's mountChart branch). Before the
  // fix, giving these panes an `onResolve` reached the suppression for the first time and made a
  // pinned series' pill vanish from the hovered category on every pane, replaced by nothing.
  const hlTexts = (svg: SVGSVGElement): string[] =>
    Array.from(svg.querySelectorAll("g.tbl-hl-pills text")).map((t) => t.textContent ?? "");
  const pinSeries = (m: { container: HTMLElement }, series: string): void => {
    m.container
      .querySelector<HTMLElement>(`.tbl-legend-item[data-series="${series}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };

  it("DEFAULTS + a pinned legend series: the hover leaves the pinned pills alone on BOTH panes", () => {
    const m = mount(stackSpec(), twoPane([["Up", 6, 5], ["Down", -4, -2]]), true);
    pinSeries(m, "Up");
    // One pill per category, on every pane — the pinned state, before any band hover.
    const before = m.svgs.map(hlTexts);
    for (const t of before) expect(t.length).toBe(2);

    hoverBandCentre(m.svgs[0]!);

    expect(cardShown()).toBe(true);
    expect(coordShown(m.svgs[1]!)).toBe(true);
    // The sibling keeps the pinned series' value for the hovered category: the echo is a shade
    // with no numbers, so suppressing the only read-out there would lose it outright.
    expect(hlTexts(m.svgs[1]!)).toEqual(before[1]!);
    // And so does the hovered pane, matching the standalone chart in this mode. The card is an
    // additional read-out, not a replacement drawn in the pill's place.
    expect(hlTexts(m.svgs[0]!)).toEqual(before[0]!);
  });

  // The paired control: in the PILLS mode the suppression is still wanted and still happens —
  // proof the fix is scoped to the card panes and did not disable the mechanism figure-wide.
  it("no-dial control: the pills mode still suppresses the hovered category's pinned pill", () => {
    const m = mount(stackSpec(), twoPane([["Up", 6, 5], ["Down", 4, 2]]), true);
    pinSeries(m, "Up");
    for (const svg of m.svgs) expect(hlTexts(svg).length).toBe(2);

    hoverBandCentre(m.svgs[0]!);

    // The cursor's own pill takes the suppressed one's place, on every pane.
    for (const svg of m.svgs) {
      expect(hlTexts(svg).length).toBe(1);
      expect(count(svg, ".tbl-coord-pill")).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Card builders that do NOT call hooks.tooltip, by documented design. Asserted so the
// CONFIG-SPEC carve-out stays a fact.
// ---------------------------------------------------------------------------

describe("card builders outside hooks.tooltip's two call sites", () => {
  it("temporal line, standalone: card at defaults but hooks.tooltip never fires", () => {
    const m = mount(spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"] }), TEMPORAL_ROWS);
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBe(0);
  });

  it("temporal line, 2-pane: no card at defaults either", () => {
    const m = mount(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      TEMPORAL_ROWS,
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("area, standalone: card at defaults but hooks.tooltip never fires", () => {
    const m = mount(spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"] }), TEMPORAL_ROWS);
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBe(0);
  });

  it("area, 2-pane: no card at defaults", () => {
    const m = mount(
      spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      TEMPORAL_ROWS,
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("histogram, standalone: card at defaults but hooks.tooltip never fires", () => {
    const rows: TidyRow[] = [];
    for (let v = 0; v < 16; v++) rows.push({ amount: String(v) } as unknown as TidyRow);
    const m = mount(
      spec({ chartType: "histogram", xAxisType: "numeric", histogram: { bins: 4, domain: [0, 20] }, columns: { x: "amount" } }),
      rows,
    );
    hoverFirstMark(m.svgs[0]!, HIST);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBe(0);
  });

  it("scatter, standalone: card at defaults but hooks.tooltip never fires", () => {
    const m = mount(scatterSpec(false), SCATTER_ROWS);
    hoverPoint(m.svgs[0]!);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBe(0);
  });

  // The one row of the CONFIG-SPEC table where "never" holds on BOTH sides for the same reason:
  // `attachPointHover` is never emitOnly, so a scatter pane keeps its card — and its builder is
  // still not one of the two `buildBandTooltipHtml` call sites, so the hook still never fires.
  it("scatter, 2-pane: card at defaults too, and hooks.tooltip still never fires", () => {
    const m = mount(scatterSpec(true), SCATTER_ROWS, true);
    expect(m.svgs.length).toBe(2);
    hoverPoint(m.svgs[0]!);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBe(0);
  });

  it("histogram, 2-pane: no card at defaults", () => {
    const rows: TidyRow[] = [];
    for (const pane of ["P1", "P2"]) for (let v = 0; v < 16; v++) rows.push({ pane, amount: String(v) } as unknown as TidyRow);
    const m = mount(
      spec({ chartType: "histogram", xAxisType: "numeric", data: "d.csv", histogram: { bins: 4, domain: [0, 20] }, columns: { x: "amount", facet: "pane" }, ...sm }),
      rows,
      true,
    );
    hoverFirstMark(m.svgs[0]!, HIST);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });
});
