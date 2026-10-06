// @vitest-environment jsdom
//
// A series (or category, group, facet) is named by the DATA, and data may say anything — including
// "constructor", "toString", "__proto__", "valueOf" or "hasOwnProperty". Every author-keyed map the
// engine reads BY such a name (`series_colors`, `series_labels`, `series_styles`, `series_marker`,
// `category_colors`, `x_labels`, …) must be read as an OWN key: a plain `obj[name]` returns the
// inherited Object.prototype member, so the series drew a function as its colour and printed
// "function toString() { [native code] }" as its label. Ruling 44 closed the palette-NAME half of
// this (a colour VALUE such as "constructor"); this file pins the series-NAME half.
import { describe, it, expect, beforeEach } from "vitest";
import { renderChart, buildColorMap } from "../src/engine/index";
import { renderFigure } from "../src/engine/figure";
import { mountChart } from "../src/engine/render-live";
import { buildBandTooltipHtml, overlayTooltipRows } from "../src/engine/crosshair";
import { tblColorScale, resolveColor } from "../src/engine/palette";
import { resolveActiveOptionColor } from "../src/spec/title";
import { buildTableModel } from "../src/table/model";
import { splitPanes, resolveStubHeader } from "../src/table/panes";
import { layoutTable, layoutOptionsFromSpec } from "../src/table/layout";
import { parseRich } from "../src/table/richtext";
import type { ChartSpec } from "../src/spec/types";
import type { TableSpec } from "../src/spec/table-types";
import type { TidyRow } from "../src/data/index";

const BUILTINS = ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"] as const;
const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

/** Two x points per series, one series per built-in name plus an ordinary one. */
function rows(names: readonly string[], x = ["1", "2"]): TidyRow[] {
  return rowsOf(names.flatMap((g, i) => x.map((xv, j) => ({ x: xv, y: String(10 + i + j), g }))));
}

const NAMES = [...BUILTINS, "Ordinary"];
const RAMP = tblColorScale(NAMES.length);

// Author maps that name ONLY the ordinary series, so every built-in must fall through to its default.
// Built through JSON.parse, as the publish boundary does (buildStandaloneHtml JSON-serialises the spec).
const AUTHOR_MAPS = JSON.parse(
  '{"series_colors": {"Ordinary": "navy"}, "series_labels": {"Ordinary": "Plain"}, ' +
    '"series_styles": {"Ordinary": {"dashed": true}}}',
) as Pick<ChartSpec, "series_colors" | "series_labels" | "series_styles">;

const SPECS: Record<string, ChartSpec> = {
  line: { chartType: "line", xAxisType: "numeric", columns: { x: "x", value: "y", series: "g" } } as unknown as ChartSpec,
  bar: { chartType: "bar", xAxisType: "categorical", columns: { x: "x", value: "y", series: "g" } } as unknown as ChartSpec,
  stacked: { chartType: "stacked", xAxisType: "categorical", columns: { x: "x", value: "y", series: "g" } } as unknown as ChartSpec,
  scatter: { chartType: "scatter", xAxisType: "numeric", columns: { x: "x", value: "y", series: "g" } } as unknown as ChartSpec,
};

const isHex = (v: unknown): boolean => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

beforeEach(() => { document.body.innerHTML = ""; });

describe("buildColorMap reads series_colors by OWN key", () => {
  it("gives a built-in-named series its ramp colour when series_colors names other series", () => {
    const m = buildColorMap(NAMES, { Ordinary: "navy" });
    BUILTINS.forEach((name, i) => expect(m.get(name), name).toBe(RAMP[i]));
  });

  it("still honours a series_colors entry that IS keyed by a built-in name", () => {
    const cfg = JSON.parse('{"constructor": "red", "__proto__": "green"}') as Record<string, string>;
    const m = buildColorMap(["constructor", "__proto__", "toString"], cfg);
    expect(m.get("constructor")).not.toBe(tblColorScale(3)[0]);
    expect(isHex(m.get("constructor"))).toBe(true);
    expect(isHex(m.get("__proto__"))).toBe(true);
    expect(m.get("__proto__")).not.toBe(tblColorScale(3)[1]);
    expect(m.get("toString")).toBe(tblColorScale(3)[2]);
  });
});

