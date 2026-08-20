// @vitest-environment jsdom
//
// A SINGLE-SERIES CARD ROW CARRIES NO LABEL AND NO COLON — every chart type whose hover draws a
// card, at DEFAULTS.
//
// A chart with no `series` column has one implicit series keyed SINGLE_SERIES_KEY (""), so there is
// no name for the row to print. Every card builder used to print the colon anyway, and the row read
// ": 10.00" — a colon labelling nothing. The histogram was fixed first (c502add) and the same bare
// colon was then measured on four more types at defaults; this file is the gate for all five, so
// they cannot drift apart again.
//
// WHY NO LABEL RATHER THAN AN INVENTED ONE. There is no honest word for the value of an unnamed
// series: what the height MEANS is whatever the value axis measures — dollars, a share, a count —
// and it differs per figure, not per chart type. "Value" would be a word standing in for the
// absence of one, and the swatch already identifies the mark. An author who wants a word has
// `series_labels: {"": "…"}`, which validate.ts admits for exactly this case; the paired control in
// each block below asserts it still fills the label in.
//
// NOT here, and not an omission: `scatter`. Its card rows are the AXIS TITLES rather than series
// names (`attachPointHover`, with "x"/"y" fallbacks), so an unnamed series never leaves a colon
// labelling nothing there — a single-series scatter reads "x: 1" / "Value: 2.00" at defaults.
//
// DEFAULTS ONLY, for the reason hover-surface-matrix.test.ts states: a claim about hover verified
// under a dial the claim does not name is how nine false claims shipped on this branch. The only
// fields any spec below sets are the ones that DEFINE its chart type, and the `series_labels`
// control names its own dial.
import { describe, it, expect, beforeEach } from "vitest";
import { mountHover, cardShown, hoverFirstMark, BAR_MARK, DOT_MARK, HIST_MARK, PLOT_MIDDLE } from "./helpers/hover-harness";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

beforeEach(() => {
  document.body.innerHTML = "";
});

const spec = (s: Record<string, unknown>): ChartSpec =>
  ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;

/** No `series` column at all — which is what makes the chart single-series (resolveColumns). */
const CAT_ROWS = [
  { time: "A", value: "10" },
  { time: "B", value: "20" },
] as unknown as TidyRow[];

/** Month-spaced, like the matrix's temporal fixture: a temporal axis ticks on whole months. */
const TEMPORAL_ROWS = ["2020-01-01", "2020-02-01", "2020-03-01"].map((t, i) => ({
  time: t, value: String(3 + i),
})) as unknown as TidyRow[];

const HIST_ROWS = Array.from({ length: 16 }, (_, v) => ({ amount: String(v) })) as unknown as TidyRow[];

/** A stacked chart cards only where the net dot is drawn — i.e. where a stack goes negative. */
const NEG_CAT_ROWS = [
  { time: "A", value: "-6" },
  { time: "B", value: "-4" },
] as unknown as TidyRow[];

/** The first row of the shown card: its label element (null when unlabelled) and its whole text. */
function firstRow(): { label: Element | null; text: string } {
  const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
  const row = tip.querySelector<HTMLElement>(".tbl-tooltip-row")!;
  return { label: row.querySelector(".tbl-tooltip-label"), text: (row.textContent ?? "").trim() };
}

type Case = {
  name: string;
  /** Chart-defining fields only. */
  spec: Record<string, unknown>;
  rows: TidyRow[];
  mark: string;
  /** The value the hovered mark reports, formatted as the card formats it. */
  value: string;
};

const CASES: Case[] = [
  // Categorical-x line and dot plot both card through `buildBandTooltipHtml`
  // (attachCategoricalLineCrosshair), so one builder covers these two.
  { name: "line (categorical x)", spec: { chartType: "line", xAxisType: "categorical" }, rows: CAT_ROWS, mark: PLOT_MIDDLE, value: "10.00" },
  { name: "dotplot", spec: { chartType: "dotplot", xAxisType: "categorical" }, rows: CAT_ROWS, mark: DOT_MARK, value: "10.00" },
  // Temporal line and area both card through `attachCrosshair`'s own row loop — a second builder,
  // hence a second fix site. The area's card also carries a Total row, which is why every
  // assertion below is scoped to the SERIES row rather than to the card as a whole.
  { name: "line (temporal)", spec: { chartType: "line", xAxisType: "temporal" }, rows: TEMPORAL_ROWS, mark: PLOT_MIDDLE, value: "4.00" },
  { name: "area (temporal)", spec: { chartType: "area", xAxisType: "temporal" }, rows: TEMPORAL_ROWS, mark: PLOT_MIDDLE, value: "4.00" },
  // The type this rule was first ruled on, kept here so all of them read as one table.
  {
    name: "histogram",
    spec: { chartType: "histogram", xAxisType: "numeric", histogram: { bins: 4, domain: [0, 20] }, columns: { x: "amount" } },
    rows: HIST_ROWS, mark: HIST_MARK, value: "5.00",
  },
  // The other two types the band builder cards for, single-series. A stacked chart's card is
  // DATA-dependent — it is drawn where the net dot is, i.e. where the stack has a genuine negative
  // (see hover-surface-matrix.test.ts), which is why these rows are negative; that is data, not a
  // dial. A single-series stack gets no Total row either (`orderedSeries.length > 1`), so the card is
  // the one unlabelled value.
  { name: "stacked (single series, negative)", spec: { chartType: "stacked", xAxisType: "categorical" }, rows: NEG_CAT_ROWS, mark: BAR_MARK, value: "-6.00" },
  { name: "dumbbell", spec: { chartType: "dumbbell", xAxisType: "categorical" }, rows: CAT_ROWS, mark: DOT_MARK, value: "10.00" },
];

describe("a single-series card row: no label, no bare colon (defaults)", () => {
  for (const c of CASES) {
    it(`${c.name}: the row is the value alone`, () => {
      const m = mountHover(spec(c.spec), c.rows);
      hoverFirstMark(m.svgs[0]!, c.mark);
      // Paired with every "no label" assertion: a card that never showed would pass vacuously.
      expect(cardShown(), `${c.name}: no card shown, so this measures nothing`).toBe(true);
      const { label, text } = firstRow();
      expect(label, `${c.name}: the row still carries a label element`).toBeNull();
      expect(text).toBe(c.value);
    });

    it(`${c.name}: series_labels: {"": …} still labels it`, () => {
      // The escape hatch, and the reason dropping the label loses nothing an author needs.
      const m = mountHover(spec({ ...c.spec, series_labels: { "": "Households" } }), c.rows);
      hoverFirstMark(m.svgs[0]!, c.mark);
      expect(cardShown()).toBe(true);
      const { label, text } = firstRow();
      expect(label?.textContent).toBe("Households:");
      expect(text).toBe(`Households: ${c.value}`);
    });
  }
});
