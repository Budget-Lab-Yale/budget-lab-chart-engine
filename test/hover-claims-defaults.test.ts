// @vitest-environment jsdom
//
// EVERY CONFIG-SPEC.md CLAIM OF THE FORM "X reaches the hover tooltip", CHECKED AT DEFAULTS.
//
// Five false claims of exactly this shape were found in CONFIG-SPEC.md during 1.12.0, and each one
// was written from the STANDALONE case and silently generalised: on a multi-pane figure the
// coordinated cursor replaces the pane's floating card, so anything the card builder alone knows
// how to render is simply not rendered. `CONFIG-SPEC.md` is vendored verbatim by
// `budget-lab-charts` and gated in its CI, so each of those is a defect shipped to figure authors.
//
// The rule this file enforces: a claim is gated by a test that sets NO dial the claim does not
// name. Where a claim is true only under a dial, the dial appears here as a paired control and the
// doc names it. Nothing below sets `coordinated_cursor` or `barStack.hover` except as such a
// control.
//
// TWO OF THOSE CLAIMS WERE GAPS, PINNED HERE AS "GAP —" ASSERTIONS UNTIL 1.12.0 CLOSED THEM:
// `tooltip_x_format` is now read by the coordinated line cursor (and draws its echo below the plot
// where a sub-month span leaves no axis tick to annotate), and `x_labels` now heads the
// categorical-line family's card (dumbbell / dot plot / categorical-x line), faceted included
// wherever that card survives coordination. Those assertions were flipped, not deleted.
//
// ONE GAP STAYS OPEN, still marked "GAP —" below: a coordinated pane's CATEGORY echo shows the raw
// category, because `addCoordCategoryHighlight` overlays the RENDERED axis tick — taking that
// tick's own box, wrap mode and rotation — and `x_labels` exists precisely to read more verbosely
// than the tick. Substituting the verbose string there is a redesign of the echo (its width, and
// collision with neighbouring ticks), not a value to thread. CONFIG-SPEC.md names that limit.
import { describe, it, expect, beforeEach } from "vitest";
import {
  mountHover, cardShown, cardText, coordShown, coordTexts, hoverFirstMark,
  BAR_MARK, DOT_MARK, PLOT_MIDDLE,
} from "./helpers/hover-harness";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

beforeEach(() => {
  document.body.innerHTML = "";
});

const sm = { small_multiples: { columns: 2, mode: "shared" } };
const facetCols = { columns: { x: "time", value: "value", series: "series", facet: "pane" } };
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

const temporalRows = (times: string[]): TidyRow[] =>
  times.flatMap((t, i) =>
    ["A", "B"].flatMap((s) => [
      { pane: "P1", time: t, series: s, value: String(3 + i) },
      { pane: "P2", time: t, series: s, value: String(5 + i) },
    ]),
  ) as unknown as TidyRow[];

/** The same temporal shape with NO `series` column — one implicit series, which is what makes a
 *  card's rows single-row at defaults. */
const soloTemporalRows = (times: string[]): TidyRow[] =>
  times.map((t, i) => ({ time: t, value: String(3 + i) })) as unknown as TidyRow[];

const MONTHLY = ["2026-06-01", "2026-07-01", "2026-08-01"];
const DAILY = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"];

// ---------------------------------------------------------------------------
// `x_labels` — the hover card's category header. Consumed inside `buildBandTooltipHtml`, which both
// `attachBandCrosshair` and `attachCategoricalLineCrosshair` now feed `categoryLabels` — so it
// renders wherever a hover CARD is drawn. Where a chart draws no card (a plain bar's value pills, a
// coordinated pane's in-place cursor) there is no header to put it in, and the coordinated category
// echo stays the raw axis tick (see the header note).
// ---------------------------------------------------------------------------