describe.each(Object.keys(SPECS))("%s: a series named like an Object.prototype key", (type) => {
  for (const withMaps of [false, true]) {
    it(`renders with its ramp colour and its own name${withMaps ? " (author maps name other series)" : ""}`, () => {
      const spec = { ...SPECS[type], ...(withMaps ? AUTHOR_MAPS : {}) } as ChartSpec;
      const r = renderChart(spec, rows(NAMES), { width: 720, height: 400 });
      const items = r.legendItems ?? [];
      for (const [i, name] of BUILTINS.entries()) {
        const item = items.find((it) => it.series === name);
        expect(item, name).toBeDefined();
        expect(item!.label, name).toBe(name);
        expect(item!.color, name).toBe(RAMP[i]);
        expect(item!.dashed, name).toBe(false);
        expect(r.colors.get(name), name).toBe(RAMP[i]);
      }
      const svg = r.svg.outerHTML;
      expect(svg).not.toContain("native code");
      expect(svg).not.toContain("[object Object]");
      // Every built-in's ramp colour is actually painted on a mark.
      for (const i of BUILTINS.keys()) expect(svg.toLowerCase(), BUILTINS[i]).toContain(RAMP[i]!.toLowerCase());
    });
  }
});

describe("live mount", () => {
  it("line: the HTML legend names each built-in-named series by its own name", () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const spec = { ...SPECS.line, ...AUTHOR_MAPS } as ChartSpec;
    mountChart(c, { spec, rows: rows(NAMES), width: 720, height: 400 } as never);
    expect(c.innerHTML).not.toContain("native code");
    const legend = Array.from(c.querySelectorAll(".tbl-legend-item")).map((e) => e.textContent?.trim());
    for (const name of BUILTINS) expect(legend).toContain(name);
  });
});

// ---- Every other author map read by a data- or author-supplied name ----

describe("category-, section-, shape- and pane-keyed maps", () => {
  const CATS = ["constructor", "toString", "Ordinary"];
  const single = (extra: object): ChartSpec =>
    ({ chartType: "bar", xAxisType: "categorical", columns: { x: "x", value: "y" }, ...extra }) as unknown as ChartSpec;
  const catRows = rowsOf(CATS.map((x, i) => ({ x, y: String(5 + i) })));
  const barFills = (svg: SVGSVGElement): (string | null)[] =>
    Array.from(svg.querySelectorAll('g[aria-label="bar"] rect')).map((e) => e.getAttribute("fill"));

  it("category_colors: a built-in-named category keeps the base fill (bar)", () => {
    const r = renderChart(single({ category_colors: { Ordinary: "red" } }), catRows, { width: 720, height: 400 });
    const fills = barFills(r.svg);
    expect(fills.length).toBe(3);
    for (const f of fills) expect(isHex(f), String(f)).toBe(true);
  });

  it("category_colors: a built-in-named category keeps its direction colour (waterfall)", () => {
    const spec = { chartType: "waterfall", xAxisType: "categorical", columns: { x: "x", value: "y" }, category_colors: { Ordinary: "red" } } as unknown as ChartSpec;
    const fills = barFills(renderChart(spec, catRows, { width: 720, height: 400 }).svg);
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) expect(isHex(f), String(f)).toBe(true);
  });

  it("section_labels: a built-in-named section is headed by its own name", () => {
    const spec = single({
      orientation: "horizontal", columns: { x: "x", value: "y", section: "sec" },
      section_labels: { Other: "Others" },
    });
    const rws = rowsOf([
      { x: "a", y: "1", sec: "constructor" }, { x: "b", y: "2", sec: "toString" }, { x: "c", y: "3", sec: "Other" },
    ]);
    const texts = Array.from(renderChart(spec, rws, { width: 520, height: 500 }).svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts).toContain("constructor");
    expect(texts).toContain("toString");
    expect(texts.join(" ")).not.toContain("native code");
  });

  it("shape_labels: a built-in-named shape is keyed by its own name", () => {
    const spec = {
      chartType: "scatter", xAxisType: "numeric", columns: { x: "x", value: "y", series: "g", shape: "sh" },
      shape_labels: { Other: "Others" },
    } as unknown as ChartSpec;
    const rws = rowsOf([{ x: "1", y: "1", g: "A", sh: "valueOf" }, { x: "2", y: "2", g: "B", sh: "Other" }]);
    const r = renderChart(spec, rws, { width: 720, height: 400 });
    expect((r.shapeLegendItems ?? []).map((s) => s.label)).toEqual(["valueOf", "Others"]);
  });

  it("pane_titles: a built-in-named facet is titled by its own name", () => {
    const spec = {
      chartType: "line", xAxisType: "numeric", columns: { x: "x", value: "y", facet: "f" },
      small_multiples: { columns: 2, pane_titles: { Other: "Others" } },
    } as unknown as ChartSpec;
    const rws = rowsOf(["toString", "Other"].flatMap((f) => [{ x: "1", y: "1", f }, { x: "2", y: "2", f }]));
    const fig = renderFigure(spec, rws, { width: 720, height: 400, document });
    expect(fig.panes.map((p) => p.title)).toEqual(["toString", "Others"]);
  });
});

