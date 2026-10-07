// @vitest-environment jsdom
//
// `section_order` is an inclusion filter: a section it leaves out is not drawn. Its rows must not be
// inspected by anything else either — net-mode detection, the value domain, axis fitting, the
// height — or a hidden section reshapes the visible chart. Each case renders the same chart twice,
// once with the excluded section's rows present and once with them removed, and requires the two to
// be identical (live SVG, height, PNG export).
//
// Also: the faceted ragged-pane check compares section + category, so a pane that carries a
// category under a different section than its sibling is rejected.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { computeChartHeight, mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { validateChartData } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const base = {
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  section_order: ["First"],
  data: "d.csv",
};
const STACKED = {
  ...base,
  chartType: "stacked",
  columns: { x: "bar", series: "tax", value: "v", section: "sec" },
  series_order: ["Income", "Gains"],
} as ChartSpec;
const BAR = { ...STACKED, chartType: "bar" } as ChartSpec;
const BAR_SINGLE = { ...base, chartType: "bar", columns: { x: "bar", value: "v", section: "sec" } } as ChartSpec;
const DUMBBELL = { ...STACKED, chartType: "dumbbell" } as ChartSpec;

// Codex's repro: the visible stack is all positive; the hidden one has a large negative.
const VISIBLE = [
  { sec: "First", bar: "A", tax: "Income", v: "10" },
  { sec: "First", bar: "A", tax: "Gains", v: "10" },
  { sec: "First", bar: "C", tax: "Income", v: "4" },
  { sec: "First", bar: "C", tax: "Gains", v: "6" },
] as TidyRow[];
const HIDDEN = [
  { sec: "Second", bar: "B", tax: "Income", v: "-2000" },
  { sec: "Second", bar: "B", tax: "Gains", v: "10" },
  { sec: "Second", bar: "D", tax: "Income", v: "900" },
  { sec: "Second", bar: "D", tax: "Gains", v: "5" },
] as TidyRow[];
// Enough hidden rows that counting them would lift the height off its 400px floor.
const MANY_HIDDEN = Array.from({ length: 30 }, (_, i) =>
  ["Income", "Gains"].map((tax) => ({ sec: "Second", bar: `Hidden ${i}`, tax, v: "1" })),
).flat() as TidyRow[];
// Interleaved, so neither section is simply a prefix of the data.
const WITH_HIDDEN = [
  VISIBLE[0]!, HIDDEN[0]!, VISIBLE[1]!, HIDDEN[1]!, VISIBLE[2]!, HIDDEN[2]!, VISIBLE[3]!, HIDDEN[3]!, ...MANY_HIDDEN,
];
const single = (rows: TidyRow[]) => rows.filter((r) => r.tax === "Income");

const cases: Array<[string, ChartSpec, TidyRow[], TidyRow[]]> = [
  ["stacked", STACKED, WITH_HIDDEN, VISIBLE],
  ["grouped bar", BAR, WITH_HIDDEN, VISIBLE],
  ["single-series bar", BAR_SINGLE, single(WITH_HIDDEN), single(VISIBLE)],
  ["dumbbell", DUMBBELL, WITH_HIDDEN, VISIBLE],
];

