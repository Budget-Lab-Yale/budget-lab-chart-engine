// @vitest-environment jsdom
//
// A horizontal bar, stacked or dumbbell chart (a dumbbell with orientation omitted included) has no
// small-multiple panes: its groups are sections. `columns.facet` there is a validation error naming
// the section spelling (columns.section, section_order, section_labels), and every exported render
// entry throws the same message rather than draw it. Ruling 80 (1.16.0) drew such a spec as sections;
// that mapping is gone, so the section spelling is the only one, and it draws what the facet spelling
// drew. Vertical charts keep their panes (their goldens guard that).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderChart, renderFigure, renderPane } from "../src/engine/index";
import { mountChart, computeChartHeight } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { validateChart, validateSpec } from "../src/spec/validate";
import { HORIZONTAL_FACET_ERROR } from "../src/spec/facet-groups";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});
beforeEach(() => {
  document.body.innerHTML = "";
});

const ROWS = ([
  ["Long", "Top 1% by net worth"],
  ["Long", "Q1"],
  ["Short", "Q1"],
  ["Short", "Q2"],
] as const).flatMap(([pane, cat], i) => [
  { pane, cat, m: "Before", v: String(10 + i) },
  { pane, cat, m: "After", v: String(20 + i) },
]) as unknown as TidyRow[];

const FACETED = {
  title: "t",
  xAxisType: "categorical",
  columns: { x: "cat", series: "m", value: "v", facet: "pane" },
  series_order: ["Before", "After"],
  small_multiples: { mode: "shared", columns: 1, pane_order: ["Short", "Long"], pane_titles: { Short: "Short labels", Long: "Long labels" } },
  data: "d.csv",
} as const;
const SECTIONED = {
  title: "t",
  xAxisType: "categorical",
  columns: { x: "cat", series: "m", value: "v", section: "pane" },
  series_order: ["Before", "After"],
  section_order: ["Short", "Long"],
  section_labels: { Short: "Short labels", Long: "Long labels" },
  data: "d.csv",
} as const;

const TYPES: Array<[string, Partial<ChartSpec>]> = [
  ["horizontal bar", { chartType: "bar", orientation: "horizontal" }],
  ["horizontal stacked", { chartType: "stacked", orientation: "horizontal" }],
  ["horizontal dumbbell", { chartType: "dumbbell", orientation: "horizontal" }],
  ["dumbbell, orientation omitted", { chartType: "dumbbell" }],
];
const make = (base: object, type: Partial<ChartSpec>): ChartSpec => ({ ...base, ...type }) as unknown as ChartSpec;
const withoutSmallMultiples = (spec: ChartSpec): ChartSpec => {
  const { small_multiples: _sm, ...rest } = spec;
  return rest as ChartSpec;
};

describe("HORIZONTAL_FACET_ERROR", () => {
  it("names the section spelling and says it draws the same chart", () => {
    expect(HORIZONTAL_FACET_ERROR).toMatch(/columns\.facet/);
    expect(HORIZONTAL_FACET_ERROR).toMatch(/columns\.section/);
    expect(HORIZONTAL_FACET_ERROR).toMatch(/section_order.*small_multiples\.pane_order/);
    expect(HORIZONTAL_FACET_ERROR).toMatch(/section_labels.*small_multiples\.pane_titles/);
    expect(HORIZONTAL_FACET_ERROR).toMatch(/remove small_multiples/);
    expect(HORIZONTAL_FACET_ERROR).toMatch(/draws the same chart/);
  });
});

describe("columns.facet on a horizontal chart is rejected; columns.section is the spelling", () => {
  for (const [name, type] of TYPES) {
    describe(name, () => {
      const faceted = make(FACETED, type);
      const sectioned = make(SECTIONED, type);

      it("validation rejects it with the one message, with or without small_multiples", () => {
        for (const spec of [faceted, withoutSmallMultiples(faceted)]) {
          expect(validateSpec(spec).errors).toEqual([HORIZONTAL_FACET_ERROR]);
          expect(validateChart(spec, ROWS).errors).toEqual([HORIZONTAL_FACET_ERROR]);
        }
      });

      it("the section spelling validates", () => {
        expect(validateChart(sectioned, ROWS)).toEqual({ valid: true, errors: [] });
      });

      it("every exported render entry throws the same message rather than draw it", () => {
        for (const spec of [faceted, withoutSmallMultiples(faceted)]) {
          expect(() => renderChart(spec, ROWS, { width: 720 })).toThrow(HORIZONTAL_FACET_ERROR);
          expect(() => renderPane(spec, ROWS, { width: 720 })).toThrow(HORIZONTAL_FACET_ERROR);
          expect(() => renderFigure(spec, ROWS, { width: 720 })).toThrow(HORIZONTAL_FACET_ERROR);
          expect(() => buildExportSvg(spec, ROWS)).toThrow(HORIZONTAL_FACET_ERROR);
          expect(() => computeChartHeight(spec, ROWS)).toThrow(HORIZONTAL_FACET_ERROR);
          const host = document.createElement("div");
          document.body.appendChild(host);
          expect(() => mountChart(host, { spec, rows: ROWS, width: INNER_W })).toThrow(HORIZONTAL_FACET_ERROR);
          expect(host.querySelector("svg")).toBeNull();
        }
      });
    });
  }
});