describe("series_marker by a built-in series name", () => {
  it("dumbbell: a built-in-named series draws the default filled marker", () => {
    const spec = {
      chartType: "dumbbell", xAxisType: "categorical", orientation: "horizontal",
      columns: { x: "x", value: "y", series: "g" }, series_marker: { Ordinary: "hollow" },
    } as unknown as ChartSpec;
    const rws = rowsOf(["a", "b"].flatMap((x, i) => [{ x, y: String(i + 1), g: "constructor" }, { x, y: String(i + 3), g: "Ordinary" }]));
    const r = renderChart(spec, rws, { width: 720, height: 400 });
    const items = r.legendItems ?? [];
    expect(items.find((it) => it.series === "Ordinary")?.hollow).toBe(true);
    expect(items.find((it) => it.series === "constructor")?.hollow).toBeUndefined();
    expect(isHex(items.find((it) => it.series === "constructor")?.color)).toBe(true);
  });
});

describe("hover cards and the title selector", () => {
  it("band card: built-in-named series and category read their own names and values", () => {
    const rws = [
      { _xc: "toString", series: "__proto__", _y: 2 },
      { _xc: "toString", series: "constructor", _y: 3 },
    ];
    const html = buildBandTooltipHtml("toString", rws, {
      isStacked: true, totalRow: "text", seriesLabels: { Other: "x" }, categoryLabels: { Other: "x" },
    });
    expect(html).not.toContain("native code");
    expect(html).not.toContain("[object Object]");
    expect(html).toContain('<div class="tbl-tooltip-head">toString</div>');
    expect(html).toContain("__proto__");
    expect(html).toContain("constructor");
    expect(html).toMatch(/Total:<\/span>.*<span class="tbl-tooltip-value">5<\/span>/);
  });

  it("overlay rows: a per-series fit is disambiguated by the series' own name", () => {
    const line = (series: string) => ({ label: "Trend", color: "#333", dashed: false, series, points: [{ x: 0, y: 1 }, { x: 2, y: 3 }] });
    const html = overlayTooltipRows([line("toString"), line("Other")], 1, String, { Other: "Others" });
    expect(html).not.toContain("native code");
    expect(html).toContain("Trend (toString)");
    expect(html).toContain("Trend (Others)");
  });

  it("scatter point card: header names a built-in-named series and shape by their own names", () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const spec = {
      chartType: "scatter", xAxisType: "numeric", columns: { x: "x", value: "y", series: "g", shape: "sh" },
      series_labels: { Other: "Others" }, shape_labels: { Other: "Others" },
    } as unknown as ChartSpec;
    const rws = rowsOf([{ x: "1", y: "1", g: "toString", sh: "valueOf" }, { x: "2", y: "2", g: "Other", sh: "Other" }]);
    mountChart(c, { spec, rows: rws, width: 720, height: 400 } as never);
    const dot = c.querySelector('g[aria-label="dot"] [data-series="toString"]')!;
    dot.dispatchEvent(new PointerEvent("pointerenter", { clientX: 5, clientY: 5, bubbles: true }));
    const head = document.body.querySelector(".tbl-tooltip .tbl-tooltip-head")?.textContent ?? "";
    expect(head).not.toContain("native code");
    expect(head).toContain("toString");
    expect(head).toContain("valueOf");
  });

  it("title selector: an option labelled like a built-in takes no colour from series_colors", () => {
    const sel = { k: { options: [{ id: "constructor" }] } } as never;
    expect(resolveActiveOptionColor(sel, { k: "constructor" }, { Other: "red" })).toBeUndefined();
  });
});

