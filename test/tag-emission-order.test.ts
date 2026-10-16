// @vitest-environment jsdom
//
// Post-render tagging (assemble-plot.ts) stamps `data-series` / `data-category` onto a mark's
// elements by DOM index, so each builder must list its tags in the order Plot emits the elements
// (marks/emission-order.ts). These tests check every tagged element against its OWN geometry, not
// against a count: a rect's or a path's `data-series` must name the series whose colour it is
// painted, a category label's `data-category` must name its own text, and a dot's `data-category`
// must name the label on its row. Each case below is one way the hand-predicted order used to drift:
// a section order that differs from the data order, interleaved sections, uneven series per category,
// a horizontal chart whose sections are its series column, and a line series with no finite value.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import { rowEmissionOrder, groupEmissionOrder } from "../src/engine/marks/emission-order";
import { categoryText } from "../src/spec/section-key";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { translateOf } from "./helpers/geometry";

const opts = { width: 720, height: 420 } as const;

/** fill / stroke as painted: the element's own attribute, else the nearest ancestor's (Plot hoists a
 *  constant channel onto the mark's <g>). */
function paintOf(el: Element): { fill: string | null; stroke: string | null } {
  let fill: string | null = null;
  let stroke: string | null = null;
  for (let n: Element | null = el; n && n.tagName.toLowerCase() !== "svg"; n = n.parentElement) {
    fill ??= n.getAttribute("fill");
    stroke ??= n.getAttribute("stroke");
  }
  return { fill, stroke };
}

const num = (v: string | null): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Absolute centre of a rect / circle / text: ancestor translates plus the element's own position. */
function centre(el: Element): [number, number] {
  let [x, y] = translateOf(el);
  const tag = el.tagName.toLowerCase();
  if (tag === "rect") {
    x += num(el.getAttribute("x")) + num(el.getAttribute("width")) / 2;
    y += num(el.getAttribute("y")) + num(el.getAttribute("height")) / 2;
  } else if (tag === "circle") {
    x += num(el.getAttribute("cx"));
    y += num(el.getAttribute("cy"));
  } else if (tag === "text") {
    x += num(el.getAttribute("x"));
    y += num(el.getAttribute("y"));
  }
  return [x, y];
}

const MARKS = 'g[aria-label="bar"] rect, g[aria-label="dot"] circle, g[aria-label="dot"] path, g[aria-label="line"] path';

/** Every disagreement between a tag and the geometry it sits on. Also fails when nothing was tagged,
 *  so a case cannot pass by tagging nothing. */
function tagErrors(svg: Element, colors: Map<string, string>, categoryAxis: "x" | "y"): string[] {
  const errors: string[] = [];
  const labels = Array.from(svg.querySelectorAll("g.tbl-cat-label text[data-category]"));
  for (const l of labels) {
    const text = (l.textContent ?? "").trim();
    const tag = categoryText(l.getAttribute("data-category") as string);
    if (tag !== text) errors.push(`label "${text}" tagged "${tag}"`);
  }
  const axis = categoryAxis === "y" ? 1 : 0;
  const rowText = (el: Element): string | null => {
    const at = centre(el)[axis];
    let best: Element | null = null;
    for (const l of labels) {
      if (!best || Math.abs(centre(l)[axis] - at) < Math.abs(centre(best)[axis] - at)) best = l;
    }
    return best ? (best.textContent ?? "").trim() : null;
  };
  let tagged = 0;
  for (const el of Array.from(svg.querySelectorAll(MARKS))) {
    const series = el.getAttribute("data-series");
    if (series != null && colors.has(series)) {
      tagged++;
      const own = colors.get(series) as string;
      const { fill, stroke } = paintOf(el);
      const other = [...colors.values()].filter((c) => c !== own);
      if ((fill !== own && stroke !== own) || other.includes(fill ?? "") || other.includes(stroke ?? "")) {
        errors.push(`${el.tagName} tagged "${series}" (${own}) is painted fill=${fill} stroke=${stroke}`);
      }
    }
    const cat = el.getAttribute("data-category");
    if (cat != null && labels.length) {
      const row = rowText(el);
      if (row !== categoryText(cat)) errors.push(`${el.tagName} tagged category "${categoryText(cat)}" sits on row "${row}"`);
    }
  }
  if (tagged === 0) errors.push("no element carries a data-series of a coloured series");
  return errors;
}

