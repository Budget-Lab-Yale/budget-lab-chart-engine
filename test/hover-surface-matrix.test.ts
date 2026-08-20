// @vitest-environment jsdom
//
// THE HOVER SURFACE, MEASURED. Every chart type × {standalone, 2-pane}, at genuine defaults.
//
// Two tables, both at defaults: `EXPECTED` — what the pane UNDER THE CURSOR shows; `SIBLING_ECHO`
// — what a 2-pane figure's OTHER pane echoes, which is what the coordinated cursor exists for and
// what a claim about it is actually about.
//
// WHAT THIS FILE IS FOR
// --------------------
// This is the gate for every documented hover promise. `CONFIG-SPEC.md` is vendored verbatim by
// `budget-lab-charts` and gated in its CI, so a statement in it that the code does not honour is a
// defect shipped to figure authors. **Before writing a CONFIG-SPEC claim about hover behaviour,
// check it against the matrix below.** If the matrix does not say what you are about to write, the
// claim is not yet true — narrow it, or measure the case first.
//
// A cell that changes here means one of exactly two things, and the diff must say which:
//   1. a real behaviour change (fine, if intended — and then every claim keyed to that cell needs
//      re-reading), or
//   2. a claim that needs re-narrowing (the cell was always this and a doc said otherwise).
//
// WHY IT IS A MATRIX AND NOT A LIST OF CLAIMS
// -------------------------------------------
// Nine false hover claims were found in CONFIG-SPEC.md on this branch, one probe at a time. Two
// earlier defences were not enough:
//   - "every claim must be test-backed" was already in force. The `overlays[].tooltip`
//     small-multiples claim WAS test-backed — by a test that set `coordinated_cursor: false`, a
//     non-default path. It shipped false anyway. Hence: **defaults only** in the matrix below.
//   - per-claim tests (`hover-card-reach.test.ts`, `hover-claims-defaults.test.ts`) cover the
//     claims that were FOUND. A new field with the same over-claim would still ship, because a
//     per-claim test cannot catch an unasked question. Hence: this file asserts what the surface
//     IS, cell by cell, so a future claim can be checked against it without anyone having thought
//     to ask about that field.
// The `card` column therefore overlaps `hover-card-reach.test.ts` on purpose: the matrix has to be
// readable as one artifact, and a matrix missing its most-cited column would not be. Per-claim
// assertions (including the two deliberate `GAP` markers for the released `x_labels` /
// `tooltip_x_format` gaps) stay in those files; nothing here weakens them.
//
// WHY THE EXPECTED VALUES ARE INLINE AND NOT A SNAPSHOT
// ----------------------------------------------------
// A snapshot file re-recordable with a flag would reproduce exactly the failure mode this is meant
// to end. The expected matrix is a literal table below: a behaviour change shows up as an edited
// table row in the diff, which someone has to consciously approve.
//
// THE TWO MECHANISMS THAT DECIDE THE `card` COLUMN (see crosshair.ts, spec/bar-stack.ts):
//   1. `emitOnly` — a coordinated small-multiples pane builds no card (`const tip = emitOnly ? null
//      : getSharedTooltip(...)`, then `if (emitOnly) return;`). The secondary cursor draws an
//      in-place guide/dot/pill/band echo instead. `coordinated_cursor` defaults to ON, so this is
//      the default for a multi-pane figure. Everything wired BELOW that `return` is invisible on a
//      default multi-pane figure; `onHover`, ten lines above it, fires either way — which is how
//      nine claims came to describe the wrong side of one early return.
//   2. `resolveHoverMode` returns "pills" whenever `netMode == null` — every plain/grouped bar and
//      every waterfall, in any configuration. Those never reach a card, standalone or not, and
//      `barStack.hover` cannot talk them into one.
// A stacked bar's card is therefore DATA-dependent, not dial-dependent: it appears only where the
// net dot is drawn, i.e. where the stack has a genuine negative. Both stacked variants are below.
//
// WHAT JSDOM CAN AND CANNOT MEASURE HERE (read before trusting a cell)
// -------------------------------------------------------------------
// Faithful without layout: `card`, `cardRows`, `pills`, `guide`, `dot`, `region`. The card is real
// DOM; the coordinated cursor's guide/dot/pill/region come from `readLinearScale` (plot-scale.ts),
// which reads Plot's own scale accessor and returns plain numbers — no layout involved.
//
// `axisLabel` is the one column with a caveat, and it is a PRECONDITION caveat, not a fabricated
// result. `makeAxisRows` locates the x-axis tick-label rows via `getBoundingClientRect`, which is
// 0×0 for every SVG element in bare jsdom; the shared harness mocks text/circle rects from the
// elements' own coords so that precondition holds, exactly as it holds in a browser where tick
// labels have real width. So `axisLabel: true` means "the code drew an echo for the axis rows it
// found", which is the browser outcome too. NOT measured here, and not to be claimed from this
// file: the echo's GEOMETRY and layout mode (`detectBandLabelMode`'s single / wrap / rotate), which
// need real text metrics; and the documented carve-out that a line/area pane spanning less than a
// month draws no ticks and therefore no echo — every temporal row below is month-spaced, so it
// exercises the tick-bearing case only.
import { describe, it, expect, beforeEach } from "vitest";
import {
  mountHover, cardShown, hoverFirstMark,
  BAR_MARK, HIST_MARK, DOT_MARK, PLOT_MIDDLE,
} from "./helpers/hover-harness";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// The card is module-level singleton state (crosshair.ts's `activeTooltip`), reused across mounts
// while it stays attached to document.body — so card assertions are order-dependent unless the
// body is cleared between cells.
beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// What a cell records: what a READER SEES, derived from real DOM classes, never from an internal
// flag. `region` is the shaded band/column echo (`tbl-coord-region`) — the substitute a bar-like
// pane draws where a line pane draws a guide, so it belongs beside `guide` rather than being
// folded into it.
// ---------------------------------------------------------------------------

