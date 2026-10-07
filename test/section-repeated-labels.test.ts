// @vitest-environment jsdom
//
// Repeated row labels across sections (columns.section). A row is identified by section + category,
// so "Top 1%" under "Ranked by income" and "Top 1%" under "Ranked by net worth" are two rows that
// both READ "Top 1%". Before this, a category's section was the first one it appeared in and the
// second "Top 1%" merged silently into the first. The internal key that carries the identity must
// never reach a reader: axis labels, tooltip header, onHover payload, CSV download, aria text and
// the PNG export are each checked below.
import { describe, it, expect, beforeEach } from "vitest";
import { renderChart } from "../src/engine/index";
import { computeChartHeight, mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { BandHoverCtx } from "../src/engine/crosshair";
import { sectionCategoryKey } from "../src/spec/section-key";
import { validateChartData } from "../src/spec/validate";
import { resolveColor } from "../src/engine/palette";
import { mockRect1to1, cardShown, coordTexts } from "./helpers/hover-harness";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

beforeEach(() => {
  document.body.innerHTML = "";
});

const INCOME = "Ranked by income";
const WEALTH = "Ranked by net worth";

// PR #67's effective-tax-rates-top-groups data with the "by income" / "by net worth" suffixes the
// author had to add taken off again: three labels now repeat across the two sections.
const RAW: Array<[string, string, string, string]> = [
  [INCOME, "Top 1%", "25.8", "17.3"],
  [INCOME, "Top 0.1%", "28.7", "21.1"],
  [INCOME, "Top 0.01%", "29.4", "23.2"],
  [WEALTH, "Top 1%", "27.3", "13.2"],
  [WEALTH, "Top 0.1%", "28.6", "12.4"],
  [WEALTH, "Top 0.01%", "30.1", "8.6"],
  [WEALTH, "Net worth of $1 billion or more", "30.6", "8.0"],
];
const ROW_LABELS = RAW.map((r) => r[1]);
const ROWS: TidyRow[] = RAW.flatMap(([ranking, group, cash, accrual]) => [
  { ranking, group, income_measure: "Cash income", effective_rate: cash },
  { ranking, group, income_measure: "Accrual income", effective_rate: accrual },
]) as TidyRow[];
// The same chart as published, labels disambiguated by hand — the shape the repeated rows must match.
const DISAMBIGUATED: TidyRow[] = ROWS.map((r) => ({
  ...r,
  group: r.group === "Net worth of $1 billion or more" ? r.group : `${r.group} ${r.ranking === INCOME ? "by income" : "by net worth"}`,
})) as TidyRow[];

const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  orientation: "horizontal",
  title: "Projected Federal Effective Tax Rates on Top Groups, 2027",
  xAxisType: "categorical",
  columns: { category: "group", series: "income_measure", value: "effective_rate", section: "ranking" },
  series_order: ["Cash income", "Accrual income"],
  value_format: { decimals: 1, suffix: "%" },
  tooltip_decimals: 1,
  value_suffix: "%",
  yAxisPolicy: { min: 0 },
  data: "data.csv",
} as ChartSpec;

const BAR: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  title: "Effective rates",
  xAxisType: "categorical",
  columns: { x: "group", series: "income_measure", value: "effective_rate", section: "ranking" },
  series_order: ["Cash income", "Accrual income"],
  data: "data.csv",
} as ChartSpec;

/** One single-series bar row per (section, group), cash income only. */
const CASH_ROWS: TidyRow[] = ROWS.filter((r) => r.income_measure === "Cash income");
const BAR_SINGLE: ChartSpec = {
  ...BAR,
  columns: { x: "group", value: "effective_rate", section: "ranking" },
  series_order: undefined,
} as ChartSpec;

/** Every internal key this data could mint — none may surface anywhere a reader sees. */
const KEYS = RAW.map(([s, c]) => sectionCategoryKey(s, c));
const leaksKey = (text: string): boolean => KEYS.some((k) => text.includes(k));

/** Absolute (x, y) of a mark: its own cx/cy or x/y plus its own and every ancestor's translate. A
 *  text's em-based `y` is a baseline nudge, not a position, so it is left out. */