function chartErrors(spec: ChartSpec, rows: Record<string, string>[], categoryAxis: "x" | "y"): string[] {
  const { svg, colors } = renderChart(spec, rows as TidyRow[], { ...opts, document });
  return tagErrors(svg, colors, categoryAxis);
}

/** `cat,series,value[,section[,facet]]` per line. */
function rowsOf(csv: string): Record<string, string>[] {
  return csv.trim().split("\n").map((line) => {
    const [c, s, v, sec, f] = line.trim().split(",");
    const r: Record<string, string> = { c: c as string, s: s as string, v: v as string };
    if (sec) r.sec = sec;
    if (f) r.f = f;
    return r;
  });
}

const base = { title: "t", data: "d.csv", xAxisType: "categorical" } as const;
const cols = { category: "c", series: "s", value: "v" };
const colsSec = { ...cols, section: "sec" };
const colsFacet = { ...cols, facet: "f" };
// The State of Tariffs consumer-prices groups, in the section spelling a horizontal chart takes.
const colsGroup = { ...cols, section: "f" };

// A has X only, B has X and Y, C has Y only (the marks-overlays probe).
const UNEVEN = rowsOf(`
  A,X,1,S1
  B,X,2,S1
  B,Y,3,S1
  C,Y,4,S2`);
// Section S2's row sits between S1's rows in the data.
const INTERLEAVED = rowsOf(`
  A,X,1,S1
  C,Y,4,S2
  B,X,2,S1
  B,Y,3,S1`);
// State of Tariffs consumer-prices shape: series and group are one column, so each group holds one
// series and every category repeats across groups.
const SERIES_AS_GROUPS = rowsOf(`
  Food,full,1,,full
  Food,none,2,,none
  Cars,full,3,,full
  Cars,none,4,,none
  Rent,full,5,,full
  Rent,none,6,,none`);
const DUMBBELL = rowsOf(`
  A,X,1,S1
  A,Y,2,S1
  B,X,3,S1
  B,Y,5,S1
  C,X,4,S2
  C,Y,8,S2`);
const DUMBBELL_INTERLEAVED_GAPS = rowsOf(`
  A,X,1,S1
  A,Y,,S1
  C,X,4,S2
  C,Y,8,S2
  B,X,,S1
  B,Y,5,S1`);

describe("grouped horizontal bars: rect data-series follows the fy draw order", () => {
  const H = { ...base, chartType: "bar", orientation: "horizontal" } as ChartSpec;
  it("sectioned, section_order reversed against the data, uneven series", () => {
    expect(chartErrors({ ...H, columns: colsSec, section_order: ["S2", "S1"] }, UNEVEN, "y")).toEqual([]);
  });
  it("sectioned, interleaved sections", () => {
    expect(chartErrors({ ...H, columns: colsSec }, INTERLEAVED, "y")).toEqual([]);
  });
  it("sections, one series per section", () => {
    expect(chartErrors({ ...H, columns: colsGroup }, SERIES_AS_GROUPS, "y")).toEqual([]);
  });
  it("sections, one series per section, section_order reversed", () => {
    const spec = { ...H, columns: colsGroup, section_order: ["none", "full"] } as ChartSpec;
    expect(chartErrors(spec, SERIES_AS_GROUPS, "y")).toEqual([]);
  });
  // Already right before the fix; kept so the shared helper cannot regress them.
  it("sectioned in data order, unsectioned, and null values", () => {
    expect(chartErrors({ ...H, columns: colsSec, section_order: ["S1", "S2"] }, UNEVEN, "y")).toEqual([]);
    expect(chartErrors({ ...H, columns: cols }, UNEVEN, "y")).toEqual([]);
    expect(chartErrors({ ...H, columns: colsSec, section_order: ["S2", "S1"] }, DUMBBELL_INTERLEAVED_GAPS, "y")).toEqual([]);
  });
});

