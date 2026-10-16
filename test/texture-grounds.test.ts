// @vitest-environment jsdom
//
// A `series_patterns` texture is laid over whatever colour its mark is PAINTED, and that colour has to
// be one the engine can read (color-ref.ts `isReadableColor`) or `resolveHatch` throws at render.
// `series_colors` was the only ground validation checked; `bar_color` on a named series,
// `category_colors`, `waterfall.colors` and the title-selector accent each override the fill without
// going through it, so each validated clean and then threw (T3.2, review 2026-10-15).
//
// The rule is to reject such a colour ONLY where a texture is actually laid over it: an unreadable
// colour renders fine untextured, so a spec in which no textured mark is painted with it must keep
// validating. Every case below is therefore checked against the renderer as well as the validator —
// the rejected ones throw in the real pipeline (the PNG export, which renders small multiples and
// resolves the title selector), and their nearest valid neighbours draw.
import { describe, it, expect } from "vitest";
import { validateChart } from "../src/spec/validate";
import { buildExportSvg } from "../src/embed/export-png";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BAD = "oklch(0.6 0.1 200)";
const spec = (s: Record<string, unknown>): ChartSpec =>
  ({ title: "t", xAxisType: "categorical", data: "d.csv", ...s }) as unknown as ChartSpec;
const rows = (r: Array<Record<string, string>>): TidyRow[] => r as unknown as TidyRow[];

const ONE = rows([{ time: "A", value: "6" }, { time: "B", value: "-3" }]);
const UP = rows([{ time: "A", s: "Up", value: "6" }, { time: "B", s: "Up", value: "3" }]);
const UP_DN = rows([{ time: "A", s: "Up", value: "6" }, { time: "A", s: "Dn", value: "3" }]);
const NUMERIC = rows([{ time: "1", value: "6" }, { time: "2", value: "3" }]);
const HIST_UP = rows([{ time: "1", s: "Up" }, { time: "2", s: "Up" }, { time: "4", s: "Up" }]);
const HIST_UP_DN = rows([{ time: "1", s: "Up" }, { time: "2", s: "Dn" }, { time: "4", s: "Up" }]);
/** Two panes, one series in each. */
const PANES = rows([{ time: "A", s: "Up", f: "P", value: "6" }, { time: "A", s: "Dn", f: "Q", value: "3" }]);
const SERIES = { x: "time", value: "value", series: "s" };
const SELECT = (color: string) => ({
  title: "t {k}",
  title_selectors: { k: { options: [{ id: "a" }, { id: "b", color }] } },
});

interface Case {
  name: string;
  spec: ChartSpec;
  rows: TidyRow[];
  selections?: Record<string, string>;
}

const ALWAYS = { title: "t {k}", title_selectors: { k: { options: [{ id: "a", color: "amber" }, { id: "b", color: "red" }] } } };
/** An unreadable base colour under a selector whose every option has a colour. */
const ALWAYS_ACCENTED: Case[] = [
  {
    name: "bar_color when every title-selector option has a color",
    spec: spec({ chartType: "bar", columns: SERIES, bar_color: BAD, series_patterns: { Up: "/" }, ...ALWAYS }),
    rows: UP,
  },
  {
    name: "an unreadable series_colors entry under an always-coloured selector, with no bar_color",
    spec: spec({ chartType: "bar", series_colors: { "": BAD }, series_patterns: { "": "/" }, ...ALWAYS }),
    rows: ONE,
  },
  {
    name: "an unreadable series_colors entry under an always-coloured selector, on a single-series stack",
    spec: spec({ chartType: "stacked", series_colors: { "": BAD }, series_patterns: { "": "/" }, ...ALWAYS }),
    rows: ONE,
  },
  {
    name: "an unreadable series_colors entry under an always-coloured selector, on a single-series area",
    spec: spec({ chartType: "area", xAxisType: "numeric", series_colors: { "": BAD }, series_patterns: { "": "/" }, ...ALWAYS }),
    rows: NUMERIC,
  },
  {
    name: "an unreadable series_colors entry under an always-coloured selector, on a single-series histogram",
    spec: spec({ chartType: "histogram", xAxisType: "numeric", columns: { x: "time" }, series_colors: { "": BAD }, series_patterns: { "": "/" }, ...ALWAYS }),
    rows: NUMERIC,
  },
  {
    name: "bar_color under an always-coloured selector, in small-multiples panes that hold one series each",
    spec: spec({ chartType: "bar", columns: { ...SERIES, facet: "f" }, small_multiples: {}, bar_color: BAD, series_patterns: { Up: "/" }, ...ALWAYS }),
    rows: PANES,
  },
  {
    name: "category_colors \"none\" over an unreadable series_colors entry, on a waterfall under an always-coloured selector",
    spec: spec({ chartType: "waterfall", category_colors: { A: "none" }, series_colors: { "": BAD }, series_patterns: { "": "/" }, ...ALWAYS }),
    rows: ONE,
  },
];
const draw = (c: Case): void => {
  buildExportSvg(c.spec, c.rows, c.selections ? { selections: c.selections } : {});
};

