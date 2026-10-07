// @vitest-environment jsdom
//
// Repeated row labels across sections on a SECTIONED HORIZONTAL STACK (see
// section-repeated-labels.test.ts for bar and dumbbell). "Top 1%" under two sections is two stacks,
// each reading "Top 1%". The reference is the same chart with the second section's labels
// disambiguated to the same LENGTH ("Top 1%" -> "Pot 1%"): label width is estimated from length, so
// the reference lays out pixel for pixel like the repeated chart, and every mark, tag and position
// must match it. Only the category label text and the row identity (data-category) may differ.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderChart, TOTAL_SERIES_KEY } from "../src/engine/index";
import { computeChartHeight, mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { BandHoverCtx } from "../src/engine/crosshair";
import { sectionCategoryKey } from "../src/spec/section-key";
import { validateChartData } from "../src/spec/validate";
import { mockRect1to1, cardShown, cardText, coordTexts } from "./helpers/hover-harness";
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

const INCOME = "Ranked by income";
const WEALTH = "Ranked by net worth";
const RAW: Array<[string, string, number, number]> = [
  [INCOME, "Top 1%", 25.8, 17.3],
  [INCOME, "Top 0.1%", 28.7, 21.1],
  [INCOME, "Top 0.01%", 29.4, 23.2],
  [WEALTH, "Top 1%", 27.3, 13.2],
  [WEALTH, "Top 0.1%", 28.6, 12.4],
  [WEALTH, "Top 0.01%", 30.1, 8.6],
  [WEALTH, "Net worth of $1 billion or more", 30.6, 8.0],
];
const ROW_LABELS = RAW.map((r) => r[1]);
/** Same length, different text: the reference chart's second-section labels. */
const twin = (label: string): string => label.replace(/^Top/, "Pot");
const TWIN_LABELS = RAW.map(([s, c]) => (s === WEALTH ? twin(c) : c));

/** `sign` flips the second series, for the net-dot (diverging) case. */
const rowsOf = (disambiguate: boolean, sign = 1): TidyRow[] =>
  RAW.flatMap(([ranking, group, a, b]) => {
    const g = disambiguate && ranking === WEALTH ? twin(group) : group;
    return [
      { ranking, group: g, measure: "Cash", rate: String(a) },
      { ranking, group: g, measure: "Accrual", rate: String(sign * b) },
    ];
  }) as TidyRow[];

const SPEC: ChartSpec = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "Effective rates",
  xAxisType: "categorical",
  columns: { x: "group", series: "measure", value: "rate", section: "ranking" },
  series_order: ["Cash", "Accrual"],
  data: "d.csv",
} as ChartSpec;
const NET_TEXT = { ...SPEC, barStack: { netDisplay: "text" }, valueLabels: { show: true } } as ChartSpec;

const KEYS = RAW.map(([s, c]) => sectionCategoryKey(s, c));
const leaksKey = (text: string): boolean => KEYS.some((k) => text.includes(k));

// --- geometry (jsdom has no layout: attributes + ancestor translates) ---
function translateOf(el: Element): [number, number] {
  let x = 0;
  let y = 0;
  for (let n: Element | null = el; n && n.tagName.toLowerCase() !== "svg"; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) { x += Number(m[1]); y += Number(m[2]); }
  }
  return [x, y];
}
const catLabels = (svg: Element): string[] =>
  Array.from(svg.querySelectorAll("g.tbl-cat-label text")).map((t) => t.textContent ?? "");
/** Every drawn mark and non-label text, with its absolute position and its series tag. */
function marks(svg: Element): string[] {
  const out: string[] = [];
  for (const r of Array.from(svg.querySelectorAll("rect"))) {
    const [tx, ty] = translateOf(r.parentElement!);
    out.push(`rect ${tx + Number(r.getAttribute("x"))},${ty + Number(r.getAttribute("y"))} ${r.getAttribute("width")}x${r.getAttribute("height")} ${r.getAttribute("fill")} ${r.getAttribute("data-series")}`);
  }
  for (const c of Array.from(svg.querySelectorAll("circle"))) {
    const [tx, ty] = translateOf(c.parentElement!);
    out.push(`circle ${tx + Number(c.getAttribute("cx"))},${ty + Number(c.getAttribute("cy"))} ${c.getAttribute("data-series")}`);
  }
  for (const t of Array.from(svg.querySelectorAll("text"))) {
    if (t.closest("g.tbl-cat-label")) continue;
    out.push(`text ${t.textContent} @${translateOf(t).join(",")}`);
  }
  const s = svg as SVGSVGElement;
  out.push(`frame ${s.getAttribute("height")} ${s.dataset?.marginTop} ${s.dataset?.marginBottom} ${s.dataset?.marginLeft}`);
  return out;
}
/** Row centres, top to bottom: one per drawn stack. */
function rowCentres(svg: SVGSVGElement): number[] {
  const ys = Array.from(svg.querySelectorAll('g[aria-label="bar"] rect')).map((r) => {
    const [, ty] = translateOf(r.parentElement!);
    return Math.round(ty + Number(r.getAttribute("y")) + Number(r.getAttribute("height")) / 2);
  });
  return [...new Set(ys)].sort((a, b) => a - b);
}