function absPos(el: Element): { x: number; y: number } {
  const num = (a: string | null) => (a != null && !a.endsWith("em") ? Number(a) : 0);
  let x = num(el.getAttribute("cx") ?? el.getAttribute("x"));
  let y = num(el.getAttribute("cy") ?? el.getAttribute("y"));
  for (let n: Element | null = el; n && n.tagName.toLowerCase() !== "svg"; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(n.getAttribute("transform") ?? "");
    if (m) { x += Number(m[1]); y += Number(m[2]); }
  }
  return { x, y };
}

const catLabels = (svg: SVGSVGElement): string[] =>
  Array.from(svg.querySelectorAll("g.tbl-cat-label text")).map((t) => t.textContent ?? "");

/** The row centres down the chart, top to bottom (distinct dot y). */
function dotRowsY(svg: SVGSVGElement): number[] {
  const ys = Array.from(svg.querySelectorAll('g[aria-label="dot"] circle')).map((c) => Math.round(absPos(c).y));
  return [...new Set(ys)].sort((a, b) => a - b);
}

function mount(spec: ChartSpec, rows: TidyRow[], extra: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec, rows, width: 720, ...extra } as never);
  const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
  mockRect1to1(svg);
  return { container, svg };
}

function hoverAt(svg: SVGSVGElement, x: number, y: number): void {
  svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
    new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }),
  );
}

const cardHead = (): string =>
  document.body.querySelector<HTMLElement>(".tbl-tooltip .tbl-tooltip-head")?.textContent ?? "";
const cardBody = (): string => document.body.querySelector<HTMLElement>(".tbl-tooltip")?.textContent ?? "";

describe("dumbbell — a label repeated across sections is two rows", () => {
  it("Fig 1 data with 'Top 1%' in both sections draws 7 rows", () => {
    const { svg } = renderChart(DUMBBELL, ROWS, { width: 720, height: computeChartHeight(DUMBBELL, ROWS), document });
    expect(catLabels(svg)).toEqual(ROW_LABELS);
    expect(svg.querySelectorAll('g[aria-label="dot"] circle').length).toBe(14);
    expect(dotRowsY(svg)).toHaveLength(7);
    // One stem per row: every row has two distinct values.
    expect(svg.querySelectorAll("g.tbl-dumbbell-connector line").length).toBe(7);
  });

  it("the second 'Top 1%' sits in the net-worth section, below its header", () => {
    const { svg } = renderChart(DUMBBELL, ROWS, { width: 720, height: computeChartHeight(DUMBBELL, ROWS), document });
    const labels = Array.from(svg.querySelectorAll("g.tbl-cat-label text"));
    const header = Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === WEALTH)!;
    expect(header).toBeTruthy();
    const y = (el: Element) => absPos(el).y;
    expect(y(labels[3]!)).toBeGreaterThan(y(header));
    expect(y(labels[2]!)).toBeLessThan(y(header));
  });

  it("is as tall as the same chart with the labels disambiguated by hand", () => {
    expect(computeChartHeight(DUMBBELL, ROWS)).toBe(computeChartHeight(DUMBBELL, DISAMBIGUATED));
  });

  it("hovering the second 'Top 1%' reports the net-worth values", () => {
    const { svg } = mount(DUMBBELL, ROWS);
    const rowsY = dotRowsY(svg);
    expect(rowsY).toHaveLength(7);
    hoverAt(svg, 400, rowsY[3]!);
    expect(cardShown()).toBe(true);
    expect(cardHead()).toBe("Top 1%");
    expect(cardBody()).toContain("27.3%");
    expect(cardBody()).toContain("13.2%");
    expect(cardBody()).not.toContain("25.8%");
    // And the first one still reports the income values.
    hoverAt(svg, 400, rowsY[0]!);
    expect(cardHead()).toBe("Top 1%");
    expect(cardBody()).toContain("25.8%");
    expect(cardBody()).toContain("17.3%");
  });

  it("an x_labels entry for 'Top 1%' applies to both rows", () => {
    const spec = { ...DUMBBELL, x_labels: { "Top 1%": "Top 1 percent" } } as ChartSpec;
    const { svg } = mount(spec, ROWS);
    const rowsY = dotRowsY(svg);
    hoverAt(svg, 400, rowsY[0]!);
    expect(cardHead()).toBe("Top 1 percent");
    hoverAt(svg, 400, rowsY[3]!);
    expect(cardHead()).toBe("Top 1 percent");
    expect(cardBody()).toContain("27.3%");
  });

  it("category_order sets the order within each section", () => {
    const spec = { ...DUMBBELL, category_order: ["Top 0.01%", "Top 0.1%", "Top 1%"] } as ChartSpec;
    const { svg } = renderChart(spec, ROWS, { width: 720, height: 600, document });
    expect(catLabels(svg)).toEqual([
      "Top 0.01%", "Top 0.1%", "Top 1%",
      "Top 0.01%", "Top 0.1%", "Top 1%", "Net worth of $1 billion or more",
    ]);
  });

  it("the tooltip hook is handed the display category", () => {
    const seen: string[] = [];
    const { svg } = mount(DUMBBELL, ROWS, { hooks: { tooltip: (ctx: { category: string }) => { seen.push(ctx.category); return null; } } });
    hoverAt(svg, 400, dotRowsY(svg)[3]!);
    expect(seen).toEqual(["Top 1%"]);
  });
});