/** Rejected: names the field and the series, and the renderer really does throw. */
const REJECTED: Array<Case & { field: string; series: string }> = [
  {
    name: "bar_color on a bar chart whose one series is named",
    spec: spec({ chartType: "bar", columns: SERIES, bar_color: BAD, series_patterns: { Up: "/" } }),
    rows: UP, field: "bar_color", series: "Up",
  },
  {
    name: "bar_color beside a readable series_colors[\"\"], which it overrides",
    spec: spec({ chartType: "bar", series_colors: { "": "blue" }, bar_color: BAD, series_patterns: { "": "/" } }),
    rows: ONE, field: "bar_color", series: "",
  },
  {
    name: "bar_color in a small-multiples pane that holds one series",
    spec: spec({ chartType: "bar", columns: { ...SERIES, facet: "f" }, small_multiples: {}, bar_color: BAD, series_patterns: { Up: "/" } }),
    rows: PANES, field: "bar_color", series: "Up",
  },
  {
    name: "bar_color on a histogram whose one series is named",
    spec: spec({ chartType: "histogram", xAxisType: "numeric", columns: { x: "time", series: "s" }, bar_color: BAD, series_patterns: { Up: "/" } }),
    rows: HIST_UP, field: "bar_color", series: "Up",
  },
  {
    name: "category_colors on a textured bar",
    spec: spec({ chartType: "bar", category_colors: { A: BAD }, series_patterns: { "": "/" } }),
    rows: ONE, field: 'category_colors["A"]', series: "",
  },
  {
    name: "waterfall.colors.decrease, with a decrease step",
    spec: spec({ chartType: "waterfall", waterfall: { colors: { decrease: BAD } }, series_patterns: { "": "/" } }),
    rows: ONE, field: "waterfall.colors.decrease", series: "",
  },
  {
    name: "waterfall.colors.total, with a total step",
    spec: spec({ chartType: "waterfall", columns: { x: "time", value: "value", kind: "k" }, waterfall: { colors: { total: BAD } }, series_patterns: { "": "/" } }),
    rows: rows([{ time: "A", k: "", value: "6" }, { time: "T", k: "total", value: "" }]),
    field: "waterfall.colors.total", series: "",
  },
  {
    name: "category_colors on a waterfall step",
    spec: spec({ chartType: "waterfall", category_colors: { B: BAD }, series_patterns: { "": "/" } }),
    rows: ONE, field: 'category_colors["B"]', series: "",
  },
  ...(["bar", "stacked"] as const).map((chartType) => ({
    name: `a title-selector option's color on a single-series ${chartType}`,
    spec: spec({ chartType, ...SELECT(BAD), series_patterns: { "": "/" } }),
    rows: ONE, selections: { k: "b" }, field: "title_selectors.k.options[1].color", series: "",
  })),
  {
    name: "a title-selector option's color on a single-series area",
    spec: spec({ chartType: "area", xAxisType: "numeric", ...SELECT(BAD), series_patterns: { "": "/" } }),
    rows: NUMERIC, selections: { k: "b" }, field: "title_selectors.k.options[1].color", series: "",
  },
  {
    name: "a title-selector option's color on a single-series histogram",
    spec: spec({ chartType: "histogram", xAxisType: "numeric", columns: { x: "time" }, ...SELECT(BAD), series_patterns: { "": "/" } }),
    rows: NUMERIC, selections: { k: "b" }, field: "title_selectors.k.options[1].color", series: "",
  },
  {
    name: "a title-selector option colored through series_colors, in a pane holding another series",
    spec: spec({
      chartType: "bar", columns: { ...SERIES, facet: "f" }, small_multiples: {},
      title: "t {k}", title_selectors: { k: { options: [{ id: "Dn" }] } },
      series_colors: { Dn: BAD }, series_patterns: { Up: "/" },
    }),
    rows: PANES, field: 'series_colors["Dn"]', series: "Up",
  },
  {
    // A histogram's bar_color wins over the accent, so an always-coloured selector does not cover it.
    name: "bar_color on a single-series histogram under an always-coloured selector",
    spec: spec({ chartType: "histogram", xAxisType: "numeric", columns: { x: "time" }, bar_color: BAD, series_patterns: { "": "/" }, ...ALWAYS }),
    rows: NUMERIC, field: "bar_color", series: "",
  },
  {
    name: "a comma-form rgb() with fractional channels, which CSS paints and d3 cannot read",
    spec: spec({ chartType: "bar", bar_color: "rgb(0.5, 114, 178)", series_patterns: { "": "/" } }),
    rows: ONE, field: "bar_color", series: "",
  },
  {
    name: "an unreadable series_colors entry on a textured single-series bar",
    spec: spec({ chartType: "bar", series_colors: { "": BAD }, series_patterns: { "": "/" } }),
    rows: ONE, field: 'series_colors[""]', series: "",
  },
  {
    name: "an unreadable series_colors entry on a textured multi-series stack",
    spec: spec({ chartType: "stacked", columns: SERIES, series_colors: { Up: BAD }, series_patterns: { Up: "/" } }),
    rows: UP_DN, field: 'series_colors["Up"]', series: "Up",
  },
  {
    // `none` sends the hatch back to the series colour map, so THAT is the ground.
    name: "category_colors \"none\" over an unreadable series_colors entry",
    spec: spec({ chartType: "bar", category_colors: { A: "none" }, series_colors: { "": BAD }, series_patterns: { "": "/" } }),
    rows: ONE, field: 'series_colors[""]', series: "",
  },
  {
    name: "series_colors \"none\" itself, which the fallback finds again",
    spec: spec({ chartType: "bar", series_colors: { "": "none" }, series_patterns: { "": "/" } }),
    rows: ONE, field: 'series_colors[""]', series: "",
  },
  {
    name: "a later selector's color, reachable because the first selector leaves an option uncoloured",
    spec: spec({
      chartType: "bar", series_patterns: { "": "/" }, title: "t {k1} {k2}",
      title_selectors: { k1: { options: [{ id: "a", color: "red" }, { id: "b" }] }, k2: { options: [{ id: "c", color: BAD }] } },
    }),
    rows: ONE, selections: { k1: "b", k2: "c" }, field: "title_selectors.k2.options[0].color", series: "",
  },
];