describe("x_labels", () => {
  const LABELS = { x_labels: { A: "Verbose label for A" } };

  it("GAP — plain bar, standalone: never renders (hoverMode is always \"pills\")", () => {
    const m = mountHover(spec({ chartType: "bar", xAxisType: "categorical", ...LABELS }), catRows([["S", 6, 4]]));
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(document.body.textContent ?? "").not.toContain("Verbose label for A");
  });

  it("categorical-x line, standalone: the card header shows the display label", () => {
    const m = mountHover(
      spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"], ...LABELS }),
      catRows([["A", 10, 20], ["B", 12, 22]]),
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown()).toBe(true);
    expect(cardText()).toContain("Verbose label for A");
  });

  it("dumbbell, standalone: same — the display label heads the card", () => {
    const m = mountHover(
      spec({ chartType: "dumbbell", xAxisType: "categorical", series_order: ["A", "B"], ...LABELS }),
      catRows([["A", 3, 4], ["B", 7, 9]]),
    );
    hoverFirstMark(m.svgs[0]!, DOT_MARK);
    expect(cardShown()).toBe(true);
    expect(cardText()).toContain("Verbose label for A");
  });

  it("dumbbell, 2-pane: the label reaches a FACETED card — a dumbbell keeps its card by design", () => {
    const m = mountHover(
      spec({ chartType: "dumbbell", xAxisType: "categorical", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm, ...LABELS }),
      twoPane([["A", 3, 4], ["B", 7, 9]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, DOT_MARK);
    expect(cardShown()).toBe(true);
    expect(cardText()).toContain("Verbose label for A");
  });

  it("dot plot, standalone: the display label heads the card there too", () => {
    const m = mountHover(
      spec({ chartType: "dotplot", xAxisType: "categorical", series_order: ["A", "B"], ...LABELS }),
      catRows([["A", 3, 4], ["B", 7, 9]]),
    );
    hoverFirstMark(m.svgs[0]!, DOT_MARK);
    expect(cardShown()).toBe(true);
    expect(cardText()).toContain("Verbose label for A");
  });

  it("GAP — 2-pane bar: never renders; the coordinated cursor echoes the raw category", () => {
    const m = mountHover(
      spec({ chartType: "bar", xAxisType: "categorical", data: "d.csv", ...facetCols, ...sm, ...LABELS }),
      twoPane([["S", 10, 20]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(document.body.textContent ?? "").not.toContain("Verbose label for A");
  });

  it("renders on a diverging stack, standalone AND 2-pane — the one band card drawn at defaults", () => {
    for (const faceted of [false, true]) {
      document.body.innerHTML = "";
      const m = mountHover(
        spec({
          chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], ...LABELS,
          ...(faceted ? { data: "d.csv", ...facetCols, ...sm } : {}),
        }),
        faceted ? twoPane([["Up", 6, 5], ["Down", -4, -2]]) : catRows([["Up", 6, 5], ["Down", -4, -2]]),
        faceted,
      );
      hoverFirstMark(m.svgs[0]!, BAR_MARK);
      expect(cardText(), `faceted=${faceted}`).toContain("Verbose label for A");
    }
  });
});

// ---------------------------------------------------------------------------
// `tooltip_x_format` — `render-live.ts` forwards it into `attachSecondaryLineCursor` as `xFormat`,
// which now draws the coordinated x echo with it when the spec set the field. Absent the field the
// echo keeps its axis-matching two-line `%b` / `%Y`, so no figure that does not set it moves.
// ---------------------------------------------------------------------------

describe("tooltip_x_format", () => {
  const FMT = { tooltip_x_format: "%b %-d, %Y" };

  it("standalone temporal line: the card header honours it", () => {
    const m = mountHover(spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], ...FMT }), temporalRows(DAILY));
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown()).toBe(true);
    expect(cardText()).toMatch(/Jun \d, 2026/);
  });

  it("2-pane MONTHLY temporal line: the coordinated cursor's x echo honours it", () => {
    const m = mountHover(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm, ...FMT }),
      temporalRows(MONTHLY),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    const texts = coordTexts(m.svgs[0]!);
    expect(texts.some((t) => /^[A-Z][a-z]{2} \d{1,2}, 2026$/.test(t)), texts.join("|")).toBe(true);
    // One echo, not the author's format drawn on top of the old two-line %b / %Y.
    expect(texts).not.toContain("2026");
  });

  // ISSUE #30 PLACEMENT. The echo pill is centred on the cursor and sized from ITS OWN text, so
  // an author format wider than the tick it lands on reaches across a neighbouring tick and leaves
  // a fragment of it sticking out past the pill's edge — `Jun 1, 2026` over a monthly axis clipped
  // `Apr` to `pr`. Found in a browser, because jsdom has no layout; what these two gate is that the
  // pill's box is measured against the tick boxes and the ticks it covers are hidden for as long as
  // it shows, then restored. The GEOMETRY here is the harness's mock (a text is `len * 5` wide), not
  // real font metrics, so these prove the mechanism fires and targets the right elements — the
  // absence of a visible collision at real widths is a browser screenshot, not this.
  const xTicks = (svg: SVGSVGElement): Array<{ text: string; hidden: boolean }> => {
    const vb = svg.viewBox.baseVal;
    const plotBottom = vb.height - (+(svg.dataset.marginBottom ?? "") || 28);
    return Array.from(svg.querySelectorAll<SVGTextElement>("text"))
      .filter((t) => !t.closest(".tbl-coord") && !t.closest(".tbl-y-tick-label"))
      .filter((t) => t.getBoundingClientRect().width > 0)
      .filter((t) => t.getBoundingClientRect().top >= plotBottom - 2)
      .map((t) => ({ text: t.textContent ?? "", hidden: t.style.visibility === "hidden" }));
  };
  /** The echo pill's box, from the rect the engine actually drew. */
  const pillBox = (svg: SVGSVGElement) => {
    const r = svg.querySelector<SVGRectElement>("rect.tbl-coord-axis-label");
    if (!r) return null;
    const x = +r.getAttribute("x")!, y = +r.getAttribute("y")!;
    return { left: x, right: x + +r.getAttribute("width")!, top: y, bot: y + +r.getAttribute("height")! };
  };

  it("2-pane MONTHLY temporal line: the echo hides the tick labels it covers, and only those", () => {
    // A year of months puts the ticks close enough together that a long format's pill lands on one.
    const YEAR = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`);
    const m = mountHover(
      spec({
        chartType: "line", xAxisType: "temporal", series_order: ["A", "B"],
        data: "d.csv", ...facetCols, ...sm, tooltip_x_format: "%A, %B %-d, %Y",
      }),
      temporalRows(YEAR),
      true,
    );
    const svg = m.svgs[0]!;
    hoverFirstMark(svg, PLOT_MIDDLE);
    const box = pillBox(svg)!;
    expect(box).toBeTruthy();
    const ticks = xTicks(svg);
    // The mechanism fired: something was covered and is now hidden.
    expect(ticks.some((t) => t.hidden), ticks.map((t) => `${t.text}:${t.hidden}`).join("|")).toBe(true);
    // And nothing still VISIBLE intersects the pill — the collision itself, in mocked geometry.
    const visibleUnderPill = Array.from(svg.querySelectorAll<SVGTextElement>("text"))
      .filter((t) => !t.closest(".tbl-coord") && t.style.visibility !== "hidden")
      .map((t) => t.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.top >= box.top - 1)
      .filter((r) => Math.min(box.right, r.right) - Math.max(box.left, r.left) > 0.5)
      .filter((r) => Math.min(box.bot, r.bottom) - Math.max(box.top, r.top) > 0.5);
    expect(visibleUnderPill.length).toBe(0);
    // The pane the cursor LEFT is whole again: pointerleave clears the echo and restores the axis.
    svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(xTicks(svg).filter((t) => t.hidden)).toEqual([]);
    // The un-hovered sibling pane never had a tick hidden at all.
    expect(xTicks(m.svgs[1]!).filter((t) => t.hidden)).toEqual([]);
  });

  it("2-pane MONTHLY temporal line, FIELD ABSENT: no tick is hidden — the default echo is tick-width", () => {
    const YEAR = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`);
    const m = mountHover(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm }),
      temporalRows(YEAR),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(xTicks(m.svgs[0]!).filter((t) => t.hidden)).toEqual([]);
  });

  it("2-pane MONTHLY temporal line, FIELD ABSENT: the two-line %b / %Y echo is unchanged", () => {
    const m = mountHover(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm }),
      temporalRows(MONTHLY),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    const texts = coordTexts(m.svgs[0]!);
    expect(texts).toContain("2026");
    expect(texts.some((t) => /^[A-Z][a-z]{2}$/.test(t))).toBe(true);
  });

  it("2-pane DAILY temporal line: the field draws an x readout where there is no axis tick to echo", () => {
    const m = mountHover(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm, ...FMT }),
      temporalRows(DAILY),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    const svg = m.svgs[0]!;
    expect(coordShown(svg)).toBe(true);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBeGreaterThan(0);
    // The temporal axis ticks on timeMonth and a four-day span crosses no month boundary, so there
    // is no axis row to annotate — the echo anchors just below the plot instead of being skipped.
    expect(svg.querySelectorAll(".tbl-coord-axis-label").length).toBe(1);
    const texts = coordTexts(svg);
    expect(texts.some((t) => /^Jun \d, 2026$/.test(t)), texts.join("|")).toBe(true);
  });

  it("2-pane DAILY temporal line, FIELD ABSENT: still no x readout — that is the field's whole job", () => {
    // Not a gap left open by accident: without the field the echo matches the axis ticks, and a
    // sub-month span draws none. `%b` / `%Y` on a daily series labels every point in the month
    // identically, which is the failure `tooltip_x_format` exists to fix.
    const m = mountHover(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm }),
      temporalRows(DAILY),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    const svg = m.svgs[0]!;
    expect(coordShown(svg)).toBe(true);
    expect(svg.querySelectorAll(".tbl-coord-axis-label").length).toBe(0);
    expect(coordTexts(svg).every((t) => /^[\d.,-]+$/.test(t))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `tbl-coord-axis-label` — claimed for "every coordinated-cursor chart type except dumbbell and
// horizontal bar/stacked/waterfall … the actively-hovered pane only". On line/area it is
// additionally conditional on the pane having x-axis tick labels to echo (the DAILY case above).
// ---------------------------------------------------------------------------

describe("tbl-coord-axis-label", () => {
  it("2-pane MONTHLY line: drawn on the hovered pane, absent on the echoed one", () => {
    const m = mountHover(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm }),
      temporalRows(MONTHLY),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(m.svgs[0]!.querySelectorAll(".tbl-coord-axis-label").length).toBeGreaterThan(0);
    expect(coordShown(m.svgs[1]!)).toBe(true);
    expect(m.svgs[1]!.querySelectorAll(".tbl-coord-axis-label").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stacked AREA's cumulative `Total` row — standalone only. `showTotal` is passed at both
// `attachCrosshair` sites, but the Total row is built below `if (emitOnly) return;`.
// ---------------------------------------------------------------------------

describe("stacked-area Total row", () => {
  it("standalone: the card carries it", () => {
    const m = mountHover(spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"] }), temporalRows(MONTHLY));
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardText()).toContain("Total");
  });

  // A Total row states the SUM OF THE ROWS ABOVE IT. Where those rows are one row, it states that
  // row again — "4.00" and then "Total: 4.00", which is what a reader gets asked to compare. So the
  // row is gated on there being more than one series to add up, exactly as the band-card builder
  // gates it (`buildBandTooltipHtml`'s `orderedSeries.length > 1`). Both cases below are DEFAULTS:
  // what makes them single-row is the data, not a dial.
  it("standalone, one series: NO Total row — the total of one series is that series", () => {
    const m = mountHover(spec({ chartType: "area", xAxisType: "temporal" }), soloTemporalRows(MONTHLY));
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown(), "no card shown, so this measures nothing").toBe(true);
    expect(cardText()).toContain("4.00");
    expect(cardText()).not.toContain("Total");
  });

  it("standalone, two series but only ONE with a value at the hovered x: no Total row either", () => {
    // The count that matters is the rows the card actually drew, not the series the chart has —
    // the band builder counts the series with a finite value AT THE HOVERED CATEGORY, and this
    // path now counts the same way. `hoverFirstMark(PLOT_MIDDLE)` snaps to the middle month, where
    // B has no row, so the card draws one series row there.
    const gappy = temporalRows(MONTHLY).filter((r) => !(r.series === "B" && r.time === MONTHLY[1]));
    const m = mountHover(spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"] }), gappy);
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown(), "no card shown, so this measures nothing").toBe(true);
    expect(cardText()).not.toContain("Total");
  });

  it("2-pane: no card and no total reported anywhere — the pills give each series' own value", () => {
    const m = mountHover(
      spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm }),
      temporalRows(MONTHLY),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    const svg = m.svgs[0]!;
    expect(coordShown(svg)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(svg.textContent ?? "").not.toContain("Total");
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// `small_multiples.coordinated_cursor`'s single-pane parenthetical. A lone bar/stacked pane is
// coordinated ON PURPOSE (`isCategoricalBarFig` in render-live.ts), so it does NOT behave as if the
// field were false. A lone line pane does.
// ---------------------------------------------------------------------------

describe("a single-pane figure is not always equivalent to coordinated_cursor: false", () => {
  const oneStack = (extra: Record<string, unknown> = {}): ChartSpec =>
    spec({
      chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], data: "d.csv",
      ...facetCols, small_multiples: { columns: 2, mode: "shared", ...extra },
    });
  const oneStackRows = catRows([["Up", 6, 5], ["Down", 4, 2]], "P1");

  it("lone STACKED pane, default: coordinated, no card", () => {
    const m = mountHover(oneStack(), oneStackRows, true);
    expect(m.svgs.length).toBe(1);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
  });

  it("control: the same lone pane with coordinated_cursor: false DOES get a card", () => {
    const m = mountHover(oneStack({ coordinated_cursor: false }), oneStackRows, true);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(cardShown()).toBe(true);
  });

  it("lone LINE pane, default: a card, as the field table says for line/area", () => {
    const m = mountHover(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm }),
      temporalRows(MONTHLY).filter((r) => (r as unknown as { pane: string }).pane === "P1"),
      true,
    );
    expect(m.svgs.length).toBe(1);
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `series_patterns` "the texture reaches … the hover tooltip". Textures are restricted to the
// filled types (bar, stacked, area, histogram, waterfall) — and `bar` and `waterfall` have no card
// at all, so "the hover tooltip" is not a surface those two have.
// ---------------------------------------------------------------------------

describe("series_patterns and \"the hover tooltip\"", () => {
  it("grouped bar with textures, standalone: there is no card for a texture to key into", () => {
    const m = mountHover(
      spec({ chartType: "bar", xAxisType: "categorical", series_order: ["Up", "Down"], series_patterns: { Up: "/", Down: "x" } }),
      catRows([["Up", 6, 5], ["Down", 4, 2]]),
    );
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
  });

  it("2-pane area with textures: no card either — the claim is standalone-only there", () => {
    const m = mountHover(
      spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols, ...sm, series_patterns: { A: "/", B: "x" } }),
      temporalRows(MONTHLY),
      true,
    );
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
  });

  // The carve-out the notes state in a parenthetical: a net-dot stack keeps its card in a PANE too
  // (its coordinated cursor is a band echo only — issue #32), so unlike the faceted area above it
  // DOES have a card there for the texture to key. Nothing gated that sentence; the swatch markup
  // is compared against the standalone chart's, because "just as the standalone one does" is the
  // half of the claim a mere "a line exists" assertion would leave open.
  it("2-pane net-dot stack with textures: the pane's card keys the texture, as the standalone does", () => {
    const TEXTURED = { series_patterns: { Up: "/" } };
    const stack = (faceted: boolean): ChartSpec =>
      spec({
        chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], ...TEXTURED,
        ...(faceted ? { data: "d.csv", ...facetCols, ...sm } : {}),
      });
    /** The `<svg>` markup of the shown card's swatch for one series row, keyed by its label. */
    const swatch = (series: string): string => {
      const row = [...document.body.querySelectorAll(".tbl-tooltip .tbl-tooltip-row")].find(
        (r) => r.querySelector(".tbl-tooltip-label")?.textContent === `${series}:`,
      );
      return row!.querySelector(".tbl-tooltip-swatch svg")!.innerHTML;
    };

    const m = mountHover(stack(true), twoPane([["Up", 6, 5], ["Down", -4, -2]]), true);
    expect(m.svgs.length).toBe(2);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(cardShown()).toBe(true);
    // The textured row is a ground rect PLUS the hatch band; the untextured one is a bare rect.
    const paneUp = swatch("Up");
    expect(paneUp).toContain("<line");
    expect(swatch("Down")).not.toContain("<line");

    // Same spec standalone: the card is the same singleton element, so read the pane's markup
    // first (above) and compare after the second mount replaces its contents.
    document.body.innerHTML = "";
    const s = mountHover(stack(false), catRows([["Up", 6, 5], ["Down", -4, -2]]));
    hoverFirstMark(s.svgs[0]!, BAR_MARK);
    expect(cardShown()).toBe(true);
    expect(swatch("Up")).toBe(paneUp);
  });
});

// ---------------------------------------------------------------------------
// The two claims that are only STALE WORDING: the field reaches the coordinated pill just as it
// reaches a card, so nothing functional is missing — only "hover tooltip" is the wrong noun.
// ---------------------------------------------------------------------------

describe("wording-only: the field reaches the pill, not just the card", () => {
  it("tooltip_decimals governs the coordinated pill's decimals on a 2-pane line", () => {
    const rows = temporalRows(MONTHLY).map((r) => ({
      ...r,
      value: (r as unknown as { series: string }).series === "A" ? "4.23456" : "9.5",
    })) as unknown as TidyRow[];
    for (const [dec, re] of [[undefined, /^4\.23$/], [4, /^4\.2346$/]] as const) {
      document.body.innerHTML = "";
      const m = mountHover(
        spec({
          chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv",
          ...facetCols, ...sm, ...(dec == null ? {} : { tooltip_decimals: dec }),
        }),
        rows,
        true,
      );
      hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
      expect(coordTexts(m.svgs[0]!).some((t) => re.test(t)), `tooltip_decimals=${dec}`).toBe(true);
    }
  });

  it("histogram.bin_label reaches the coordinated bin label on a 2-pane histogram", () => {
    const rows: TidyRow[] = [];
    for (const pane of ["P1", "P2"]) for (let v = 0; v < 16; v++) rows.push({ pane, amount: String(v) } as unknown as TidyRow);
    const m = mountHover(
      spec({
        chartType: "histogram", xAxisType: "numeric", data: "d.csv", ...sm,
        histogram: { bins: 4, domain: [0, 20], bin_label: { unit: " yrs" } },
        columns: { x: "amount", facet: "pane" },
      }),
      rows,
      true,
    );
    hoverFirstMark(m.svgs[0]!, 'g[aria-label="rect"] rect');
    expect(cardShown()).toBe(false);
    expect(coordTexts(m.svgs[0]!).join("|")).toContain(" yrs");
  });
});

// ---------------------------------------------------------------------------
// A WATERFALL'S VALUE PILL, WITH AND WITHOUT A `series` COLUMN.
//
// A waterfall is single-series by construction (validate.ts rejects data with more than one
// series), but `columns.series` naming a column that holds ONE value is legal and passes
// validation — real data arrives that shape. The pill is drawn by matching each rendered bar's
// `data-series` against the hover rows' series key, and the waterfall's tagging layer stamps every
// bar `SINGLE_SERIES_KEY` ("") while the rows carry the column's value, so the match missed and the
// chart showed NO value pill at all. Both cases are DEFAULT configuration — the difference is the
// data's shape, not a dial.
// ---------------------------------------------------------------------------

describe("waterfall value pills survive a single-valued series column", () => {
  const wfRows = (withSeries: boolean): TidyRow[] =>
    [["Up", "5"], ["Down", "-3"]].map(([step, value]) => ({
      step,
      value,
      ...(withSeries ? { who: "Baseline" } : {}),
    })) as unknown as TidyRow[];

  // No `columns.kind`: an absent kind is a delta, and a delta step is the one that carries a pill.
  const wf = (withSeries: boolean): ChartSpec =>
    spec({
      chartType: "waterfall",
      xAxisType: "categorical",
      columns: { x: "step", value: "value", ...(withSeries ? { series: "who" } : {}) },
    });

  for (const withSeries of [false, true]) {
    it(`${withSeries ? "with" : "without"} a series column: the hovered delta step draws its pill`, () => {
      const m = mountHover(wf(withSeries), wfRows(withSeries));
      hoverFirstMark(m.svgs[0]!, BAR_MARK);
      expect(coordShown(m.svgs[0]!)).toBe(true);
      expect(
        Array.from(m.svgs[0]!.querySelectorAll(".tbl-coord-pill-text")).map((t) => t.textContent),
      ).toEqual(["+5"]);
    });
  }
});