type Cell = {
  /** A floating tooltip CARD is shown (`.tbl-tooltip` at opacity 1). */
  card: boolean;
  /** The card's row labels, in order, colon stripped. `[]` when no card. */
  cardRows: string[];
  /** Value pills — `.tbl-coord-pill` inside a shown coordinated-cursor group. */
  pills: boolean;
  /** The thin vertical guide line — `.tbl-coord-guide`. */
  guide: boolean;
  /** The per-series highlight ring on the point — `.tbl-coord-dot`. */
  dot: boolean;
  /** The shaded band / column echo — `.tbl-coord-region`. */
  region: boolean;
  /** The hovered x value echoed onto the axis — `.tbl-coord-axis-label` (see the jsdom note above). */
  axisLabel: boolean;
};

/** Only counts what is VISIBLE: the group is created up front and hidden at opacity 0, so presence
 *  alone is not enough. */
function drawn(svg: SVGSVGElement, sel: string): boolean {
  const g = svg.querySelector("g.tbl-coord");
  if (!g || g.getAttribute("opacity") !== "1") return false;
  return g.querySelectorAll(sel).length > 0;
}

function cardRowLabels(): string[] {
  if (!cardShown()) return [];
  const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
  return Array.from(tip.querySelectorAll(".tbl-tooltip-row .tbl-tooltip-label"))
    .map((e) => (e.textContent ?? "").replace(/:$/, ""));
}

function observe(svg: SVGSVGElement): Cell {
  return {
    card: cardShown(),
    cardRows: cardRowLabels(),
    pills: drawn(svg, ".tbl-coord-pill"),
    guide: drawn(svg, ".tbl-coord-guide"),
    dot: drawn(svg, ".tbl-coord-dot"),
    region: drawn(svg, ".tbl-coord-region"),
    axisLabel: drawn(svg, ".tbl-coord-axis-label"),
  };
}

// ---------------------------------------------------------------------------
// Fixtures. DEFAULTS ONLY. Every spec below sets nothing but the fields that DEFINE its chart type
// and, for the 2-pane variant, `columns.facet` + `small_multiples` — whose `coordinated_cursor`
// defaults to true, which is the whole point. No `coordinated_cursor`, no `barStack.*`, no
// `chrome.*`, no `valueLabels`. If you add a field here you have broken the file's premise.
// ---------------------------------------------------------------------------

const sm = { small_multiples: { columns: 2, mode: "shared" } };
const FACET_COLS = { columns: { x: "time", value: "value", series: "series", facet: "pane" } };
const spec = (s: Record<string, unknown>): ChartSpec =>
  ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;
/** The 2-pane suffix every categorical/temporal fixture shares. */
const paned = (f: boolean) => (f ? { data: "d.csv", ...FACET_COLS, ...sm } : {});

const catRows = (series: Array<[string, number, number]>, pane?: string): TidyRow[] =>
  series.flatMap(([s, a, b]) => [
    { ...(pane ? { pane } : {}), time: "A", series: s, value: String(a) },
    { ...(pane ? { pane } : {}), time: "B", series: s, value: String(b) },
  ]) as unknown as TidyRow[];