describe("validation: one error, not a cascade", () => {
  const bar = make(FACETED, { chartType: "bar", orientation: "horizontal" });
  const db = make(FACETED, { chartType: "dumbbell" });
  const errs = (spec: object): string[] => validateChart(spec, ROWS).errors;

  it("pane-only small_multiples settings and section_order / section_labels add no error of their own", () => {
    const spec = {
      ...bar,
      small_multiples: { ...bar.small_multiples, columns: 2, mode: "per-pane", coordinated_cursor: true },
      section_order: ["Short"],
      section_labels: { Short: "S" },
    };
    expect(errs(spec)).toEqual([HORIZONTAL_FACET_ERROR]);
  });

  it("columns.facet beside columns.section is the same one error", () => {
    expect(errs({ ...bar, columns: { ...bar.columns, section: "m" } })).toEqual([HORIZONTAL_FACET_ERROR]);
  });

  // A `facet` scope on an annotation, marker or overlay is not part of the rename: left in place
  // after it, an annotation's scope is ignored on an unfaceted chart (it draws across every
  // section). So it is still reported, beside the one error.
  const scopedCases: Array<[string, (facet?: string) => object]> = [
    ["annotations.xAxis", (facet) => ({ annotations: { xAxis: [{ x: "15", label: "L", ...(facet ? { facet } : {}) }] } })],
    ["annotations.yAxis", (facet) => ({ annotations: { yAxis: [{ y: 15, label: "L", ...(facet ? { facet } : {}) }] } })],
    ["annotations.points", (facet) => ({ annotations: { points: [{ x: "Q1", y: 15, label: "L", ...(facet ? { facet } : {}) }] } })],
    ["yAxisPolicy.markers", (facet) => ({ yAxisPolicy: { markers: [{ y: 15, label: "L", ...(facet ? { facet } : {}) }] } })],
    ["overlays", (facet) => ({ overlays: [{ method: "lm", ...(facet ? { facet } : {}) }] })],
  ];
  for (const [at, extra] of scopedCases) {
    it(`still reports a facet-scoped ${at} entry`, () => {
      const msg = new RegExp(`${at.replace(".", "\\.")}\\[0\\]\\.facet has no pane to scope to`);
      const e = errs({ ...db, ...extra("Short") });
      expect(e[0]).toBe(HORIZONTAL_FACET_ERROR);
      expect(e.join("\n")).toMatch(msg);
      expect(errs({ ...db, ...extra() }).join("\n")).not.toMatch(msg);
    });
  }

  it("tooltip_section needs columns.section: columns.facet no longer stands in for it", () => {
    expect(errs({ ...db, tooltip_section: true })).toContain(
      "tooltip_section needs columns.section — it names the hovered row's section in the hover card's header",
    );
    expect(validateChart({ ...make(SECTIONED, { chartType: "dumbbell" }), tooltip_section: true }, ROWS).errors).toEqual([]);
  });

  it("leaves a vertical chart's panes alone", () => {
    const vertical = { ...make(FACETED, { chartType: "bar" }), small_multiples: { mode: "per-pane", columns: 2 } };
    const vRows = (["P", "Q"] as const).flatMap((pane) =>
      ["a", "b"].flatMap((cat) => [{ pane, cat, m: "Before", v: "3" }, { pane, cat, m: "After", v: "4" }]),
    ) as unknown as TidyRow[];
    expect(validateChart(vertical, vRows).errors).toEqual([]);
    const host = document.createElement("div");
    mountChart(host, { spec: vertical as ChartSpec, rows: vRows, width: INNER_W });
    expect(host.querySelectorAll(".figure-grid .figure-pane").length).toBe(2);
  });

  it("leaves a vertical dumbbell's panes alone", () => {
    const vertical = { ...make(FACETED, { chartType: "dumbbell", orientation: "vertical" }), small_multiples: { columns: 2 } };
    const vRows = (["P", "Q"] as const).flatMap((pane) =>
      ["a", "b"].flatMap((cat) => [{ pane, cat, m: "Before", v: "3" }, { pane, cat, m: "After", v: "4" }]),
    ) as unknown as TidyRow[];
    expect(validateChart(vertical, vRows).errors).toEqual([]);
    expect(() => renderFigure(vertical as ChartSpec, vRows, { width: 720 })).not.toThrow();
  });
});