describe("section_order: rows of an excluded section reach nothing", () => {
  for (const [name, spec, withHidden, visible] of cases) {
    it(`${name}: the live SVG and the height equal the chart without those rows`, () => {
      const h = computeChartHeight(spec, visible);
      expect(computeChartHeight(spec, withHidden)).toBe(h);
      const a = renderChart(spec, withHidden, { width: 720, height: h, document }).svg.outerHTML;
      const b = renderChart(spec, visible, { width: 720, height: h, document }).svg.outerHTML;
      expect(a).toBe(b);
    });

    it(`${name}: the live mount (legend placement included) equals the chart without those rows`, () => {
      const mounted = (rows: TidyRow[]): string => {
        document.body.innerHTML = "";
        const c = document.createElement("div");
        document.body.appendChild(c);
        mountChart(c, { spec, rows, width: 720 });
        return c.innerHTML;
      };
      expect(mounted(withHidden)).toBe(mounted(visible));
    });

    it(`${name}: the PNG export equals the chart without those rows`, () => {
      expect(buildExportSvg(spec, withHidden).outerHTML).toBe(buildExportSvg(spec, visible).outerHTML);
    });
  }

  it("small multiples: every pane equals the figure without those rows", () => {
    const spec = {
      ...STACKED,
      columns: { ...STACKED.columns, facet: "pane" },
      small_multiples: { columns: 2, pane_order: ["P", "Q"] },
    } as ChartSpec;
    const inPanes = (rows: TidyRow[]) => ["P", "Q"].flatMap((pane) => rows.map((r) => ({ ...r, pane }))) as TidyRow[];
    const panes = (rows: TidyRow[]) =>
      renderFigure(spec, inPanes(rows), { width: 900, document }).panes.map((p) => (p.svg as SVGSVGElement).outerHTML);
    expect(panes(WITH_HIDDEN)).toEqual(panes(VISIBLE));
  });

  it("stacked: the visible all-positive stack gets net text, no net dot, and full-width segments", () => {
    const svg = renderChart(STACKED, WITH_HIDDEN, { width: 720, height: 400, document }).svg;
    expect(svg.querySelectorAll("g.tbl-net-marker circle").length).toBe(0);
    const widths = Array.from(svg.querySelectorAll('g[aria-label="bar"] rect')).map((r) => Number(r.getAttribute("width")));
    expect(Math.min(...widths)).toBeGreaterThan(50);
  });
});

describe("faceted ragged check: panes are compared by section + category", () => {
  // Codex's repro: pane Q carries B under "First", pane P under "Second".
  const rows = [
    { pane: "P", sec: "First", bar: "A", v: "10" },
    { pane: "P", sec: "Second", bar: "B", v: "20" },
    { pane: "Q", sec: "First", bar: "A", v: "10" },
    { pane: "Q", sec: "First", bar: "B", v: "20" },
  ] as TidyRow[];
  for (const chartType of ["stacked", "bar"] as const) {
    it(`${chartType}: rejected, naming the missing section + category`, () => {
      const spec = {
        ...base,
        section_order: undefined,
        chartType,
        columns: { x: "bar", value: "v", section: "sec", facet: "pane" },
        small_multiples: { columns: 2 },
      } as ChartSpec;
      const msg = validateChartData(spec, rows).errors.join("\n");
      expect(msg).toMatch(/facet "Q" is missing category "B" \(section "Second"\)/);
      expect(msg).toMatch(/facet "P" is missing category "B" \(section "First"\)/);
    });
  }
});

describe("section_order: validation reads only the sections it keeps", () => {
  const fig = (chartType: "stacked" | "bar") =>
    ({
      ...base,
      section_order: ["Keep"],
      chartType,
      columns: { x: "bar", value: "v", section: "sec", facet: "pane" },
      small_multiples: { columns: 2 },
    }) as ChartSpec;
  for (const chartType of ["stacked", "bar"] as const) {
    it(`${chartType}: a category only one pane carries, in an excluded section, is not a ragged pane`, () => {
      const rows = [
        { pane: "P", sec: "Keep", bar: "A", v: "10" },
        { pane: "P", sec: "Drop", bar: "B", v: "20" },
        { pane: "Q", sec: "Keep", bar: "A", v: "10" },
      ] as TidyRow[];
      expect(validateChartData(fig(chartType), rows).errors).toEqual([]);
      // Control: with the section drawn, the same rows are ragged.
      const drawn = { ...fig(chartType), section_order: ["Keep", "Drop"] } as ChartSpec;
      expect(validateChartData(drawn, rows).errors.join("\n")).toMatch(/facet "Q" is missing category "B" \(section "Drop"\)/);
    });
  }

  it("a duplicate section + category + series in an excluded section is not an error", () => {
    const spec = { ...STACKED, section_order: ["Keep"], series_order: undefined } as ChartSpec;
    const rows = [
      { sec: "Keep", bar: "A", tax: "Income", v: "1" },
      { sec: "Drop", bar: "B", tax: "Income", v: "2" },
      { sec: "Drop", bar: "B", tax: "Income", v: "3" },
    ] as TidyRow[];
    expect(validateChartData(spec, rows).errors).toEqual([]);
    const drawn = { ...spec, section_order: ["Keep", "Drop"] } as ChartSpec;
    expect(validateChartData(drawn, rows).errors.join("\n")).toMatch(/category "B" in section "Drop" has more than one "Income" value/);
  });
});

