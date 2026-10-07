// @vitest-environment jsdom
//
// `tooltip_section: true` on a sectioned chart puts the hovered row's section in the hover card's
// header, before the category: "<section label> · <category label>", each through section_labels /
// x_labels. Card header only: the bar's pills and the coordinated echo are unchanged, so it does
// nothing where the chart hovers with pills. Default false leaves the header as the category alone.
// Validation rejects it on a chart without sections.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { CROSSHAIR_HIT_SELECTOR, buildBandTooltipHtml } from "../src/engine/crosshair";
import { validateSpec } from "../src/spec/validate";
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

// Two sections; "Before response" repeats across them, so only the section tells the rows apart.
const SERIES = ["Income", "Corporate"];
const CATS: Array<[string, string]> = [
  ["Before response", "cg"],
  ["After response", "cg"],
  ["Before response", "corp"],
  ["After response", "corp"],
];
const NEG = { Income: [10, 20, 30, 40], Corporate: [-30, -6, -40, -2] };
const stackRows = (pane?: string): TidyRow[] =>
  SERIES.flatMap((s) =>
    CATS.map(([bar, sec], i) => ({ ...(pane ? { pane } : {}), bar, sec, tax: s, v: String(NEG[s as keyof typeof NEG][i]) })),
  ) as unknown as TidyRow[];
const LABELS = {
  section_labels: { cg: "Capital gains", corp: "+ Corporate" },
  x_labels: { "Before response": "Before any response" },
};
const STACK: ChartSpec = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "bar", series: "tax", value: "v", section: "sec" },
  series_order: SERIES,
  barStack: { hover: "tooltip" },
  ...LABELS,
  data: "d.csv",
};
const STACK_FIG: ChartSpec = {
  ...STACK,
  columns: { ...STACK.columns, facet: "pane" },
  small_multiples: { columns: 2, mode: "shared", pane_order: ["P1", "P2"] },
};
const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { category: "bar", series: "m", value: "v", section: "sec" },
  series_order: ["Cash", "Accrual"],
  ...LABELS,
  data: "d.csv",
};
const dbRows = (pane?: string): TidyRow[] =>
  CATS.flatMap(([bar, sec], i) => [
    { ...(pane ? { pane } : {}), bar, sec, m: "Cash", v: String(20 + i) },
    { ...(pane ? { pane } : {}), bar, sec, m: "Accrual", v: String(8 + i) },
  ]) as unknown as TidyRow[];
const DUMBBELL_FIG: ChartSpec = {
  ...DUMBBELL,
  columns: { ...DUMBBELL.columns, facet: "pane" },
  small_multiples: { pane_order: ["P1", "P2"] },
};
// A plain bar hovers with value pills, standalone and in a coordinated pane; a small-multiples pane
// with `coordinated_cursor: false` hovers with the band card instead, so the header applies there.
const barRows = (pane?: string): TidyRow[] =>
  CATS.map(([bar, sec], i) => ({ ...(pane ? { pane } : {}), bar, sec, v: String(10 + i) })) as unknown as TidyRow[];
const BAR: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "bar", value: "v", section: "sec" },
  ...LABELS,
  data: "d.csv",
};
const BAR_FIG_UNCOORD: ChartSpec = {
  ...BAR,
  columns: { ...BAR.columns, facet: "pane" },
  small_multiples: { columns: 2, mode: "shared", pane_order: ["P1", "P2"], coordinated_cursor: false },
};
// A stack in pills mode hovers with pills when coordinated, and with its card when not.
const STACK_PILLS_FIG_UNCOORD: ChartSpec = {
  ...STACK_FIG,
  barStack: { hover: "pills" },
  small_multiples: { ...STACK_FIG.small_multiples, coordinated_cursor: false },
};

function translateY(el: Element, svg: Element): number {
  let y = 0;
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) y += Number(m[2]);
  }
  return y;
}
/** Row centres top to bottom, from the label pane's labels. */
const centres = (svg: SVGSVGElement): number[] =>
  Array.from(svg.querySelectorAll("g.tbl-cat-label text"))
    .map((t) => translateY(t, svg))
    .sort((a, b) => a - b);
function hover(svg: SVGSVGElement, y: number): void {
  svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
    new PointerEvent("pointermove", { clientX: svg.viewBox.baseVal.width * 0.7, clientY: y, bubbles: true }),
  );
}
/** The visible card's header text. */
const head = (): string | null => {
  const tips = Array.from(document.querySelectorAll<HTMLElement>(".tbl-tooltip")).filter((t) => t.style.opacity === "1");
  return tips.at(-1)?.querySelector(".tbl-tooltip-head")?.textContent ?? null;
};
function mount(spec: ChartSpec, rows: TidyRow[]): SVGSVGElement[] {
  const c = document.createElement("div");
  document.body.appendChild(c);
  mountChart(c, { spec, rows, width: 900, ...(spec.small_multiples ? {} : { height: 500 }) });
  const svgs = Array.from(c.querySelectorAll<SVGSVGElement>(spec.small_multiples ? ".figure-pane svg" : ".figure-canvas svg"));
  svgs.forEach(mockRect1to1);
  return svgs;
}

const WITH = ["Capital gains · Before any response", "Capital gains · After response", "+ Corporate · Before any response", "+ Corporate · After response"];
const WITHOUT = ["Before any response", "After response", "Before any response", "After response"];