const twoPane = (series: Array<[string, number, number]>): TidyRow[] => [
  ...catRows(series, "P1"),
  ...catRows(series.map(([s, a, b]) => [s, a / 2, b / 2] as [string, number, number]), "P2"),
];

const cat = (f: boolean, series: Array<[string, number, number]>): TidyRow[] =>
  f ? twoPane(series) : catRows(series);

/** Month-spaced on purpose: the temporal axis ticks on whole months, and a pane spanning less than
 *  one draws no ticks — and then no axis-label echo either (see the jsdom note above). */
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

const histRows = (f: boolean): TidyRow[] => {
  const out: TidyRow[] = [];
  for (const pane of f ? ["P1", "P2"] : [undefined]) {
    for (let v = 0; v < 16; v++) out.push({ ...(pane ? { pane } : {}), amount: String(v) } as unknown as TidyRow);
  }
  return out;
};

/** A waterfall carries a `kind` column (total / delta / skip) — that is its production shape, and
 *  it is what splits the two waterfall rows below: a delta step gets a signed value pill, a
 *  total/skip step shades only (its number is the always-on running-total label).
 *
 *  NOTE, and it is why there is no `series` column here: `buildRectsByCategory` reads each bar's
 *  `data-series`, which the waterfall's tagging layer stamps as "" — so a waterfall whose data
 *  happens to carry a `series` column keys its pills against a name no bar has and shows NO value
 *  pill at all. Do not "tidy" a series column into this fixture; it silently changes the row. */
const wfRows = (f: boolean): TidyRow[] =>
  (f ? ["P1", "P2"] : [""]).flatMap((p) =>
    [["Start", "10", "total"], ["Up", "5", "delta"], ["Down", "-3", "delta"]].map(([t, v, k]) => ({
      ...(p ? { pane: p } : {}), time: t, value: v, kind: k,
    })),
  ) as unknown as TidyRow[];

const wfSpec = (f: boolean) =>
  spec({
    chartType: "waterfall", xAxisType: "categorical",
    columns: { x: "time", value: "value", kind: "kind", ...(f ? { facet: "pane" } : {}) },
    ...(f ? { data: "d.csv", ...sm } : {}),
  });

// ---------------------------------------------------------------------------
// Hovering. Three mechanisms, because the engine attaches three kinds of hit target: a band/plot
// hit rect (most types), and per-point listeners on the markers themselves (scatter, via
// `attachPointHover` — it adds no hit rect, so `hoverFirstMark` cannot reach it).
// ---------------------------------------------------------------------------

/** Hover the nth mark's horizontal centre through the band hit rect. */
function hoverNthBand(svg: SVGSVGElement, markSel: string, n: number): void {
  const vb = svg.viewBox.baseVal;
  const mark = Array.from(svg.querySelectorAll<SVGGraphicsElement>(markSel))[n]!;
  const cx = parseFloat(mark.getAttribute("x")!) + parseFloat(mark.getAttribute("width") ?? "0") / 2;
  svg.querySelector(".tbl-band-crosshair-hit")!.dispatchEvent(
    new PointerEvent("pointermove", { clientX: cx, clientY: vb.height / 2, bubbles: true }),
  );
}

/** Hover a single POINT — `attachPointHover` listens on the marker element, not a hit rect. */
function hoverPoint(svg: SVGSVGElement, markSel: string): void {
  svg.querySelector<SVGElement>(markSel)!.dispatchEvent(
    new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }),
  );
}

type Mount = { spec: ChartSpec; rows: TidyRow[]; hover: (svg: SVGSVGElement) => void };

