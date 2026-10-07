// @vitest-environment jsdom
//
// Ruling 80: on a horizontal bar, stacked or dumbbell chart (a dumbbell with orientation omitted
// included) `columns.facet` draws no small-multiple panes. Each facet value is a GROUP of the one
// chart's rows, exactly as `columns.section` draws one: `small_multiples.pane_order` orders the
// groups and `pane_titles` titles them. So a faceted horizontal spec renders byte for byte as the
// same spec written with columns.section / section_order / section_labels — standalone, live, PNG
// export and the height model — and validation rejects every setting that only means something for
// panes. Vertical charts keep their panes (their goldens guard that).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { render, renderChart, renderFigure } from "../src/engine/index";
import { mountChart, computeChartHeight } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { validateChart } from "../src/spec/validate";
import { loneBoundWarnings } from "../src/engine/figure";
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

// Two groups with different categories (and one label shared by both), in data order Long, Short;
// pane_order puts Short first.
const ROWS = ([
  ["Long", "Top 1% by net worth"],
  ["Long", "Net worth of $1 billion or more"],
  ["Long", "Q1"],
  ["Short", "Q1"],
  ["Short", "Q2"],
  ["Short", "Q5"],
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

/** The chart SVG of a live mount (the one carrying the category labels). */
const liveSvg = (spec: ChartSpec): { host: HTMLElement; svg: SVGSVGElement } => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mountChart(host, { spec, rows: ROWS, width: INNER_W });
  return { host, svg: host.querySelector("g.tbl-cat-label")!.closest("svg") as SVGSVGElement };
};
const headers = (svg: SVGSVGElement): string[] =>
  Array.from(svg.querySelectorAll('g[font-weight="700"] text')).map((t) => t.textContent ?? "");

describe("a horizontal chart's facets draw as groups, exactly as sections", () => {
  for (const [name, type] of TYPES) {
    describe(name, () => {
      const faceted = make(FACETED, type);
      const sectioned = make(SECTIONED, type);

      it("renderChart and render() draw one chart, identical to the sectioned spec", () => {
        const want = (renderChart(sectioned, ROWS, { width: 720 }).svg as SVGSVGElement).outerHTML;
        expect((renderChart(faceted, ROWS, { width: 720 }).svg as SVGSVGElement).outerHTML).toBe(want);
        const r = render(faceted, ROWS, { width: 720 });
        expect("panes" in r).toBe(false);
        expect(((r as { svg: SVGSVGElement }).svg).outerHTML).toBe(want);
      });

      it("the group titles are the pane titles, in pane_order", () => {
        const svg = renderChart(faceted, ROWS, { width: 720 }).svg as SVGSVGElement;
        expect(headers(svg)).toEqual(expect.arrayContaining(["Short labels", "Long labels"]));
        const ys = (label: string) =>
          Array.from(svg.querySelectorAll('g[font-weight="700"] text')).find((t) => t.textContent === label)!;
        const yOf = (el: Element): number => {
          let y = 0;
          for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
            const m = /translate\(\s*-?[\d.]+[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
            if (m) y += Number(m[1]);
          }
          return y;
        };
        expect(yOf(ys("Short labels"))).toBeLessThan(yOf(ys("Long labels")));
      });

      it("the live mount draws one chart, no pane grid, identical to the sectioned spec", () => {
        const f = liveSvg(faceted);
        const s = liveSvg(sectioned);
        expect(f.host.querySelector(".figure-grid, .figure-pane, .figure-pane-title")).toBeNull();
        expect(f.svg.outerHTML).toBe(s.svg.outerHTML);
        expect(computeChartHeight(faceted, ROWS)).toBe(computeChartHeight(sectioned, ROWS));
      });

      it("the PNG export is the sectioned chart's", () => {
        expect(buildExportSvg(faceted, ROWS).outerHTML).toBe(buildExportSvg(sectioned, ROWS).outerHTML);
      });

      it("columns.facet without small_multiples groups too", () => {
        const { small_multiples: _sm, ...plain } = faceted;
        const { section_order: _o, section_labels: _l, ...plainSectioned } = sectioned;
        expect((renderChart(plain, ROWS, { width: 720 }).svg as SVGSVGElement).outerHTML).toBe(
          (renderChart(plainSectioned, ROWS, { width: 720 }).svg as SVGSVGElement).outerHTML,
        );
        expect(validateChart(plain, ROWS)).toEqual({ valid: true, errors: [] });
      });

      it("pane_order leaves out a group it does not list, as section_order does", () => {
        const f = { ...faceted, small_multiples: { ...faceted.small_multiples, pane_order: ["Long"] } } as ChartSpec;
        const s = { ...sectioned, section_order: ["Long"] } as ChartSpec;
        const svg = renderChart(f, ROWS, { width: 720 }).svg as SVGSVGElement;
        expect(svg.outerHTML).toBe((renderChart(s, ROWS, { width: 720 }).svg as SVGSVGElement).outerHTML);
        expect(headers(svg)).not.toContain("Short labels");
      });

      it("legendPosition: right is honoured, as on the sectioned chart (it is not a figure)", () => {
        const host = (spec: ChartSpec): HTMLElement => {
          const c = document.createElement("div");
          document.body.appendChild(c);
          mountChart(c, { spec: { ...spec, legendPosition: "right" } as ChartSpec, rows: ROWS, width: INNER_W });
          return c;
        };
        const f = host(faceted);
        expect(f.querySelector(".figure-body--legend-right")).not.toBeNull();
        expect(f.innerHTML).toBe(host(sectioned).innerHTML);
      });

      it("a lone yAxisPolicy bound past the data is warned about once, for the one axis", () => {
        const spec = { ...faceted, yAxisPolicy: { min: 1000 } } as ChartSpec;
        expect(loneBoundWarnings(spec, ROWS)).toEqual(["yAxisPolicy.min (1000) is above every value in the data"]);
      });

      it("renderFigure refuses it, pointing at renderChart", () => {
        expect(() => renderFigure(faceted, ROWS, { width: 720 })).toThrow(/draws columns\.facet as groups/);
      });

      it("validates, with groups whose categories differ", () => {
        expect(validateChart(faceted, ROWS)).toEqual({ valid: true, errors: [] });
        // Columns unset (the default grid would have put panes side by side): still groups.
        const noCols = { ...faceted, small_multiples: { pane_order: ["Short", "Long"] } } as ChartSpec;
        expect(validateChart(noCols, ROWS)).toEqual({ valid: true, errors: [] });
      });
    });
  }
});

describe("validation: settings that only mean something for panes", () => {
  const bar = make(FACETED, { chartType: "bar", orientation: "horizontal" });
  const db = make(FACETED, { chartType: "dumbbell" });
  const errs = (spec: object): string[] => validateChart(spec, ROWS).errors;
  const sm = (extra: object) => ({ ...bar, small_multiples: { ...bar.small_multiples, ...extra } });

  it("rejects columns.facet with columns.section", () => {
    const both = { ...bar, columns: { ...bar.columns, section: "m" } };
    expect(errs(both).join("\n")).toMatch(/columns\.facet and columns\.section are both set/);
    expect(() => renderChart(both as ChartSpec, ROWS)).toThrow(/columns\.facet and columns\.section are both set/);
    expect(() => render(both as ChartSpec, ROWS)).toThrow(/columns\.facet and columns\.section are both set/);
    expect(() => mountChart(document.createElement("div"), { spec: both as ChartSpec, rows: ROWS, width: INNER_W })).toThrow(
      /columns\.facet and columns\.section are both set/,
    );
    expect(() => buildExportSvg(both as ChartSpec, ROWS)).toThrow(/columns\.facet and columns\.section are both set/);
  });
  it("rejects small_multiples.columns > 1, but accepts 1", () => {
    expect(errs(sm({ columns: 2 })).join("\n")).toMatch(/small_multiples\.columns 2 has no effect.*groups/);
    expect(errs(sm({ columns: 1 }))).toEqual([]);
  });
  it("rejects mode: per-pane, accepts shared", () => {
    expect(errs(sm({ mode: "per-pane" })).join("\n")).toMatch(/small_multiples\.mode "per-pane" has no effect/);
    expect(errs(sm({ mode: "shared" }))).toEqual([]);
  });
  it("rejects pane_widths and coordinated_cursor", () => {
    expect(errs(sm({ pane_widths: "equal-bar" })).join("\n")).toMatch(/small_multiples\.pane_widths has no effect/);
    expect(errs(sm({ coordinated_cursor: false })).join("\n")).toMatch(/small_multiples\.coordinated_cursor has no effect/);
  });
  it("rejects section_order / section_labels beside columns.facet, pointing at pane_order / pane_titles", () => {
    expect(errs({ ...bar, section_order: ["Short"] }).join("\n")).toMatch(/section_order applies to columns\.section.*small_multiples\.pane_order/);
    expect(errs({ ...bar, section_labels: { Short: "S" } }).join("\n")).toMatch(/section_labels applies to columns\.section.*small_multiples\.pane_titles/);
  });
  it("rejects a facet-scoped value-axis marker", () => {
    const spec = { ...db, annotations: { xAxis: [{ x: "15", label: "L", facet: "Short" }] } };
    expect(errs(spec).join("\n")).toMatch(/annotations\.xAxis\[0\]\.facet has no pane to scope to/);
    expect(errs({ ...db, annotations: { xAxis: [{ x: "15", label: "L" }] } })).toEqual([]);
  });
  // The other scoped lists. annotations.yAxis and yAxisPolicy.markers are rejected on a horizontal
  // chart anyway (value axis is x), and an overlay may be refused for the chart type, so each case
  // asserts the facet-scope message itself, and its absence without the `facet` key.
  const scopedCases: Array<[string, (facet?: string) => object]> = [
    ["annotations.yAxis", (facet) => ({ annotations: { yAxis: [{ y: 15, label: "L", ...(facet ? { facet } : {}) }] } })],
    ["annotations.points", (facet) => ({ annotations: { points: [{ x: "Q1", y: 15, label: "L", ...(facet ? { facet } : {}) }] } })],
    ["yAxisPolicy.markers", (facet) => ({ yAxisPolicy: { markers: [{ y: 15, label: "L", ...(facet ? { facet } : {}) }] } })],
    ["overlays", (facet) => ({ overlays: [{ method: "lm", ...(facet ? { facet } : {}) }] })],
  ];
  for (const [at, extra] of scopedCases) {
    it(`rejects a facet-scoped ${at} entry`, () => {
      const msg = new RegExp(`${at.replace(".", "\\.")}\\[0\\]\\.facet has no pane to scope to`);
      expect(errs({ ...db, ...extra("Short") }).join("\n")).toMatch(msg);
      expect(errs({ ...db, ...extra() }).join("\n")).not.toMatch(msg);
    });
  }
  it("rejects coordinated_cursor even at its default true", () => {
    expect(errs(sm({ coordinated_cursor: true })).join("\n")).toMatch(/small_multiples\.coordinated_cursor has no effect/);
  });
  it("accepts tooltip_section: the facets are the sections", () => {
    expect(errs({ ...db, tooltip_section: true })).toEqual([]);
  });
  it("rejects two values for one facet + category + series", () => {
    const dup = [...ROWS, { pane: "Short", cat: "Q2", m: "After", v: "99" }] as unknown as TidyRow[];
    expect(validateChart(bar, dup).errors.join("\n")).toMatch(/category "Q2" in facet "Short" has more than one "After" value/);
  });
  it("leaves a vertical chart's panes alone", () => {
    const vertical = { ...make(FACETED, { chartType: "bar" }), small_multiples: { mode: "per-pane", columns: 2 } };
    const vRows = (["P", "Q"] as const).flatMap((pane) =>
      ["a", "b"].flatMap((cat) => [{ pane, cat, m: "Before", v: "3" }, { pane, cat, m: "After", v: "4" }]),
    ) as unknown as TidyRow[];
    expect(validateChart(vertical, vRows).errors).toEqual([]);
    expect("panes" in render(vertical as ChartSpec, vRows, { width: 720 })).toBe(true);
  });
});