/** Still valid: the unreadable colour is never painted under a texture, so the chart draws. */
const STILL_VALID: Case[] = [
  // A selector that colours every option always paints the accent over a single series, in the
  // PNG export's legend pass as in its final pass and live (A1, fixed in phase 5). Before that fix
  // the export's legend pass painted the base colour and threw, so both of these were rejected.
  ...ALWAYS_ACCENTED,
  {
    name: "bar_color on a multi-series bar, where it is not painted",
    spec: spec({ chartType: "bar", columns: SERIES, bar_color: BAD, series_patterns: { Up: "/", Dn: "\\" } }),
    rows: UP_DN,
  },
  {
    name: "bar_color on a multi-series histogram",
    spec: spec({ chartType: "histogram", xAxisType: "numeric", columns: { x: "time", series: "s" }, bar_color: BAD, series_patterns: { Up: "/" } }),
    rows: HIST_UP_DN,
  },
  {
    name: "bar_color when category_colors paints every category",
    spec: spec({ chartType: "bar", columns: SERIES, category_colors: { A: "blue", B: "red" }, bar_color: BAD, series_patterns: { Up: "/" } }),
    rows: UP,
  },
  {
    name: "bar_color on a pane whose one series highlightSeries dims",
    spec: spec({ chartType: "bar", columns: { ...SERIES, facet: "f" }, small_multiples: {}, highlightSeries: ["Dn"], bar_color: BAD, series_patterns: { Up: "/" } }),
    rows: PANES,
  },
  {
    name: "a title-selector accent on a histogram whose bar_color wins over it",
    spec: spec({ chartType: "histogram", xAxisType: "numeric", columns: { x: "time" }, bar_color: "amber", ...SELECT(BAD), series_patterns: { "": "/" } }),
    rows: NUMERIC, selections: { k: "b" },
  },
  {
    name: "a title-selector accent on a multi-series bar, which keeps its palette",
    spec: spec({ chartType: "bar", columns: SERIES, ...SELECT(BAD), series_patterns: { Up: "/" } }),
    rows: UP_DN, selections: { k: "b" },
  },
  {
    name: "a title-selector accent on a waterfall, which does not take it",
    spec: spec({ chartType: "waterfall", ...SELECT(BAD), series_patterns: { "": "/" } }),
    rows: ONE, selections: { k: "b" },
  },
  {
    name: "a title-selector accent on a mono stack, which does not take it",
    spec: spec({ chartType: "stacked", barStack: { mono: { base: "blue" } }, ...SELECT(BAD), series_patterns: { "": "/" } }),
    rows: ONE, selections: { k: "b" },
  },
  {
    name: "waterfall.colors.total with no total step",
    spec: spec({ chartType: "waterfall", waterfall: { colors: { total: BAD } }, series_patterns: { "": "/" } }),
    rows: ONE,
  },
  {
    name: "waterfall.colors.decrease with no decrease step",
    spec: spec({ chartType: "waterfall", waterfall: { colors: { decrease: BAD } }, series_patterns: { "": "/" } }),
    rows: rows([{ time: "A", value: "6" }, { time: "B", value: "" }]),
  },
  {
    name: "category_colors on a waterfall's skip step, which is not painted",
    spec: spec({ chartType: "waterfall", columns: { x: "time", value: "value", kind: "k" }, category_colors: { S: BAD }, series_patterns: { "": "/" } }),
    rows: rows([{ time: "A", k: "", value: "6" }, { time: "S", k: "skip", value: "" }]),
  },
  // `paintedFill` (engine/painted-fill.ts) skips a `none` fill, so the hatch is grounded on the series
  // colour map instead and renders textured.
  {
    name: "category_colors \"none\" on a textured bar",
    spec: spec({ chartType: "bar", category_colors: { A: "none" }, series_patterns: { "": "/" } }),
    rows: ONE,
  },
  {
    name: "bar_color \"none\" on a textured bar",
    spec: spec({ chartType: "bar", bar_color: "none", series_patterns: { "": "/" } }),
    rows: ONE,
  },
  {
    name: "bar_color \"none\" on a textured histogram",
    spec: spec({ chartType: "histogram", xAxisType: "numeric", columns: { x: "time" }, bar_color: "none", series_patterns: { "": "/" } }),
    rows: NUMERIC,
  },
  {
    name: "waterfall.colors \"none\" and category_colors \"none\" on a textured waterfall",
    spec: spec({ chartType: "waterfall", waterfall: { colors: { increase: "none" } }, category_colors: { B: "none" }, series_patterns: { "": "/" } }),
    rows: ONE,
  },
  {
    name: "every rejected colour above, readable",
    spec: spec({ chartType: "bar", columns: SERIES, bar_color: "rgb(0,114,178)", category_colors: { A: "#aabbcc" }, series_patterns: { Up: "/" } }),
    rows: UP,
  },
  {
    name: "an unreadable series_colors entry that bar_color overrides (single-series bar)",
    spec: spec({ chartType: "bar", series_colors: { "": "rgb(0.5,114,178)" }, bar_color: "blue", series_patterns: { "": "/" } }),
    rows: ONE,
  },
  {
    name: "an unreadable series_colors entry that bar_color overrides (single-series histogram)",
    spec: spec({ chartType: "histogram", xAxisType: "numeric", columns: { x: "time" }, series_colors: { "": BAD }, bar_color: "blue", series_patterns: { "": "/" } }),
    rows: NUMERIC,
  },
  {
    name: "an unreadable series_colors entry under category_colors on every category",
    spec: spec({ chartType: "bar", series_colors: { "": BAD }, category_colors: { A: "blue", B: "red" }, series_patterns: { "": "/" } }),
    rows: ONE,
  },
  {
    name: "an unreadable series_colors entry on a dimmed series of a multi-series bar",
    spec: spec({ chartType: "bar", columns: SERIES, highlightSeries: ["Dn"], series_colors: { Up: BAD }, series_patterns: { Up: "/" } }),
    rows: UP_DN,
  },
  {
    name: "an unreadable series_colors entry on a dimmed series of a multi-series stack",
    spec: spec({ chartType: "stacked", columns: SERIES, highlightSeries: ["Dn"], series_colors: { Up: BAD }, series_patterns: { Up: "/" } }),
    rows: UP_DN,
  },
  {
    name: "an unreadable series_colors entry on a mono stack, which paints tonal tiers",
    spec: spec({ chartType: "stacked", barStack: { mono: { base: "blue" } }, series_colors: { "": BAD }, series_patterns: { "": "/" } }),
    rows: ONE,
  },
  {
    name: "an unreadable series_colors entry on a waterfall, which paints waterfall.colors",
    spec: spec({ chartType: "waterfall", series_colors: { "": BAD }, series_patterns: { "": "/" } }),
    rows: ONE,
  },
  ...(["stacked", "waterfall"] as const).map((chartType) => ({
    name: `an unreadable bar_color on a ${chartType}, which never paints it`,
    spec: spec({ chartType, bar_color: BAD, series_patterns: { "": "/" } }),
    rows: ONE,
  })),
  {
    name: "an unreadable bar_color on an area, which never paints it",
    spec: spec({ chartType: "area", xAxisType: "numeric", bar_color: BAD, series_patterns: { "": "/" } }),
    rows: NUMERIC,
  },
  ...[{ k1: "a", k2: "c" }, { k1: "b", k2: "c" }].map((selections) => ({
    name: `a later selector's color when the first selector colours every option (${selections.k1})`,
    spec: spec({
      chartType: "bar", series_patterns: { "": "/" }, title: "t {k1} {k2}",
      title_selectors: { k1: { options: [{ id: "a", color: "red" }, { id: "b", color: "amber" }] }, k2: { options: [{ id: "c", color: BAD }] } },
    }),
    rows: ONE, selections,
  })),
];

