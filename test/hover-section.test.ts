// @vitest-environment jsdom
//
// The onHover payload names the hovered row's section (Ruling 77). Two rows can share a category
// across sections, so `category` alone cannot say which one the pointer is on. `section` follows
// `category`'s convention: the raw data value (not its `section_labels` name), and absent on a chart
// without sections.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { BandHoverCtx } from "../src/engine/crosshair";
import { mockRect1to1 } from "./helpers/hover-harness";
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
  [WEALTH, "Top 1%", 27.3, 13.2],
  [WEALTH, "Billionaires", 30.6, 8.0],
];
const rowsOf = (sign = 1, pane?: string): TidyRow[] =>
  RAW.flatMap(([ranking, group, a, b]) => [
    { ...(pane ? { pane } : {}), ranking, group, measure: "Cash", rate: String(a) },
    { ...(pane ? { pane } : {}), ranking, group, measure: "Accrual", rate: String(sign * b) },
  ]) as TidyRow[];

const base = {
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "group", series: "measure", value: "rate", section: "ranking" },
  series_order: ["Cash", "Accrual"],
  data: "d.csv",
};
const BAR = { ...base, chartType: "bar" } as ChartSpec;
const STACKED = { ...base, chartType: "stacked" } as ChartSpec;

function translateY(el: Element): number {
  let y = 0;
  for (let n: Element | null = el; n && n.tagName.toLowerCase() !== "svg"; n = n.parentElement) {
    const m = /translate\(\s*-?[\d.]+[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) y += Number(m[1]);
  }
  return y;
}
/** Row centres, top to bottom: the mean of each row's rect centres. */
function rowCentres(svg: SVGSVGElement): number[] {
  const byFacet = new Map<Element, number[]>();
  for (const r of Array.from(svg.querySelectorAll('g[aria-label="bar"] rect'))) {
    const c = translateY(r.parentElement!) + Number(r.getAttribute("y")) + Number(r.getAttribute("height")) / 2;
    const g = r.parentElement!;
    byFacet.set(g, [...(byFacet.get(g) ?? []), c]);
  }
  return [...byFacet.values()].map((cs) => (Math.min(...cs) + Math.max(...cs)) / 2).sort((a, b) => a - b);
}

function mount(spec: ChartSpec, rows: TidyRow[]) {
  const seen: Array<BandHoverCtx | null> = [];
  const events: unknown[] = [];
  const c = document.createElement("div");
  document.body.appendChild(c);
  c.addEventListener("tbl-hover", (e) => events.push((e as CustomEvent).detail));
  mountChart(c, { spec, rows, width: 720, onHover: (x) => seen.push(x) });
  const svgs = Array.from(c.querySelectorAll<SVGSVGElement>(spec.small_multiples ? ".figure-pane svg" : ".figure-canvas svg"));
  svgs.forEach(mockRect1to1);
  const hover = (svg: SVGSVGElement, y: number) =>
    svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: y, bubbles: true }));
  const last = () => seen.filter((x): x is BandHoverCtx => x != null).at(-1)!;
  return { svgs, hover, last, events };
}

describe("onHover reports the hovered row's section", () => {
  for (const [name, spec, sign] of [
    ["grouped bar", BAR, 1],
    ["stacked (pills)", STACKED, 1],
    ["stacked (net dot, card)", STACKED, -1],
  ] as Array<[string, ChartSpec, number]>) {
    it(`${name}: the two 'Top 1%' rows report their own sections`, () => {
      const { svgs, hover, last, events } = mount(spec, rowsOf(sign));
      const ys = rowCentres(svgs[0]!);
      expect(ys).toHaveLength(4);
      hover(svgs[0]!, ys[0]!);
      expect(last()).toMatchObject({ category: "Top 1%", section: INCOME });
      hover(svgs[0]!, ys[2]!);
      expect(last()).toMatchObject({ category: "Top 1%", section: WEALTH, values: { Cash: 27.3, Accrual: sign * 13.2 } });
      // The bubbling event carries the same object.
      expect(events.at(-1)).toEqual(last());
    });
  }

  it("a sectioned chart without a repeated label reports the section too", () => {
    const rows = rowsOf().filter((r) => !(r.ranking === WEALTH && r.group === "Top 1%"));
    const { svgs, hover, last } = mount(BAR, rows);
    const ys = rowCentres(svgs[0]!);
    hover(svgs[0]!, ys[2]!);
    expect(last()).toMatchObject({ category: "Billionaires", section: WEALTH });
  });

  it("section and category are the raw values, not their section_labels / x_labels names", () => {
    const spec = { ...BAR, section_labels: { [WEALTH]: "By net worth" }, x_labels: { "Top 1%": "Top 1 percent" } } as ChartSpec;
    const { svgs, hover, last } = mount(spec, rowsOf());
    hover(svgs[0]!, rowCentres(svgs[0]!)[2]!);
    expect(last().section).toBe(WEALTH);
    expect(last().category).toBe("Top 1%");
  });

  it("small multiples: a pane reports its row's section and its facet", () => {
    const spec = {
      ...STACKED,
      columns: { ...base.columns, facet: "pane" },
      small_multiples: { columns: 2, pane_order: ["P1", "P2"] },
    } as ChartSpec;
    const { svgs, hover, last } = mount(spec, [...rowsOf(1, "P1"), ...rowsOf(1, "P2")]);
    hover(svgs[1]!, rowCentres(svgs[1]!)[2]!);
    expect(last()).toMatchObject({ category: "Top 1%", section: WEALTH, facet: "P2" });
  });

  it("a chart without sections has no section field", () => {
    const spec = { ...BAR, columns: { x: "group", series: "measure", value: "rate" } } as ChartSpec;
    const rows = rowsOf().filter((r) => r.ranking === INCOME);
    const { svgs, hover, last } = mount(spec, rows);
    hover(svgs[0]!, rowCentres(svgs[0]!)[0]!);
    expect(last().category).toBe("Top 1%");
    expect("section" in last()).toBe(false);
  });
});