const render = (spec: ChartSpec, rows: TidyRow[]) =>
  renderChart(spec, rows, { width: 720, height: computeChartHeight(spec, rows), document }).svg;

function mount(spec: ChartSpec, rows: TidyRow[], extra: Record<string, unknown> = {}) {
  const seen: Array<BandHoverCtx | null> = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec, rows, width: 720, onHover: (c: BandHoverCtx | null) => seen.push(c), ...extra } as never);
  const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
  mockRect1to1(svg);
  const last = () => seen.filter((c): c is BandHoverCtx => c != null).at(-1);
  return { container, svg, last };
}
const hoverAt = (svg: SVGSVGElement, y: number) =>
  svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: y, bubbles: true }));
const cardHead = (): string => document.body.querySelector(".tbl-tooltip .tbl-tooltip-head")?.textContent ?? "";

// ---------------------------------------------------------------------------

describe("sectioned stack: a label repeated across sections is one stack per section", () => {
  for (const [name, spec, sign] of [
    ["all positive (net text off, pills)", SPEC, 1],
    ["negatives (net dot)", SPEC, -1],
    ["net text + segment labels", NET_TEXT, 1],
  ] as Array<[string, ChartSpec, number]>) {
    it(`${name}: 7 stacks, every mark, tag and position as the disambiguated chart's`, () => {
      const svg = render(spec, rowsOf(false, sign));
      const ref = render(spec, rowsOf(true, sign));
      expect(catLabels(svg)).toEqual(ROW_LABELS);
      expect(catLabels(ref)).toEqual(TWIN_LABELS);
      expect(rowCentres(svg)).toHaveLength(7);
      expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(14);
      expect(marks(svg)).toEqual(marks(ref));
    });

    it(`${name}: the PNG export draws the same 7 stacks, as the disambiguated export does`, () => {
      const exp = buildExportSvg(spec, rowsOf(false, sign));
      const ref = buildExportSvg(spec, rowsOf(true, sign));
      expect(catLabels(exp)).toEqual(ROW_LABELS);
      expect(marks(exp)).toEqual(marks(ref));
    });
  }

  it("is as tall as the disambiguated chart", () => {
    expect(computeChartHeight(SPEC, rowsOf(false))).toBe(computeChartHeight(SPEC, rowsOf(true)));
  });

  it("net dot: one Total-tagged dot per stack, 7 in all", () => {
    const svg = render(SPEC, rowsOf(false, -1));
    const dots = Array.from(svg.querySelectorAll("g.tbl-net-marker circle"));
    expect(dots).toHaveLength(7);
    for (const d of dots) expect(d.getAttribute("data-series")).toBe(TOTAL_SERIES_KEY);
  });

  it("x_order sets the order within each section", () => {
    const spec = { ...SPEC, x_order: ["Top 0.01%", "Top 0.1%", "Top 1%"] } as ChartSpec;
    expect(catLabels(render(spec, rowsOf(false)))).toEqual([
      "Top 0.01%", "Top 0.1%", "Top 1%",
      "Top 0.01%", "Top 0.1%", "Top 1%", "Net worth of $1 billion or more",
    ]);
  });

  it("x_axis_ticks: both — the same margins and marks as the disambiguated chart", () => {
    const spec = { ...SPEC, x_axis_ticks: "both" } as ChartSpec;
    expect(marks(render(spec, rowsOf(false)))).toEqual(marks(render(spec, rowsOf(true))));
  });

  it("legend pin: pinning a series dims the same segments as on the disambiguated chart", () => {
    const pinned = (rows: TidyRow[]): string[] => {
      document.body.innerHTML = "";
      const { container, svg } = mount(SPEC, rows);
      container.querySelector<HTMLElement>('.tbl-legend-item[data-series="Accrual"]')!.click();
      return Array.from(svg.querySelectorAll('g[aria-label="bar"] rect')).map(
        (r) => `${r.getAttribute("data-series")}:${r.classList.contains("tbl-dimmed") ? "dim" : "on"}`,
      );
    };
    const a = pinned(rowsOf(false));
    expect(a.filter((s) => s === "Cash:dim")).toHaveLength(7);
    expect(a.filter((s) => s === "Accrual:on")).toHaveLength(7);
    expect(a).toEqual(pinned(rowsOf(true)));
  });
});