describe("section_order: a pane holding only excluded rows does not widen the live grid", () => {
  it("the mounted figure equals the figure without that pane", () => {
    const spec = {
      ...BAR_SINGLE,
      section_order: ["Keep"],
      columns: { x: "bar", value: "v", section: "sec", facet: "pane" },
      small_multiples: { columns: 2 },
    } as ChartSpec;
    const keep = [{ pane: "P", sec: "Keep", bar: "A", v: "10" }] as TidyRow[];
    const withDropPane = [...keep, { pane: "Q", sec: "Drop", bar: "B", v: "20" }] as TidyRow[];
    const mounted = (rows: TidyRow[]): string => {
      document.body.innerHTML = "";
      const c = document.createElement("div");
      document.body.appendChild(c);
      mountChart(c, { spec, rows, width: 320 });
      return Array.from(c.querySelectorAll("svg")).map((s) => s.getAttribute("width")).join(",");
    };
    expect(mounted(withDropPane)).toBe(mounted(keep));
  });
});

describe("section_order: a series found only in an excluded section shifts no other series' colour", () => {
  // X sits only in the excluded section and is reached first, so it holds palette slot 0.
  const rows = [
    { sec: "Drop", bar: "B", tax: "X", v: "5" },
    { sec: "Keep", bar: "A", tax: "Y", v: "10" },
    { sec: "Keep", bar: "A", tax: "Z", v: "20" },
  ] as TidyRow[];
  const fills = (svg: Element): Map<string, string> => {
    const m = new Map<string, string>();
    for (const r of Array.from(svg.querySelectorAll("rect[data-series]"))) m.set(r.getAttribute("data-series")!, r.getAttribute("fill")!);
    return m;
  };
  for (const chartType of ["bar", "stacked"] as const) {
    const all = { ...base, chartType, columns: { x: "bar", series: "tax", value: "v", section: "sec" }, section_order: ["Drop", "Keep"] } as ChartSpec;
    const kept = { ...all, section_order: ["Keep"] } as ChartSpec;
    it(`${chartType}: Y and Z keep the colours they have with X drawn (live, legend and PNG export)`, () => {
      const full = renderChart(all, rows, { width: 720, height: 400, document });
      const want = fills(full.svg);
      expect(want.size).toBe(3);
      const live = renderChart(kept, rows, { width: 720, height: 400, document });
      expect(fills(live.svg)).toEqual(new Map([["Y", want.get("Y")], ["Z", want.get("Z")]]));
      expect(live.legendItems?.map((l) => [l.series, l.color])).toEqual([["Y", want.get("Y")], ["Z", want.get("Z")]]);
      expect(fills(buildExportSvg(kept, rows))).toEqual(new Map([["Y", want.get("Y")], ["Z", want.get("Z")]]));
    });

    it(`${chartType}, small multiples: the same in every pane and the figure legend`, () => {
      const figSpec = (s: ChartSpec) =>
        ({ ...s, columns: { ...s.columns, facet: "pane" }, small_multiples: { columns: 2 } }) as ChartSpec;
      const figRows = ["P", "Q"].flatMap((pane) => rows.map((r) => ({ ...r, pane }))) as TidyRow[];
      const want = fills(renderChart(all, rows, { width: 720, height: 400, document }).svg);
      const expected = new Map([["Y", want.get("Y")], ["Z", want.get("Z")]]);
      const f = renderFigure(figSpec(kept), figRows, { width: 900, document });
      for (const p of f.panes) expect(fills(p.svg as SVGSVGElement)).toEqual(expected);
      expect(f.legendItems?.map((l) => [l.series, l.color])).toEqual([["Y", want.get("Y")], ["Z", want.get("Z")]]);
      const exported = Array.from(buildExportSvg(figSpec(kept), figRows).querySelectorAll("svg")).filter((s) => s.querySelector("rect[data-series]"));
      expect(exported.length).toBe(2);
      for (const s of exported) expect(fills(s)).toEqual(expected);
    });
  }
});

