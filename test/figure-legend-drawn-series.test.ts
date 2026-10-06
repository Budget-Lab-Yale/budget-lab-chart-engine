// @vitest-environment jsdom
//
// A SMALL-MULTIPLES FIGURE LEGEND KEYS ONLY THE SERIES ITS PANES DRAW — live and in the PNG.
//
// `small_multiples.pane_order` is an inclusion filter: a facet value it does not name is not a pane.
// A series whose rows all sit in such a pane is drawn nowhere, so a legend row for it keys nothing.
//
// Colours do NOT move: the palette still indexes the figure's full series list, so every drawn
// series keeps the colour it had before excluded-pane-only series were dropped from the legend.
import { describe, it, expect, afterEach } from "vitest";
import { buildColorMap } from "../src/engine/index";
import { renderFigure } from "../src/engine/figure";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

afterEach(() => document.body.replaceChildren());

const LABELS = { A: "Alpha series", B: "Bravo series", C: "Charlie series", D: "Delta series" };

const row = (pane: string, series: string, time: string, value: number) =>
  ({ pane, series, time, value: String(value) }) as unknown as TidyRow;
const pts = (pane: string, series: string, base: number): TidyRow[] =>
  ["2020-01-01", "2021-01-01", "2022-01-01"].map((t, i) => row(pane, series, t, base + i));

// Encounter order A, B, C, D: C sits only in pane R, which pane_order leaves out; D comes after it.
const ROWS: TidyRow[] = [
  ...pts("P", "A", 1), ...pts("P", "B", 2),
  ...pts("R", "C", 3),
  ...pts("P", "D", 4),
  ...pts("Q", "A", 5), ...pts("Q", "B", 6), ...pts("Q", "D", 7),
];

const spec = (mode: "shared" | "per-pane", extra: Record<string, unknown> = {}): ChartSpec =>
  ({
    chartType: "line",
    title: "t",
    xAxisType: "temporal",
    data: "d.csv",
    columns: { x: "time", value: "value", series: "series", facet: "pane" },
    series_labels: LABELS,
    small_multiples: { columns: 2, mode, pane_order: ["P", "Q"] },
    ...extra,
  }) as unknown as ChartSpec;

function mount(s: ChartSpec, rows: TidyRow[]): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  mountChart(host, { spec: s, rows, width: INNER_W });
  return host;
}

/** The colour the figure has always given D: its slot in the FULL series list. */
const D_COLOUR = buildColorMap(["A", "B", "C", "D"]).get("D")!;

for (const mode of ["shared", "per-pane"] as const) {
  describe(`small multiples (${mode}): a series only in a pane pane_order excludes`, () => {
    it("is not keyed by the figure legend", () => {
      const fig = renderFigure(spec(mode), ROWS, { width: INNER_W });
      expect(fig.panes.map((p) => p.value)).toEqual(["P", "Q"]);
      expect((fig.legendItems ?? []).map((i) => i.series)).toEqual(["A", "B", "D"]);
    });

    it("has no row in the live legend", () => {
      const host = mount(spec(mode), ROWS);
      expect(host.querySelector('.tbl-legend-item[data-series="A"]'), "legend not found, so this measures nothing").not.toBeNull();
      expect(host.querySelector('.tbl-legend-item[data-series="C"]')).toBeNull();
      expect(host.textContent ?? "").not.toContain("Charlie series");
    });

    it("has no row in the PNG export's legend", () => {
      const png = buildExportSvg(spec(mode), ROWS);
      expect(png.textContent ?? "", "legend not found, so this measures nothing").toContain("Delta series");
      expect(png.textContent ?? "").not.toContain("Charlie series");
    });

    it("leaves every drawn series its colour: D keeps the palette slot after C", () => {
      // The test discriminates only if re-indexing without C would have recoloured D.
      expect(buildColorMap(["A", "B", "D"]).get("D")).not.toBe(D_COLOUR);
      const fig = renderFigure(spec(mode), ROWS, { width: INNER_W });
      expect(fig.legendItems!.find((i) => i.series === "D")!.color).toBe(D_COLOUR);
      for (const p of fig.panes) {
        const stroke = (p.svg as SVGSVGElement)
          .querySelector<SVGPathElement>('path[data-series="D"]')
          ?.getAttribute("stroke");
        expect(stroke).toBe(D_COLOUR);
      }
    });

    it("control: with no pane_order, C is drawn and keyed", () => {
      const s = spec(mode);
      (s.small_multiples as { pane_order?: string[] }).pane_order = undefined;
      const fig = renderFigure(s, ROWS, { width: INNER_W });
      expect((fig.legendItems ?? []).map((i) => i.series)).toEqual(["A", "B", "C", "D"]);
    });
  });
}