describe("sectioned stack: hover reads the row under the pointer, under its display name", () => {
  it("pills: the second 'Top 1%' reports the net-worth values to onHover and its pills", () => {
    const { svg, last } = mount(SPEC, rowsOf(false));
    const ys = rowCentres(svg);
    expect(ys).toHaveLength(7);
    hoverAt(svg, ys[3]!);
    expect(last()?.category).toBe("Top 1%");
    expect(last()?.values).toEqual({ Cash: 27.3, Accrual: 13.2 });
    const pills = coordTexts(svg).map(Number);
    expect(pills).toContain(27.3);
    expect(pills).toContain(13.2);
    expect(pills).not.toContain(25.8);
    hoverAt(svg, ys[0]!);
    expect(last()?.values).toEqual({ Cash: 25.8, Accrual: 17.3 });
  });

  it("card (net dot): each 'Top 1%' card is headed by the bare label, or its x_labels name, with its own values", () => {
    for (const [spec, head] of [
      [SPEC, "Top 1%"],
      [{ ...SPEC, x_labels: { "Top 1%": "Top 1 percent" } } as ChartSpec, "Top 1 percent"],
    ] as Array<[ChartSpec, string]>) {
      document.body.innerHTML = "";
      const { svg } = mount(spec, rowsOf(false, -1));
      const ys = rowCentres(svg);
      hoverAt(svg, ys[3]!);
      expect(cardShown()).toBe(true);
      expect(cardHead()).toBe(head);
      expect(cardText()).toContain("27.3");
      expect(cardText()).not.toContain("25.8");
      hoverAt(svg, ys[0]!);
      expect(cardHead()).toBe(head);
      expect(cardText()).toContain("25.8");
    }
  });
});

describe("sectioned stack: the internal row key never reaches a reader", () => {
  for (const [name, spec, sign] of [
    ["pills", SPEC, 1],
    ["net dot", SPEC, -1],
    ["net text + segment labels", NET_TEXT, 1],
  ] as Array<[string, ChartSpec, number]>) {
    it(`${name}: not in any SVG text (live and export), aria text, the hover readout or the CSV`, async () => {
      const rows = rowsOf(false, sign);
      for (const t of Array.from(render(spec, rows).querySelectorAll("text"))) expect(leaksKey(t.textContent ?? "")).toBe(false);
      for (const t of Array.from(buildExportSvg(spec, rows).querySelectorAll("text"))) expect(leaksKey(t.textContent ?? "")).toBe(false);

      const { container, svg } = mount(spec, rows);
      const attrs = ["aria-label", "aria-description", "aria-roledescription", "aria-valuetext"];
      const aria = [
        ...Array.from(container.querySelectorAll("*")).flatMap((el) => attrs.map((a) => el.getAttribute(a) ?? "")),
        ...Array.from(container.querySelectorAll("title, desc")).map((el) => el.textContent ?? ""),
      ];
      for (const a of aria) expect(leaksKey(a)).toBe(false);
      for (const y of rowCentres(svg)) {
        hoverAt(svg, y);
        expect(leaksKey(document.body.querySelector(".tbl-tooltip")?.innerHTML ?? "")).toBe(false);
        for (const t of coordTexts(svg)) expect(leaksKey(t)).toBe(false);
        for (const t of Array.from(svg.querySelectorAll("text"))) expect(leaksKey(t.textContent ?? "")).toBe(false);
      }

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
      const csv = await blobs[0]!.text();
      expect(csv).toContain("Top 1%");
      expect(leaksKey(csv)).toBe(false);
    });
  }
});

describe("sectioned stack validation: rows are identified by section + category", () => {
  it("a label repeated across sections is valid", () => {
    expect(validateChartData(SPEC, rowsOf(false)).errors).toEqual([]);
  });

  it("the same section + category + series twice is an error", () => {
    const dup = [...rowsOf(false), { ranking: WEALTH, group: "Top 1%", measure: "Cash", rate: "1" }] as TidyRow[];
    expect(validateChartData(SPEC, dup).errors.join("\n")).toMatch(
      /category "Top 1%" in section "Ranked by net worth" has more than one "Cash" value/,
    );
  });
});