const CASES: Array<[string, ChartSpec, (pane?: string) => TidyRow[]]> = [
  ["stacked (card)", STACK, stackRows],
  ["dumbbell", DUMBBELL, dbRows],
  ["stacked small multiples", STACK_FIG, (_p) => [...stackRows("P1"), ...stackRows("P2")]],
  ["dumbbell small multiples", DUMBBELL_FIG, (_p) => [...dbRows("P1"), ...dbRows("P2")]],
  ["bar small multiples, coordinated_cursor: false", BAR_FIG_UNCOORD, (_p) => [...barRows("P1"), ...barRows("P2")]],
  [
    "bar per-pane small multiples, coordinated_cursor: false",
    { ...BAR_FIG_UNCOORD, small_multiples: { ...BAR_FIG_UNCOORD.small_multiples, mode: "per-pane" } },
    (_p) => [...barRows("P1"), ...barRows("P2")],
  ],
  ["pills-mode stack small multiples, coordinated_cursor: false",STACK_PILLS_FIG_UNCOORD, (_p) => [...stackRows("P1"), ...stackRows("P2")]],
];

describe("tooltip_section: the card header names the section first", () => {
  for (const [name, spec, rowsOf] of CASES) {
    it(`${name}: "<section> · <category>" for every row, through section_labels and x_labels`, () => {
      // Validation accepts every configuration whose card it changes.
      expect(validateSpec({ ...spec, tooltip_section: true }).errors).toEqual([]);
      const svgs = mount({ ...spec, tooltip_section: true }, rowsOf());
      // Hover each pane (the label-less one included): every card names its row's section.
      for (const svg of svgs) {
        const ys = centres(svgs[0]!);
        expect(ys).toHaveLength(4);
        expect(ys.map((y) => (hover(svg, y), head()))).toEqual(WITH);
      }
    });

    it(`${name}: unset or false keeps the category alone`, () => {
      for (const flag of [undefined, false]) {
        const svgs = mount({ ...spec, ...(flag === false ? { tooltip_section: false } : {}) }, rowsOf());
        const ys = centres(svgs[0]!);
        expect(ys).toHaveLength(4);
        // Every pane, the label-less one included.
        for (const svg of svgs) expect(ys.map((y) => (hover(svg, y), head()))).toEqual(WITHOUT);
        document.body.innerHTML = "";
      }
    });
  }

  it("a no-op where a bar hovers with pills: standalone, and a coordinated pane", () => {
    const coordFig = { ...BAR_FIG_UNCOORD, small_multiples: { columns: 2, mode: "shared", pane_order: ["P1", "P2"] } } as ChartSpec;
    const cases: Array<[ChartSpec, TidyRow[]]> = [[BAR, barRows()], [coordFig, [...barRows("P1"), ...barRows("P2")]]];
    for (const [spec, rows] of cases) {
      const svgs = mount({ ...spec, tooltip_section: true }, rows);
      const ys = centres(svgs[0]!);
      expect(ys).toHaveLength(4);
      for (const svg of svgs) expect(ys.map((y) => (hover(svg, y), head()))).toEqual([null, null, null, null]);
      document.body.innerHTML = "";
    }
  });

  it("a raw section without a section_labels entry shows as itself", () => {
    const svgs = mount({ ...STACK, section_labels: { cg: "Capital gains" }, tooltip_section: true }, stackRows());
    hover(svgs[0]!, centres(svgs[0]!)[3]!);
    expect(head()).toBe("corp · After response");
  });

  it("the builder escapes both halves", () => {
    const html = buildBandTooltipHtml("a<b", [{ _xc: "a<b", series: "s", _y: 1, _section: "x&y" }], {
      tooltipSection: true,
    });
    expect(html).toContain('<div class="tbl-tooltip-head">x&amp;y · a&lt;b</div>');
  });
});

describe("tooltip_section: validation", () => {
  const ok = (spec: ChartSpec) => validateSpec(spec);
  it("accepted on a sectioned stack and dumbbell", () => {
    for (const spec of [STACK, DUMBBELL, STACK_FIG]) {
      for (const v of [true, false]) expect(ok({ ...spec, tooltip_section: v }).valid, spec.chartType).toBe(true);
    }
  });

  it("rejected, by presence, on a chart without columns.section", () => {
    const plain = { ...STACK, columns: { x: "bar", series: "tax", value: "v" } } as ChartSpec;
    for (const v of [true, false]) {
      const r = ok({ ...plain, tooltip_section: v });
      expect(r.valid).toBe(false);
      expect(r.errors.join("\n")).toMatch(/tooltip_section needs columns\.section/);
    }
  });

  it("accepted on a sectioned bar, standalone and in small multiples", () => {
    for (const spec of [BAR, BAR_FIG_UNCOORD, { ...BAR_FIG_UNCOORD, small_multiples: { pane_order: ["P1", "P2"] } }]) {
      for (const v of [true, false]) expect(ok({ ...spec, tooltip_section: v }).valid).toBe(true);
    }
  });

  it("must be a boolean", () => {
    expect(ok({ ...STACK, tooltip_section: "yes" } as unknown as ChartSpec).valid).toBe(false);
  });
});