describe("a texture over an unreadable colour is rejected where the texture is laid", () => {
  for (const c of REJECTED) {
    it(c.name, () => {
      const v = validateChart(c.spec, c.rows);
      expect(v.valid).toBe(false);
      expect(v.errors.length).toBe(1);
      expect(v.errors[0]).toContain(`${c.field}: `);
      expect(v.errors[0]).toContain("cannot carry a `series_patterns` texture");
      expect(v.errors[0]).toContain(`series ${JSON.stringify(c.series)}`);
      expect(() => draw(c), "the renderer throws on it too").toThrow(/cannot derive a hatch band/);
    });
  }
});

describe("the message says which forms are readable", () => {
  it("names the whole-number channels and the unitless hue a fractional rgb() or a deg hue lacks", () => {
    for (const c of ["rgb(0.5, 114, 178)", "hsl(200deg, 50%, 40%)"]) {
      const err = validateChart(spec({ chartType: "bar", bar_color: c, series_patterns: { "": "/" } }), ONE).errors.join(" ");
      expect(err, c).toContain("comma-separated rgb() with whole-number or all-percentage channels");
      expect(err, c).toContain("comma-separated hsl() with a unitless hue");
    }
  });
});

describe("and only there: a spec that draws still validates", () => {
  for (const c of STILL_VALID) {
    it(c.name, () => {
      expect(validateChart(c.spec, c.rows).errors).toEqual([]);
      expect(() => draw(c)).not.toThrow();
    });
  }
});