describe("grouped vertical bars and stacks (already right; guarded through the shared helper)", () => {
  const V = { ...base, chartType: "bar" } as ChartSpec;
  const SH = { ...base, chartType: "stacked", orientation: "horizontal" } as ChartSpec;
  const SV = { ...base, chartType: "stacked" } as ChartSpec;
  it("vertical grouped: uneven series, null values", () => {
    expect(chartErrors({ ...V, columns: cols }, UNEVEN, "x")).toEqual([]);
    expect(chartErrors({ ...V, columns: cols }, DUMBBELL_INTERLEAVED_GAPS, "x")).toEqual([]);
  });
  it("vertical grouped panes with uneven series per pane", () => {
    const rows = rowsOf(`
      A,X,1,,P1
      A,Y,2,,P1
      B,Y,3,,P1
      A,Y,4,,P2
      B,X,5,,P2
      B,Y,6,,P2`);
    const fig = renderFigure({ ...V, columns: colsFacet, small_multiples: { mode: "shared" } } as ChartSpec, rows as TidyRow[], { ...opts, document });
    for (const pane of fig.panes) {
      expect(tagErrors(pane.svg as SVGSVGElement, pane.colors ?? fig.colors, "x")).toEqual([]);
    }
  });
  it("stacked: sectioned reversed, interleaved, one series per section, null values", () => {
    expect(chartErrors({ ...SH, columns: colsSec, section_order: ["S2", "S1"] }, UNEVEN, "y")).toEqual([]);
    expect(chartErrors({ ...SH, columns: colsSec }, INTERLEAVED, "y")).toEqual([]);
    expect(chartErrors({ ...SH, columns: colsGroup }, SERIES_AS_GROUPS, "y")).toEqual([]);
    expect(chartErrors({ ...SV, columns: cols }, DUMBBELL_INTERLEAVED_GAPS, "x")).toEqual([]);
  });
});

describe("sectioned horizontal dumbbell: dots and labels tagged in the fy draw order", () => {
  const DH = { ...base, chartType: "dumbbell", orientation: "horizontal" } as ChartSpec;
  it("section_order reversed against the data", () => {
    expect(chartErrors({ ...DH, columns: colsSec, section_order: ["S2", "S1"] }, DUMBBELL, "y")).toEqual([]);
  });
  it("interleaved sections, with missing values", () => {
    expect(chartErrors({ ...DH, columns: colsSec }, DUMBBELL_INTERLEAVED_GAPS, "y")).toEqual([]);
  });
  it("one series per section", () => {
    expect(chartErrors({ ...DH, columns: colsGroup }, SERIES_AS_GROUPS, "y")).toEqual([]);
  });
  it("sectioned in data order, unsectioned, and vertical (already right)", () => {
    expect(chartErrors({ ...DH, columns: colsSec, section_order: ["S1", "S2"] }, DUMBBELL, "y")).toEqual([]);
    expect(chartErrors({ ...DH, columns: cols }, DUMBBELL_INTERLEAVED_GAPS, "y")).toEqual([]);
    expect(chartErrors({ ...DH, orientation: "vertical", columns: cols }, DUMBBELL_INTERLEAVED_GAPS, "x")).toEqual([]);
  });
});