describe("section_order: a monochrome stack keeps every drawn series' shade when a section is left out", () => {
  // Mono shades rank the series by stack position (sign, then order), over the rows with every
  // section drawn: the shade a series has with the section drawn is the one it keeps.
  const CASES: Record<string, TidyRow[]> = {
    // Codex's repro: X only in Drop, reached first.
    "X only in the left-out section": [
      { sec: "Drop", bar: "B", tax: "X", v: "5" },
      { sec: "Keep", bar: "A", tax: "Y", v: "10" },
      { sec: "Keep", bar: "A", tax: "Z", v: "20" },
    ],
    // A negative X stacks below zero, so it takes the darkest shade.
    "a negative X only in the left-out section": [
      { sec: "Drop", bar: "B", tax: "X", v: "-5" },
      { sec: "Keep", bar: "A", tax: "Y", v: "10" },
      { sec: "Keep", bar: "A", tax: "Z", v: "20" },
    ],
    // Y nets negative only with Drop's row counted.
    "Y's sign set by the left-out section": [
      { sec: "Drop", bar: "B", tax: "X", v: "5" },
      { sec: "Drop", bar: "B", tax: "Y", v: "-100" },
      { sec: "Keep", bar: "A", tax: "X", v: "1" },
      { sec: "Keep", bar: "A", tax: "Y", v: "10" },
      { sec: "Keep", bar: "A", tax: "Z", v: "20" },
    ],
  } as Record<string, TidyRow[]>;
  const fills = (svg: Element): Map<string, string> => {
    const m = new Map<string, string>();
    for (const r of Array.from(svg.querySelectorAll('g[aria-label="bar"] rect[data-series]'))) m.set(r.getAttribute("data-series")!, r.getAttribute("fill")!);
    return m;
  };
  const all = {
    ...base,
    chartType: "stacked",
    columns: { x: "bar", series: "tax", value: "v", section: "sec" },
    section_order: ["Drop", "Keep"],
    barStack: { mono: { base: "blue" } },
  } as ChartSpec;
  const kept = { ...all, section_order: ["Keep"] } as ChartSpec;
  for (const [name, rows] of Object.entries(CASES)) {
    const want = (): Map<string, string> => {
      const m = fills(renderChart(all, rows, { width: 720, height: 400, document }).svg);
      expect(new Set(m.values()).size).toBe(3);
      return m;
    };
    it(`${name}: live, legend and PNG export`, () => {
      const full = want();
      const drawn = [...fills(renderChart(kept, rows, { width: 720, height: 400, document }).svg).keys()];
      const expected = new Map(drawn.map((s) => [s, full.get(s)]));
      const live = renderChart(kept, rows, { width: 720, height: 400, document });
      expect(fills(live.svg)).toEqual(expected);
      for (const l of live.legendItems ?? []) expect([l.series, l.color]).toEqual([l.series, full.get(l.series)]);
      expect(live.legendItems?.length).toBe(drawn.length);
      expect(fills(buildExportSvg(kept, rows))).toEqual(expected);
    });

    for (const mode of ["shared", "per-pane"] as const) {
      it(`${name}, small multiples (${mode}): every pane, the figure legend and the PNG export`, () => {
        const full = want();
        const figSpec = { ...kept, columns: { ...kept.columns, facet: "pane" }, small_multiples: { columns: 2, mode } } as ChartSpec;
        const figRows = ["P", "Q"].flatMap((pane) => rows.map((r) => ({ ...r, pane }))) as TidyRow[];
        const f = renderFigure(figSpec, figRows, { width: 900, document });
        const panes = f.panes.map((p) => p.svg as SVGSVGElement);
        expect(panes.length).toBe(2);
        for (const p of panes) {
          const got = fills(p);
          expect(got.size).toBeGreaterThan(0);
          for (const [s, c] of got) expect([s, c]).toEqual([s, full.get(s)]);
        }
        expect(f.legendItems?.length).toBeGreaterThan(0);
        for (const l of f.legendItems ?? []) expect([l.series, l.color]).toEqual([l.series, full.get(l.series)]);
        const exported = Array.from(buildExportSvg(figSpec, figRows).querySelectorAll("svg")).filter((s) => s.querySelector('g[aria-label="bar"] rect[data-series]'));
        expect(exported.length).toBeGreaterThan(0);
        for (const s of exported) for (const [ser, c] of fills(s)) expect([ser, c]).toEqual([ser, full.get(ser)]);
      });
    }
  }
});

