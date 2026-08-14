// @vitest-environment jsdom
//
// A series keeps ITS colour in every pane of a small-multiples figure.
//
// The palette is assigned by POSITION, and each pane used to resolve its own series list from its own
// rows — so a pane missing a series shifted every later series one slot down the palette. Measured on
// a two-series figure whose South pane lacks "one":
//
//   figure legend: one=#0072B2, two=#E69F00
//     pane N PAINTS two = #E69F00   (agrees)
//     pane S PAINTS two = #0072B2   (the pane paints the wrong hue)
//
// The tooltip then disagreed with the pane too, because it keys from the figure legend first — but
// the paint is the bug: a reader compares panes side by side, and one of them was lying about which
// series they were looking at. Bar panes hid the tooltip half at hover time (recolourIcons reads the
// drawn fill); line panes have no such step, which is where it surfaced.
import { describe, it, expect } from "vitest";
import { renderFigure } from "../src/engine/figure";
import { resolveTooltipIcons } from "../src/engine/icon";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document };
const BLUE = "#0072B2";
const AMBER = "#E69F00";

const SPEC = (mode: "shared" | "per-pane"): ChartSpec =>
  ({
    chartType: "line",
    title: "Demo",
    xAxisType: "numeric",
    data: "d.csv",
    columns: { facet: "region" },
    small_multiples: { mode },
  }) as unknown as ChartSpec;

/** N carries both series, S only "two". */
const GAP_IN_SECOND_PANE: TidyRow[] = [
  { time: "2020", region: "N", series: "one", value: "6" },
  { time: "2021", region: "N", series: "one", value: "4" },
  { time: "2020", region: "N", series: "two", value: "3" },
  { time: "2021", region: "N", series: "two", value: "7" },
  { time: "2020", region: "S", series: "two", value: "5" },
  { time: "2021", region: "S", series: "two", value: "2" },
] as unknown as TidyRow[];

/** The same gap, in the FIRST pane — the figure's own legend is built off pane 0. */
const GAP_IN_FIRST_PANE: TidyRow[] = [
  { time: "2020", region: "N", series: "two", value: "3" },
  { time: "2021", region: "N", series: "two", value: "7" },
  { time: "2020", region: "S", series: "one", value: "6" },
  { time: "2021", region: "S", series: "one", value: "4" },
  { time: "2020", region: "S", series: "two", value: "5" },
  { time: "2021", region: "S", series: "two", value: "2" },
] as unknown as TidyRow[];

/** series → the stroke each pane actually painted. */
function painted(svg: SVGSVGElement | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of svg?.querySelectorAll("path[data-series]") ?? []) {
    const s = p.getAttribute("data-series");
    const stroke = p.getAttribute("stroke");
    if (s && stroke) m.set(s, stroke);
  }
  return m;
}

for (const mode of ["shared", "per-pane"] as const) {
  describe(`small multiples (${mode}) — a series keeps its colour across panes`, () => {
    it("paints a series the same hue in a pane that is missing the series before it", () => {
      const f = renderFigure(SPEC(mode), GAP_IN_SECOND_PANE, OPTS);
      const [n, s] = f.panes;
      expect(painted(n?.svg)).toEqual(new Map([["one", BLUE], ["two", AMBER]]));
      // Was #0072B2 — "two" slid into "one"'s empty palette slot.
      expect(painted(s?.svg)).toEqual(new Map([["two", AMBER]]));
    });

    it("agrees with the figure legend", () => {
      const f = renderFigure(SPEC(mode), GAP_IN_SECOND_PANE, OPTS);
      expect(f.legendItems?.map((l) => [l.series, l.color])).toEqual([
        ["one", BLUE],
        ["two", AMBER],
      ]);
      for (const pane of f.panes) {
        for (const [series, stroke] of painted(pane.svg)) {
          expect(f.legendItems?.find((l) => l.series === series)?.color, `${pane.value}/${series}`).toBe(stroke);
        }
      }
    });

    it("keys a series the FIRST pane happens to lack", () => {
      // The figure legend used to be built from pane 0 alone, so "one" — drawn in the South pane —
      // had no legend row at all, and the reader had no key for a line on the page.
      const f = renderFigure(SPEC(mode), GAP_IN_FIRST_PANE, OPTS);
      expect(f.legendItems?.map((l) => l.series)).toEqual(["two", "one"]);
      expect(painted(f.panes[1]?.svg).get("one")).toBe(
        f.legendItems?.find((l) => l.series === "one")?.color,
      );
    });

    it("hands the tooltip the colour the pane painted", () => {
      const f = renderFigure(SPEC(mode), GAP_IN_SECOND_PANE, OPTS);
      for (const pane of f.panes) {
        // Exactly what a line pane's crosshair resolves: figure legend first, pane key rows for the
        // gaps, and no recolour step (only bar/histogram panes have one).
        const icons = resolveTooltipIcons({ legendItems: f.legendItems, keyRows: pane.seriesKeyRows });
        for (const [series, stroke] of painted(pane.svg)) {
          expect(icons.get(series)?.color, `${pane.value}/${series}`).toBe(stroke);
        }
      }
    });

    it("leaves a figure whose panes all carry every series alone", () => {
      const full = [
        ...GAP_IN_SECOND_PANE,
        { time: "2020", region: "S", series: "one", value: "1" },
        { time: "2021", region: "S", series: "one", value: "8" },
      ] as unknown as TidyRow[];
      const f = renderFigure(SPEC(mode), full, OPTS);
      for (const pane of f.panes) {
        expect(painted(pane.svg), pane.value).toEqual(new Map([["one", BLUE], ["two", AMBER]]));
      }
    });
  });
}