describe("line: a series with no finite value draws no path, so it takes no tag", () => {
  const L = { ...base, chartType: "line", xAxisType: "temporal", columns: { x: "d", series: "s", value: "v" } } as ChartSpec;
  const lineRows = (blank: string[]): Record<string, string>[] =>
    ["A", "B", "C"].flatMap((s, i) =>
      ["2020-01-01", "2021-01-01", "2022-01-01"].map((d, j) => ({ d, s, v: blank.includes(s) ? "" : String(i + j) })),
    );
  it("blank first series", () => {
    expect(chartErrors(L, lineRows(["A"]), "x")).toEqual([]);
  });
  it("blank middle series, with point markers", () => {
    expect(chartErrors({ ...L, points: true }, lineRows(["B"]), "x")).toEqual([]);
  });
  it("blank series in the dashed group, and in the solid group beside a dashed one", () => {
    expect(chartErrors({ ...L, series_styles: { A: { dashed: true }, B: { dashed: true } } }, lineRows(["A"]), "x")).toEqual([]);
    expect(chartErrors({ ...L, series_styles: { C: { dashed: true } } }, lineRows(["A"]), "x")).toEqual([]);
  });
  it("categorical x", () => {
    expect(chartErrors({ ...L, xAxisType: "categorical" }, lineRows(["A"]), "x")).toEqual([]);
  });
  it("small multiples: a series blank in one pane only", () => {
    const rows = ["P1", "P2"].flatMap((f) => lineRows(f === "P1" ? ["A"] : []).map((r) => ({ ...r, f })));
    const spec = { ...L, columns: { x: "d", series: "s", value: "v", facet: "f" }, small_multiples: { mode: "shared", columns: 2 } } as ChartSpec;
    const fig = renderFigure(spec, rows as TidyRow[], { ...opts, document });
    for (const pane of fig.panes) {
      expect(tagErrors(pane.svg as SVGSVGElement, pane.colors ?? fig.colors, "x")).toEqual([]);
    }
  });
  it("already right: no blank series, blank last series, a one-point series, projected runs", () => {
    expect(chartErrors(L, lineRows([]), "x")).toEqual([]);
    expect(chartErrors(L, lineRows(["C"]), "x")).toEqual([]);
    const onePoint = lineRows([]).map((r) => (r.s === "A" && r.d !== "2021-01-01" ? { ...r, v: "" } : r));
    expect(chartErrors(L, onePoint, "x")).toEqual([]);
    const projected = lineRows(["A"]).map((r) => ({ ...r, p: r.d === "2022-01-01" ? "1" : "" }));
    expect(chartErrors({ ...L, projected_field: "p" }, projected, "x")).toEqual([]);
  });
});

describe("series_patterns follow the tag, so a texture lands on its own series' bars, live and in the PNG", () => {
  // The texture is keyed by data-series (assemble-plot.ts), so a wrong tag painted the hatch on the
  // other series' bars. One series per section, data interleaved by category.
  const spec = {
    ...base,
    chartType: "bar",
    orientation: "horizontal",
    columns: colsGroup,
    series_patterns: { none: "/" },
  } as ChartSpec;
  const check = (svg: Element, colors: Map<string, string>): void => {
    const rects = Array.from(svg.querySelectorAll<SVGElement>('g[aria-label="bar"] rect'));
    expect(rects.length).toBe(6);
    for (const r of rects) {
      const hatched = /url\(/.test(r.style.fill);
      expect(hatched).toBe(paintOf(r).fill === colors.get("none"));
    }
  };
  it("live render", () => {
    const { svg, colors } = renderChart(spec, SERIES_AS_GROUPS as TidyRow[], { ...opts, document });
    check(svg, colors);
  });
  it("PNG export", () => {
    const { colors } = renderChart(spec, SERIES_AS_GROUPS as TidyRow[], { ...opts, document });
    check(buildExportSvg(spec, SERIES_AS_GROUPS as TidyRow[]), colors);
  });
});

describe("emission-order helpers", () => {
  type R = { c: string; z: string; y: number | null };
  const rows: R[] = [
    { c: "A", z: "p", y: 1 },
    { c: "C", z: "q", y: null },
    { c: "B", z: "q", y: 2 },
    { c: "A", z: "r", y: null },
    { c: "D", z: "p", y: 3 },
  ];
  const catOf = (r: R): string => r.c;
  it("rowEmissionOrder: faceted, by domain then data order, dropping rows outside the domain", () => {
    expect(rowEmissionOrder(rows, catOf, ["B", "A", "C"], true).map((r) => `${r.c}${r.z}`)).toEqual(["Bq", "Ap", "Ar", "Cq"]);
  });
  it("rowEmissionOrder: unfaceted, data order, dropping rows outside the domain", () => {
    expect(rowEmissionOrder(rows, catOf, ["B", "A", "C"], false).map((r) => `${r.c}${r.z}`)).toEqual(["Ap", "Cq", "Bq", "Ar"]);
  });
  it("groupEmissionOrder: first appearance over ALL rows, skipping groups with no defined point", () => {
    const defined = (r: R): boolean => Number.isFinite(r.y);
    expect(groupEmissionOrder(rows, (r) => r.z, defined).map((r) => r.z)).toEqual(["p", "q"]);
    // q's first row is undefined, but it still precedes r in first appearance; r has no defined point.
    expect(groupEmissionOrder([rows[1]!, rows[0]!, rows[2]!, rows[3]!], (r) => r.z, defined).map((r) => r.z)).toEqual(["q", "p"]);
  });
});