describe("horizontal bar — a label repeated across sections is two rows", () => {
  it("grouped: 7 category rows, 14 bars", () => {
    const { svg } = renderChart(BAR, ROWS, { width: 720, height: computeChartHeight(BAR, ROWS), document });
    expect(catLabels(svg)).toEqual(ROW_LABELS);
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(14);
  });

  it("single-series: 7 bars, and is as tall as the disambiguated chart", () => {
    const { svg } = renderChart(BAR_SINGLE, CASH_ROWS, { width: 720, height: 500, document });
    expect(catLabels(svg)).toEqual(ROW_LABELS);
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(7);
    const disamb = DISAMBIGUATED.filter((r) => r.income_measure === "Cash income");
    expect(computeChartHeight(BAR_SINGLE, CASH_ROWS)).toBe(computeChartHeight(BAR_SINGLE, disamb));
  });

  it("x_order sets the order within each section", () => {
    const spec = { ...BAR_SINGLE, x_order: ["Top 0.01%", "Top 0.1%", "Top 1%"] } as ChartSpec;
    const { svg } = renderChart(spec, CASH_ROWS, { width: 720, height: 500, document });
    expect(catLabels(svg)).toEqual([
      "Top 0.01%", "Top 0.1%", "Top 1%",
      "Top 0.01%", "Top 0.1%", "Top 1%", "Net worth of $1 billion or more",
    ]);
  });

  it("category_colors names a bare label and colours it in every section", () => {
    const spec = { ...BAR_SINGLE, category_colors: { "Top 1%": "amber" } } as ChartSpec;
    const { svg } = renderChart(spec, CASH_ROWS, { width: 720, height: 500, document });
    const amber = resolveColor("amber");
    const fills = Array.from(svg.querySelectorAll('g[aria-label="bar"] rect')).map((r) => r.getAttribute("fill"));
    expect(fills.filter((f) => f === amber)).toHaveLength(2);
  });

  it("hovering the second 'Top 1%' reports the net-worth values to onHover, under the display name", () => {
    const seen: Array<BandHoverCtx | null> = [];
    const { svg } = mount(BAR, ROWS, { onHover: (ctx: BandHoverCtx | null) => seen.push(ctx) });
    const rects = Array.from(svg.querySelectorAll('g[aria-label="bar"] rect'));
    expect(rects).toHaveLength(14);
    const centreY = (r: Element) => absPos(r).y + Number(r.getAttribute("height")) / 2;
    const ys = [...new Set(rects.map((r) => Math.round(centreY(r) / 1)))].sort((a, b) => a - b);
    // Rects come in pairs per row; the row centre is between them.
    const rowCentres: number[] = [];
    for (let i = 0; i < ys.length; i += 2) rowCentres.push((ys[i]! + ys[i + 1]!) / 2);
    expect(rowCentres).toHaveLength(7);
    hoverAt(svg, 400, rowCentres[3]!);
    const ctx = seen.filter((c): c is BandHoverCtx => c != null).at(-1)!;
    expect(ctx).toBeTruthy();
    expect(ctx.category).toBe("Top 1%");
    expect(ctx.values).toEqual({ "Cash income": 27.3, "Accrual income": 13.2 });
    // The value pills the reader sees carry the same row's values.
    const pills = coordTexts(svg);
    expect(pills.some((p) => p.includes("27.3"))).toBe(true);
    expect(pills.some((p) => p.includes("13.2"))).toBe(true);
    expect(pills.some((p) => p.includes("25.8"))).toBe(false);
  });
});