describe("section_order: the mono shade basis sums in the full render's row order", () => {
  // Codex's repro: Y's three rows cancel to 0 summed in x_order (A, B, C) but to -1 in CSV order
  // (A, C, B), so a basis summed in CSV order classed Y negative and swapped Y's and Z's shades.
  const ROWS = [
    { sec: "Keep", bar: "A", tax: "Y", v: "1e16" },
    { sec: "Keep", bar: "C", tax: "Y", v: "-1e16" },
    { sec: "Keep", bar: "B", tax: "Y", v: "-1" },
    { sec: "Keep", bar: "A", tax: "Z", v: "1" },
    { sec: "Drop", bar: "D", tax: "X", v: "1" },
  ] as TidyRow[];
  const all = {
    ...base,
    chartType: "stacked",
    columns: { x: "bar", series: "tax", value: "v", section: "sec" },
    series_order: ["Z", "Y", "X"],
    x_order: ["A", "B", "C"],
    section_order: ["Keep", "Drop"],
    barStack: { mono: { base: "blue" } },
  } as ChartSpec;
  const kept = { ...all, section_order: ["Keep"] } as ChartSpec;
  const fills = (svg: Element): Map<string, string> => {
    const m = new Map<string, string>();
    for (const r of Array.from(svg.querySelectorAll('g[aria-label="bar"] rect[data-series]'))) m.set(r.getAttribute("data-series")!, r.getAttribute("fill")!);
    return m;
  };
  const full = (): Map<string, string> => fills(renderChart(all, ROWS, { width: 720, height: 400, document }).svg);

  it("standalone: Y and Z keep their shades, live and in the PNG export", () => {
    const want = full();
    expect(new Set([want.get("Y"), want.get("Z")]).size).toBe(2);
    const live = renderChart(kept, ROWS, { width: 720, height: 400, document });
    for (const svg of [live.svg, buildExportSvg(kept, ROWS)]) {
      const got = fills(svg);
      expect(got.get("Y")).toBe(want.get("Y"));
      expect(got.get("Z")).toBe(want.get("Z"));
    }
    for (const l of live.legendItems ?? []) expect([l.series, l.color]).toEqual([l.series, want.get(l.series)]);
  });

  for (const mode of ["shared", "per-pane"] as const) {
    it(`small multiples (${mode}): every pane keeps Y's and Z's shades`, () => {
      const want = full();
      const figSpec = { ...kept, columns: { ...kept.columns, facet: "pane" }, small_multiples: { columns: 2, mode } } as ChartSpec;
      const figRows = ["P", "Q"].flatMap((pane) => ROWS.map((r) => ({ ...r, pane }))) as TidyRow[];
      const fig = renderFigure(figSpec, figRows, { width: 900, document });
      const panes = fig.panes.map((p) => p.svg as SVGSVGElement);
      expect(panes.length).toBe(2);
      for (const p of panes) {
        const got = fills(p);
        expect(got.get("Y")).toBe(want.get("Y"));
        expect(got.get("Z")).toBe(want.get("Z"));
      }
      for (const l of fig.legendItems ?? []) expect([l.series, l.color]).toEqual([l.series, want.get(l.series)]);
    });
  }
});