describe("timeline and treemap sanity", () => {
  it("timeline: built-in-named lanes keep their ramp colour and own name", () => {
    const spec = {
      chartType: "timeline", title: "T", xAxisType: "temporal", data: "d.csv",
      columns: { x: "date", label: "title", series: "kind" }, series_labels: { Other: "Others" },
    } as unknown as ChartSpec;
    const rws = rowsOf([
      { date: "2020-01-01", title: "A", kind: "constructor" },
      { date: "2021-01-01", title: "B", kind: "toString" },
    ]);
    const r = renderChart(spec, rws, { width: 720, height: 400 });
    const ramp = tblColorScale(2);
    expect(r.seriesKeyRows.map((k) => [k.label, k.color])).toEqual([["constructor", ramp[0]], ["toString", ramp[1]]]);
    expect(r.svg.outerHTML).not.toContain("native code");
  });

  it("treemap: built-in-named groups keep their ramp colour and own name", () => {
    const spec = {
      chartType: "treemap", title: "T", xAxisType: "categorical", data: "d.csv",
      columns: { x: "name", value: "v", series: "grp" }, series_colors: { Other: "red" }, series_labels: { Other: "Others" },
    } as unknown as ChartSpec;
    const rws = rowsOf([{ name: "a", v: "3", grp: "__proto__" }, { name: "b", v: "2", grp: "valueOf" }]);
    const r = renderChart(spec, rws, { width: 720, height: 400 });
    const ramp = tblColorScale(2);
    expect(r.seriesKeyRows.map((k) => [k.label, k.color])).toEqual([["__proto__", ramp[0]], ["valueOf", ramp[1]]]);
  });
});

describe("tables: author maps keyed by data", () => {
  it("row/group/column labels, notes, pane_titles and format read own keys only", () => {
    const spec = {
      title: "T", data: "d", value: "value", stub: ["grp", { label: "row" }], header: ["metric"], pane: "p",
      row_labels: { Other: "x" }, group_labels: { Other: "x" }, column_labels: { Other: "x" },
      header_labels: { Other: "x" }, sublabels: { Other: "x" }, group_notes: { Other: "x" }, pane_titles: { Other: "x" },
      format: {
        default: { type: "number", decimals: 1 },
        columns: { Other: { decimals: 3 } }, rows: { Other: { decimals: 3 } }, groups: { Other: { decimals: 3 } },
      },
    } as unknown as TableSpec;
    const rws = [{ p: "toString", grp: "constructor", row: "valueOf", metric: "hasOwnProperty", value: "1.25" }] as unknown as TidyRow[];
    const m = buildTableModel(spec, rws);
    expect(JSON.stringify(m)).not.toContain("native code");
    const row = m.body.find((b) => b.kind === "row") as unknown as { row: { label: string; cells: { text: string }[] } };
    expect(row.row.label).toBe("valueOf");
    expect(row.row.cells[0]!.text).toBe("1.3");
    const group = (m.body.find((b) => b.kind === "group") as unknown as { group: { label: string; note?: unknown } }).group;
    expect(group.label).toBe("constructor");
    expect(group.note).toBeUndefined();
    expect(m.leaves.map((l) => [l.label, l.sublabel])).toEqual([["hasOwnProperty", undefined]]);
    expect(splitPanes(spec, rws).map((p) => p.title)).toEqual(["toString"]);
  });

  it("stub_header and column_width maps read own keys only", () => {
    const spec = {
      title: "T", data: "d", value: "value", stub: [{ label: "row" }], header: ["metric"], pane: "p",
      stub_header: { Other: "x" }, column_width: { Other: 99 },
    } as unknown as TableSpec;
    const rws = [{ p: "toString", row: "r", metric: "constructor", value: "1" }] as unknown as TidyRow[];
    expect(resolveStubHeader(spec, "toString")).toBe("");
    const layout = layoutTable(buildTableModel(spec, rws), { width: 800, measureText: (s) => s.length * 7, ...layoutOptionsFromSpec(spec) });
    expect(layout.colW.every((w) => Number.isFinite(w))).toBe(true);
  });

  it("rich text: \\constructor is an unsupported macro, not a Greek letter", () => {
    const unsupported: string[] = [];
    const runs = parseRich("\\(\\constructor\\)", (c) => unsupported.push(c));
    expect(unsupported).toEqual(["constructor"]);
    expect(JSON.stringify(runs)).not.toContain("native code");
  });
});