describe("the internal row key never reaches a reader", () => {
  it("not in axis labels, section headers or any other SVG text (live and PNG export)", () => {
    for (const [spec, rows] of [[DUMBBELL, ROWS], [BAR, ROWS], [BAR_SINGLE, CASH_ROWS]] as const) {
      const { svg } = renderChart(spec, rows, { width: 720, height: 500, document });
      for (const t of Array.from(svg.querySelectorAll("text"))) expect(leaksKey(t.textContent ?? "")).toBe(false);
      const exported = buildExportSvg(spec, rows);
      expect(exported.querySelectorAll("text").length).toBeGreaterThan(0);
      for (const t of Array.from(exported.querySelectorAll("text"))) expect(leaksKey(t.textContent ?? "")).toBe(false);
      // The export draws the same 7 rows.
      expect(Array.from(exported.querySelectorAll("g.tbl-cat-label text")).map((t) => t.textContent)).toEqual(ROW_LABELS);
    }
  });

  it("not in aria text", () => {
    const { container } = mount(DUMBBELL, ROWS);
    const attrs = ["aria-label", "aria-description", "aria-roledescription", "aria-valuetext"];
    const aria = [
      ...Array.from(container.querySelectorAll("*")).flatMap((el) => attrs.map((a) => el.getAttribute(a) ?? "")),
      ...Array.from(container.querySelectorAll("title, desc")).map((el) => el.textContent ?? ""),
    ];
    expect(aria.some((a) => a !== "")).toBe(true);
    for (const a of aria) expect(leaksKey(a)).toBe(false);
  });

  it("not in the tooltip card", () => {
    const { svg } = mount(DUMBBELL, ROWS);
    for (const y of dotRowsY(svg)) {
      hoverAt(svg, 400, y);
      expect(leaksKey(document.body.querySelector(".tbl-tooltip")?.innerHTML ?? "")).toBe(false);
    }
  });

  it("not in the CSV download", async () => {
    const { container } = mount(DUMBBELL, ROWS);
    const blobs: Blob[] = [];
    const orig = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = ((b: Blob) => { blobs.push(b); return "blob:x"; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => {};
    try {
      container.querySelector<HTMLButtonElement>(".figure-download-btn")!.click();
    } finally {
      URL.createObjectURL = orig.create;
      URL.revokeObjectURL = orig.revoke;
    }
    expect(blobs).toHaveLength(1);
    const csv = await blobs[0]!.text();
    expect(csv).toContain("Top 1%");
    expect(leaksKey(csv)).toBe(false);
  });
});

describe("validation — rows are identified by section + category", () => {
  it("the same label in two sections is valid", () => {
    expect(validateChartData(DUMBBELL, ROWS).errors).toEqual([]);
  });

  it("the same section + category + series twice is an error", () => {
    const dup = [...ROWS, { ranking: WEALTH, group: "Top 1%", income_measure: "Cash income", effective_rate: "1" }] as TidyRow[];
    const { errors } = validateChartData(DUMBBELL, dup);
    expect(errors.join("\n")).toMatch(/category "Top 1%" in section "Ranked by net worth" has more than one "Cash income" value/);
  });

  it("faceted: the same section + category + series once per facet is valid, twice in one facet is not", () => {
    const spec = {
      ...BAR_SINGLE,
      columns: { x: "group", value: "effective_rate", section: "ranking", facet: "pane" },
      small_multiples: { columns: 2 },
    } as ChartSpec;
    const perPane = ["A", "B"].flatMap((pane) => CASH_ROWS.map((r) => ({ ...r, pane }))) as TidyRow[];
    expect(validateChartData(spec, perPane).errors).toEqual([]);
    const dup = [...perPane, { pane: "B", ranking: WEALTH, group: "Top 1%", income_measure: "Cash income", effective_rate: "1" }] as TidyRow[];
    expect(validateChartData(spec, dup).errors.join("\n")).toMatch(
      /category "Top 1%" in section "Ranked by net worth" in facet "B" has more than one value/,
    );
  });

  it("faceted horizontal bars compare section + category across panes", () => {
    // Pane B carries "Top 1%" only under the income section; pane A carries it under both.
    const rows = [
      { pane: "A", ranking: INCOME, group: "Top 1%", effective_rate: "1" },
      { pane: "A", ranking: WEALTH, group: "Top 1%", effective_rate: "2" },
      { pane: "B", ranking: INCOME, group: "Top 1%", effective_rate: "3" },
      { pane: "B", ranking: WEALTH, group: "Top 0.1%", effective_rate: "4" },
      { pane: "A", ranking: WEALTH, group: "Top 0.1%", effective_rate: "5" },
    ] as TidyRow[];
    const spec = {
      ...BAR_SINGLE,
      columns: { x: "group", value: "effective_rate", section: "ranking", facet: "pane" },
      small_multiples: { columns: 2 },
    } as ChartSpec;
    const { errors } = validateChartData(spec, rows);
    expect(errors.join("\n")).toMatch(/facet "B" is missing category "Top 1%" \(section "Ranked by net worth"\)/);
  });
});

// ---------------------------------------------------------------------------
// E6 fix: a label is only ever split if the engine minted it as a key, and the keying decision is
// the FIGURE's, so every pane names a row the same way.

describe("an author label containing the separator character is never split", () => {
  // U+E000, the Private Use Area code point the key format uses. An author can type it.
  const PUA = String.fromCharCode(0xe000);
  const LABEL = `Before${PUA}After`;

  it("no repeats: the label is drawn whole, live and in the PNG export", () => {
    const rows = [
      { ranking: INCOME, group: LABEL, effective_rate: "10" },
      { ranking: WEALTH, group: "Other", effective_rate: "20" },
    ] as TidyRow[];
    expect(validateChartData(BAR_SINGLE, rows).errors).toEqual([]);
    const { svg } = renderChart(BAR_SINGLE, rows, { width: 720, height: 500, document });
    expect(catLabels(svg)).toEqual([LABEL, "Other"]);
    const exported = buildExportSvg(BAR_SINGLE, rows);
    expect(Array.from(exported.querySelectorAll("g.tbl-cat-label text")).map((t) => t.textContent)).toEqual([LABEL, "Other"]);
  });

  it("no repeats: the tooltip header and onHover name the whole label", () => {
    const rows = [
      { ranking: INCOME, group: LABEL, effective_rate: "10" },
      { ranking: WEALTH, group: "Other", effective_rate: "20" },
    ] as TidyRow[];
    const seen: Array<BandHoverCtx | null> = [];
    const { svg } = mount(BAR_SINGLE, rows, { onHover: (ctx: BandHoverCtx | null) => seen.push(ctx) });
    const r = svg.querySelector('g[aria-label="bar"] rect')!;
    hoverAt(svg, 400, absPos(r).y + Number(r.getAttribute("height")) / 2);
    expect(seen.filter((c): c is BandHoverCtx => c != null).at(-1)?.category).toBe(LABEL);
  });

  it("with repeats: labels and sections that contain the separator keep distinct rows and whole text", () => {
    // Section "X<PUA>" + "Y" and section "X" + "<PUA>Y" concatenate to the same string around a
    // separator; they are two rows. "Z" repeats, so the chart is keyed.
    const rows = [
      { ranking: `X${PUA}`, group: "Y", effective_rate: "1" },
      { ranking: `X${PUA}`, group: "Z", effective_rate: "2" },
      { ranking: "X", group: `${PUA}Y`, effective_rate: "3" },
      { ranking: "X", group: "Z", effective_rate: "4" },
    ] as TidyRow[];
    const { svg } = renderChart(BAR_SINGLE, rows, { width: 720, height: 500, document });
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(4);
    expect(catLabels(svg)).toEqual(["Y", "Z", `${PUA}Y`, "Z"]);
  });
});

describe("keying is decided for the whole figure, so a coordinated hover crosses panes", () => {
  // Pane P repeats "A" across both sections; pane Q has "A" in one section only. columns: 1 lets
  // the panes carry different rows. Q must still answer when P's "A" (section S) is hovered.
  const S = "Section S";
  const T = "Section T";
  const FIG_ROWS = [
    { pane: "P", ranking: S, group: "A", effective_rate: "1" },
    { pane: "P", ranking: T, group: "A", effective_rate: "2" },
    { pane: "P", ranking: T, group: "B", effective_rate: "3" },
    { pane: "Q", ranking: S, group: "A", effective_rate: "4" },
    { pane: "Q", ranking: T, group: "B", effective_rate: "5" },
  ] as TidyRow[];

  for (const mode of ["shared", "per-pane"] as const) {
    it(`${mode} mode: hovering P's first "A" echoes Q's "A" value, and back`, () => {
      const spec = {
        ...BAR_SINGLE,
        columns: { x: "group", value: "effective_rate", section: "ranking", facet: "pane" },
        small_multiples: { columns: 1, mode, pane_order: ["P", "Q"] },
      } as ChartSpec;
      expect(validateChartData(spec, FIG_ROWS).errors).toEqual([]);
      const container = document.createElement("div");
      document.body.appendChild(container);
      mountChart(container, { spec, rows: FIG_ROWS, width: 720 } as never);
      const [p, q] = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
      expect(q).toBeTruthy();
      mockRect1to1(p!);
      mockRect1to1(q!);
      const firstRowY = (svg: SVGSVGElement): number => {
        const rects = Array.from(svg.querySelectorAll('g[aria-label="bar"] rect'));
        return Math.min(...rects.map((r) => absPos(r).y + Number(r.getAttribute("height")) / 2));
      };
      hoverAt(p!, 400, firstRowY(p!));
      expect(coordTexts(p!).some((t) => t.includes("1"))).toBe(true);
      expect(q!.querySelector("g.tbl-coord")?.getAttribute("opacity")).toBe("1");
      expect(coordTexts(q!).some((t) => t.includes("4"))).toBe(true);
      hoverAt(q!, 400, firstRowY(q!));
      expect(p!.querySelector("g.tbl-coord")?.getAttribute("opacity")).toBe("1");
      expect(coordTexts(p!).some((t) => t.includes("1"))).toBe(true);
    });
  }
});

describe("hooks.valueLabel names the display category (util.ts applyValueLabelHook)", () => {
  // Reached through a sectioned horizontal stack: its net text and segment labels go through the hook.
  it("a sectioned stack with a repeated label hands the hook the bare label, never the key", () => {
    const spec = {
      chartType: "stacked",
      orientation: "horizontal",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "group", series: "income_measure", value: "effective_rate", section: "ranking" },
      series_order: ["Cash income", "Accrual income"],
      barStack: { netDisplay: "text" },
      valueLabels: { show: true },
      data: "d.csv",
    } as ChartSpec;
    const seen: string[] = [];
    renderChart(spec, ROWS, { width: 720, height: 600, document, hooks: { valueLabel: (ctx) => { seen.push(ctx.category); return null; } } });
    expect(seen.length).toBeGreaterThan(0);
    for (const c of seen) expect(leaksKey(c), c).toBe(false);
    // The net text of both "Top 1%" rows asked under the display name.
    expect(seen.filter((c) => c === "Top 1%").length).toBeGreaterThanOrEqual(2);
  });
});