const TYPES: Array<{ name: string; mount: (f: boolean) => Mount }> = [
  {
    name: "bar (plain)",
    mount: (f) => ({
      spec: spec({ chartType: "bar", xAxisType: "categorical", ...paned(f) }),
      rows: cat(f, [["S", 6, 4]]),
      hover: (svg) => hoverFirstMark(svg, BAR_MARK),
    }),
  },
  {
    name: "bar (grouped)",
    mount: (f) => ({
      spec: spec({ chartType: "bar", xAxisType: "categorical", series_order: ["Up", "Down"], ...paned(f) }),
      rows: cat(f, [["Up", 6, 5], ["Down", 4, 2]]),
      hover: (svg) => hoverFirstMark(svg, BAR_MARK),
    }),
  },
  {
    name: "waterfall (total step)",
    mount: (f) => ({ spec: wfSpec(f), rows: wfRows(f), hover: (svg) => hoverNthBand(svg, BAR_MARK, 0) }),
  },
  {
    name: "waterfall (delta step)",
    mount: (f) => ({ spec: wfSpec(f), rows: wfRows(f), hover: (svg) => hoverNthBand(svg, BAR_MARK, 1) }),
  },
  {
    name: "stacked (all positive)",
    mount: (f) => ({
      spec: spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], ...paned(f) }),
      rows: cat(f, [["Up", 6, 5], ["Down", 4, 2]]),
      hover: (svg) => hoverFirstMark(svg, BAR_MARK),
    }),
  },
  {
    name: "stacked (with a negative)",
    mount: (f) => ({
      spec: spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], ...paned(f) }),
      rows: cat(f, [["Up", 6, 5], ["Down", -4, -2]]),
      hover: (svg) => hoverFirstMark(svg, BAR_MARK),
    }),
  },
  {
    name: "line (categorical x)",
    mount: (f) => ({
      spec: spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"], ...paned(f) }),
      rows: cat(f, [["A", 10, 20], ["B", 12, 22]]),
      hover: (svg) => hoverFirstMark(svg, PLOT_MIDDLE),
    }),
  },
  {
    name: "dotplot",
    mount: (f) => ({
      spec: spec({ chartType: "dotplot", xAxisType: "categorical", series_order: ["A", "B"], ...paned(f) }),
      rows: cat(f, [["A", 10, 20], ["B", 12, 22]]),
      hover: (svg) => hoverFirstMark(svg, DOT_MARK),
    }),
  },
  {
    name: "dumbbell",
    mount: (f) => ({
      spec: spec({ chartType: "dumbbell", xAxisType: "categorical", series_order: ["A", "B"], ...paned(f) }),
      rows: cat(f, [["A", 3, 4], ["B", 7, 9]]),
      hover: (svg) => hoverFirstMark(svg, DOT_MARK),
    }),
  },
  {
    name: "line (temporal)",
    mount: (f) => ({
      spec: spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], ...paned(f) }),
      rows: TEMPORAL_ROWS,
      hover: (svg) => hoverFirstMark(svg, PLOT_MIDDLE),
    }),
  },
  {
    name: "area (temporal)",
    mount: (f) => ({
      spec: spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"], ...paned(f) }),
      rows: TEMPORAL_ROWS,
      hover: (svg) => hoverFirstMark(svg, PLOT_MIDDLE),
    }),
  },
  {
    name: "histogram",
    mount: (f) => ({
      spec: spec({
        chartType: "histogram", xAxisType: "numeric", histogram: { bins: 4, domain: [0, 20] },
        columns: { x: "amount", ...(f ? { facet: "pane" } : {}) },
        ...(f ? { data: "d.csv", ...sm } : {}),
      }),
      rows: histRows(f),
      hover: (svg) => hoverFirstMark(svg, HIST_MARK),
    }),
  },
  {
    name: "scatter",
    mount: (f) => ({
      spec: spec({
        chartType: "scatter", xAxisType: "numeric", series_order: ["A", "B"],
        columns: { x: "time", value: "value", series: "series", ...(f ? { facet: "pane" } : {}) },
        ...(f ? { data: "d.csv", ...sm } : {}),
      }),
      rows: SCATTER_ROWS,
      hover: (svg) => hoverPoint(svg, DOT_MARK),
    }),
  },
];