// The converted lookups must still resolve an ORDINARY name: reading by own key may not have turned
// every author map into a no-op.
describe("an ordinary name still resolves through every converted lookup", () => {
  const RED = resolveColor("red")!;
  const SIZE = { width: 720, height: 400 };

  it("series_colors, series_labels and series_styles key a series named \"A\"", () => {
    const spec = {
      ...SPECS.line,
      series_colors: { A: "red" }, series_labels: { A: "Alpha" }, series_styles: { A: { dashed: true } },
    } as ChartSpec;
    const r = renderChart(spec, rows(["A", "B"]), SIZE);
    const a = (r.legendItems ?? []).find((it) => it.series === "A")!;
    const b = (r.legendItems ?? []).find((it) => it.series === "B")!;
    expect(buildColorMap(["A", "B"], { A: "red" }).get("A")).toBe(RED);
    expect(a.color).toBe(RED);
    expect(a.label).toBe("Alpha");
    expect(a.dashed).toBe(true);
    expect(b.color).not.toBe(RED);
    expect(b.label).toBe("B");
    expect(b.dashed).toBe(false);
  });

  it("category_colors paints the bar of a category named \"A\" (bar and waterfall)", () => {
    const rws = rowsOf([{ x: "A", y: "5" }, { x: "B", y: "6" }]);
    for (const chartType of ["bar", "waterfall"]) {
      const spec = { chartType, xAxisType: "categorical", columns: { x: "x", value: "y" }, category_colors: { A: "red" } } as unknown as ChartSpec;
      const fills = Array.from(renderChart(spec, rws, SIZE).svg.querySelectorAll('g[aria-label="bar"] rect'))
        .map((e) => (e.getAttribute("fill") ?? "").toLowerCase());
      expect(fills, chartType).toContain(RED.toLowerCase());
      expect(fills.some((f) => f !== RED.toLowerCase()), chartType).toBe(true);
    }
  });

  it("section_labels heads a section named \"A\"; shape_labels and pane_titles name \"A\"", () => {
    const sec = {
      chartType: "bar", xAxisType: "categorical", orientation: "horizontal", columns: { x: "x", value: "y", section: "sec" },
      section_labels: { A: "Section A" },
    } as unknown as ChartSpec;
    const texts = Array.from(renderChart(sec, rowsOf([{ x: "a", y: "1", sec: "A" }, { x: "b", y: "2", sec: "B" }]), { width: 520, height: 500 })
      .svg.querySelectorAll("text")).map((x) => x.textContent ?? "");
    expect(texts).toContain("Section A");
    expect(texts).toContain("B");

    const shp = {
      chartType: "scatter", xAxisType: "numeric", columns: { x: "x", value: "y", series: "g", shape: "sh" },
      shape_labels: { A: "Shape A" },
    } as unknown as ChartSpec;
    const sr = renderChart(shp, rowsOf([{ x: "1", y: "1", g: "s", sh: "A" }, { x: "2", y: "2", g: "s", sh: "B" }]), SIZE);
    expect((sr.shapeLegendItems ?? []).map((s) => s.label)).toEqual(["Shape A", "B"]);

    const pane = {
      chartType: "line", xAxisType: "numeric", columns: { x: "x", value: "y", facet: "f" },
      small_multiples: { columns: 2, pane_titles: { A: "Pane A" } },
    } as unknown as ChartSpec;
    const fig = renderFigure(pane, rowsOf(["A", "B"].flatMap((f) => [{ x: "1", y: "1", f }, { x: "2", y: "2", f }])), { ...SIZE, document });
    expect(fig.panes.map((p) => p.title)).toEqual(["Pane A", "B"]);
  });

  it("hover cards and the title selector read an entry keyed \"A\"", () => {
    const html = buildBandTooltipHtml("c", [{ _xc: "c", series: "A", _y: 2 }, { _xc: "c", series: "B", _y: 3 }], {
      isStacked: true, totalRow: "text", seriesLabels: { A: "Alpha" }, categoryLabels: { c: "Cat" },
    });
    expect(html).toContain('<div class="tbl-tooltip-head">Cat</div>');
    expect(html).toContain("Alpha");
    expect(html).toContain("B");
    const line = { label: "Trend", color: "#333", dashed: false, series: "A", points: [{ x: 0, y: 1 }, { x: 2, y: 3 }] };
    expect(overlayTooltipRows([line, { ...line, series: "B" }], 1, String, { A: "Alpha" })).toContain("Trend (Alpha)");
    const sel = { k: { options: [{ id: "A" }] } } as never;
    expect(resolveActiveOptionColor(sel, { k: "A" }, { A: "red" })).toBeDefined();
  });
});