describe("a \"none\" override is textured over the series colour", () => {
  it("the export draws a hatch for each", () => {
    for (const c of STILL_VALID.filter((v) => v.name.includes("\"none\""))) {
      const svg = buildExportSvg(c.spec, c.rows, c.selections ? { selections: c.selections } : {});
      expect(svg.querySelectorAll('pattern[id^="tblhatch-"]').length, c.name).toBeGreaterThan(0);
    }
  });
});

describe("an always-coloured selector paints the accent under every selection", () => {
  const ids = ALWAYS.title_selectors.k.options.map((o) => o.id);
  for (const c of ALWAYS_ACCENTED) {
    it(`${c.name}: the export draws under each option (${ids.join(", ")})`, () => {
      for (const id of ids) {
        expect(() => buildExportSvg(c.spec, c.rows, { selections: { k: id } }), id).not.toThrow();
      }
    });
  }
});

describe("an always-coloured selector over an unreadable base colour, live", () => {
  // The live mount renders once without drawing to read the legend rows its position depends on.
  // That pass must take the accent as well, or it throws on the unpainted base colour, its error is
  // swallowed, and the legend is placed as if it had no rows: on top live, on the right in the PNG.
  it("places the legend where the PNG does", () => {
    const right = spec({
      chartType: "bar", bar_color: BAD, series_patterns: { "": "/" }, legendPosition: "right", ...ALWAYS,
      annotations: { yAxis: [{ y: 3, label: "Threshold", legend: true }] },
    });
    expect(validateChart(right, ONE).errors).toEqual([]);
    const host = document.createElement("div");
    document.body.append(host);
    try {
      mountChart(host, { spec: right, rows: ONE, width: 920 });
      expect(host.querySelector(".figure-legend-slot--right .tbl-legend-item")?.textContent).toContain("Threshold");
      const png = buildExportSvg(right, ONE);
      const plot = png.querySelector("svg.tblchart")!;
      expect(Number(plot.getAttribute("width"))).toBeLessThan(920);
    } finally {
      host.remove();
    }
  });
});