// ===========================================================================
// THE MATRIX. Measured 2026-08-20 against aa84548. Edit a row here only with a behaviour change
// you meant, and re-read every CONFIG-SPEC claim keyed to it in the same commit.
//
//                                            card    cardRows                      pills  guide  dot    region axisLabel
// ---------------------------------------------------------------------------------------------------------------------
const EXPECTED: Record<string, Cell> = {
  // Plain/grouped bar and waterfall: NO card in any configuration (`resolveHoverMode` → "pills").
  "bar (plain) · standalone":             { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  "bar (plain) · 2-pane":                 { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  "bar (grouped) · standalone":           { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  "bar (grouped) · 2-pane":               { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  // Waterfall: pill on a DELTA step only; a total/skip step shades without a number.
  "waterfall (total step) · standalone":  { card: false, cardRows: [],                        pills: false, guide: false, dot: false, region: true,  axisLabel: true  },
  "waterfall (total step) · 2-pane":      { card: false, cardRows: [],                        pills: false, guide: false, dot: false, region: true,  axisLabel: true  },
  "waterfall (delta step) · standalone":  { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  "waterfall (delta step) · 2-pane":      { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  // Stacked: DATA-dependent. No net dot → pills; a genuine negative → a card, faceted or not.
  "stacked (all positive) · standalone":  { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  "stacked (all positive) · 2-pane":      { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  "stacked (with a negative) · standalone": { card: true, cardRows: ["Up", "Down", "Total"],  pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "stacked (with a negative) · 2-pane":   { card: true,  cardRows: ["Up", "Down", "Total"],   pills: false, guide: false, dot: false, region: false, axisLabel: false },
  // Categorical-x line and dot plot: a card standalone, replaced by the in-place echo in a pane.
  // The two panes differ in their echo — the line pane draws a GUIDE, the dot pane shades the BAND.
  "line (categorical x) · standalone":    { card: true,  cardRows: ["A", "B"],                pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "line (categorical x) · 2-pane":        { card: false, cardRows: [],                        pills: true,  guide: true,  dot: true,  region: false, axisLabel: true  },
  "dotplot · standalone":                 { card: true,  cardRows: ["A", "B"],                pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "dotplot · 2-pane":                     { card: false, cardRows: [],                        pills: true,  guide: false, dot: true,  region: true,  axisLabel: true  },
  // Dumbbell: the one type that keeps its card in a default pane (render-live's "NOT emitOnly"),
  // so its coordinated cursor is a pure cross-pane band echo with no pills of its own.
  "dumbbell · standalone":                { card: true,  cardRows: ["A", "B"],                pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "dumbbell · 2-pane":                    { card: true,  cardRows: ["A", "B"],                pills: false, guide: false, dot: false, region: false, axisLabel: false },
  // Temporal line / area / histogram: a card standalone, none in a default pane. (These card
  // builders do not call hooks.tooltip — that carve-out is pinned in hover-card-reach.test.ts.)
  "line (temporal) · standalone":         { card: true,  cardRows: ["A", "B"],                pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "line (temporal) · 2-pane":             { card: false, cardRows: [],                        pills: true,  guide: true,  dot: true,  region: false, axisLabel: true  },
  "area (temporal) · standalone":         { card: true,  cardRows: ["A", "B", "Total"],       pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "area (temporal) · 2-pane":             { card: false, cardRows: [],                        pills: true,  guide: true,  dot: true,  region: false, axisLabel: true  },
  // Histogram's single row is labelled by its SERIES, and a single-series histogram has no series
  // name — so the row reads ": 5.00". Recorded as measured, not as it ought to look.
  "histogram · standalone":               { card: true,  cardRows: [""],                      pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "histogram · 2-pane":                   { card: false, cardRows: [],                        pills: true,  guide: false, dot: false, region: true,  axisLabel: true  },
  // Scatter: per-POINT hover (`attachPointHover`), never emitOnly — a card in both, and no
  // coordinated cursor in either. Its rows are the axis titles, not series names.
  "scatter · standalone":                 { card: true,  cardRows: ["x", "Value"],            pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "scatter · 2-pane":                     { card: true,  cardRows: ["x", "Value"],            pills: false, guide: false, dot: false, region: false, axisLabel: false },
};
// ===========================================================================

describe("the hover surface at defaults — every chart type, standalone and 2-pane", () => {
  for (const t of TYPES) {
    for (const faceted of [false, true]) {
      const key = `${t.name} · ${faceted ? "2-pane" : "standalone"}`;
      it(key, () => {
        const { spec: s, rows, hover } = t.mount(faceted);
        const m = mountHover(s, rows, faceted);
        expect(m.svgs.length, `${key}: expected ${faceted ? 2 : 1} pane(s)`).toBe(faceted ? 2 : 1);
        hover(m.svgs[0]!);
        // One assertion per cell, so a behaviour change reports as a whole edited row.
        expect(observe(m.svgs[0]!), key).toEqual(EXPECTED[key]);
      });
    }
  }

  it("the matrix has no stale rows — every EXPECTED key is a cell that is actually mounted", () => {
    const mounted = TYPES.flatMap((t) => [`${t.name} · standalone`, `${t.name} · 2-pane`]);
    expect(Object.keys(EXPECTED).sort()).toEqual(mounted.sort());
  });

  it("every cell shows SOMETHING — a hover that resolved nothing must not read as 'no feature'", () => {
    // The failure mode this guards: a cell recorded as all-false because the hover never landed on
    // a mark (a fixture problem) rather than because the engine draws nothing (a behaviour fact).
    for (const [key, cell] of Object.entries(EXPECTED)) {
      const any = cell.card || cell.pills || cell.guide || cell.dot || cell.region || cell.axisLabel;
      expect(any, `${key}: every column is false, so this cell measures nothing`).toBe(true);
    }
  });
});

// ===========================================================================
// THE SAME DEFAULTS, MEASURED ON THE PANE THAT IS *NOT* UNDER THE CURSOR.
//
// Still the default matrix — no dial is set here either. It is a second table because the
// coordinated cursor exists FOR these panes: a claim about "the coordinated cursor" is a claim
// about what a sibling pane echoes, which the table above cannot answer at all.
//
// `card` / `cardRows` are ABSENT from this table on purpose, not overlooked. The floating card is
// one document-level singleton (`activeTooltip`, positioned at the pointer), so querying it "for
// pane 2" returns the same element as pane 1 — a per-pane card column would be a knowingly wrong
// cell, and this file would rather have a gap than a cell someone can cite.
// ===========================================================================

type PaneEcho = Pick<Cell, "pills" | "guide" | "dot" | "region" | "axisLabel">;

const paneEcho = (svg: SVGSVGElement): PaneEcho => {
  const { pills, guide, dot, region, axisLabel } = observe(svg);
  return { pills, guide, dot, region, axisLabel };
};

//                                        pills  guide  dot    region axisLabel
// -----------------------------------------------------------------------------
const SIBLING_ECHO: Record<string, PaneEcho> = {
  "bar (plain)":              { pills: true,  guide: false, dot: false, region: true,  axisLabel: false },
  "bar (grouped)":            { pills: true,  guide: false, dot: false, region: true,  axisLabel: false },
  "waterfall (total step)":   { pills: false, guide: false, dot: false, region: true,  axisLabel: false },
  "waterfall (delta step)":   { pills: true,  guide: false, dot: false, region: true,  axisLabel: false },
  "stacked (all positive)":   { pills: true,  guide: false, dot: false, region: true,  axisLabel: false },
  // A net-dot stack hovers with the card, which is not coordinated — so a sibling pane echoes
  // NOTHING. The one default multi-pane configuration where the other panes go dark on hover.
  "stacked (with a negative)": { pills: false, guide: false, dot: false, region: false, axisLabel: false },
  "line (categorical x)":     { pills: true,  guide: true,  dot: true,  region: false, axisLabel: false },
  "dotplot":                  { pills: true,  guide: false, dot: true,  region: true,  axisLabel: false },
  // Dumbbell keeps its per-pane card AND coordinates: the sibling echo is a pure band shade, with
  // no pills and no dot. This is the row the hovered-pane table above cannot show.
  "dumbbell":                 { pills: false, guide: false, dot: false, region: true,  axisLabel: false },
  "line (temporal)":          { pills: true,  guide: true,  dot: true,  region: false, axisLabel: false },
  "area (temporal)":          { pills: true,  guide: true,  dot: true,  region: false, axisLabel: false },
  "histogram":                { pills: true,  guide: false, dot: false, region: true,  axisLabel: false },
  // Scatter's per-point hover is not coordinated at all — no echo anywhere.
  "scatter":                  { pills: false, guide: false, dot: false, region: false, axisLabel: false },
};

describe("what a 2-pane figure's OTHER pane echoes, at defaults", () => {
  for (const t of TYPES) {
    it(t.name, () => {
      const { spec: s, rows, hover } = t.mount(true);
      const m = mountHover(s, rows, true);
      expect(m.svgs.length).toBe(2);
      hover(m.svgs[0]!);
      expect(paneEcho(m.svgs[1]!), `${t.name}: sibling pane`).toEqual(SIBLING_ECHO[t.name]);
    });
  }

  it("no stale rows — every SIBLING_ECHO key is a chart type that is actually mounted", () => {
    expect(Object.keys(SIBLING_ECHO).sort()).toEqual(TYPES.map((t) => t.name).sort());
  });

  it("the axis-label echo is the ACTIVE pane's alone, on every type that draws one", () => {
    // A documented condition (`tbl-coord-axis-label`: "the actively-hovered pane only") that only
    // this table can check. Asserted as an invariant over the table so a new type cannot be added
    // with a sibling axis label and no one notice.
    for (const [name, echo] of Object.entries(SIBLING_ECHO)) {
      expect(echo.axisLabel, `${name}: a non-hovered pane must not echo the x value`).toBe(false);
    }
  });
});
