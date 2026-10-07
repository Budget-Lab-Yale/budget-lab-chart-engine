// @vitest-environment jsdom
//
// `columns.section` on a HORIZONTAL stacked bar: one bar per category, so the stack takes the
// single-series sectioned bar's layout — the section-grouped category band (with spacer slots) on
// `fy`, one inner `y` slot — and every mark that lands on a category row (segments, net text, net
// dot, segment labels) binds to that same `fy` row. Hover, legend tagging and the PNG export are
// checked against the same layout.
//
// The fixtures interleave the sections in data order (Alpha, Beta, Alpha, Beta) and list the rows
// series-major, so the drawn order (section-grouped, facet by facet) differs from both the data
// order and the encounter order. A tag or hover mapping that assumes either fails here.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderChart, TOTAL_SERIES_KEY } from "../src/engine/index";
import { TBL_VALUE_LABEL } from "../src/engine/theme";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { horizontalBarChartHeight } from "../src/engine/figure";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { validateSpec } from "../src/spec/validate";
import { mockRect1to1, cardShown, cardText, coordTexts } from "./helpers/hover-harness";
import type { BandHoverCtx } from "../src/engine/crosshair";
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

const SERIES = ["Income", "Gains", "Corporate"];
const CATS: Array<[string, string]> = [
  ["Alpha one", "First"],
  ["Beta one", "Second"],
  ["Alpha two", "First"],
  ["Beta two", "Second"],
];
/** Drawn order: section-grouped, encounter order within a section. */
const DRAWN = ["Alpha one", "Alpha two", "Beta one", "Beta two"];

const rowsOf = (vals: Record<string, number[]>, pane?: string): TidyRow[] =>
  SERIES.flatMap((s) =>
    CATS.map(([bar, sec], i) => ({ ...(pane ? { pane } : {}), bar, sec, tax: s, v: String(vals[s]![i]) })),
  ) as unknown as TidyRow[];

const POS = rowsOf({ Income: [10, 20, 30, 40], Gains: [5, 15, 25, 35], Corporate: [8, 6, 4, 2] });
const NEG = rowsOf({ Income: [10, 20, 30, 40], Gains: [5, 15, 25, 35], Corporate: [-30, -6, -40, -2] });
/** Negative segments but positive nets, as in pr67's two stacks. */
const NEG_POS_NET = rowsOf({ Income: [10, 20, 30, 40], Gains: [5, 15, 25, 35], Corporate: [-3, -6, -4, -2] });
const netOf = (rows: TidyRow[], cat: string): number =>
  rows.filter((r) => r.bar === cat).reduce((a, r) => a + Number(r.v), 0);

const SPEC: ChartSpec = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "Revenue by provision",
  xAxisType: "categorical",
  columns: { x: "bar", series: "tax", value: "v", section: "sec" },
  series_order: SERIES,
  data: "d.csv",
};
/** pr67's shape: negatives, but the net drawn as text. */
const NET_TEXT: ChartSpec = { ...SPEC, barStack: { netDisplay: "text" } };

/** Enough rows that the 400px height floor does not hide the section spacers. */
const TALL = Array.from({ length: 24 }, (_, i) => [`Row ${i + 1}`, i % 2 ? "Second" : "First"] as [string, string]);
const tallRows = (neg: boolean): TidyRow[] =>
  SERIES.flatMap((s, j) =>
    TALL.map(([bar, sec], i) => ({ bar, sec, tax: s, v: String(neg && j === 2 ? -(i % 5) - 1 : 5 + ((i * 7 + j * 3) % 11)) })),
  ) as unknown as TidyRow[];

// --- geometry readers (jsdom has no layout: attributes + ancestor translates) ---
function translateOf(el: Element, svg: Element): [number, number] {
  let x = 0;
  let y = 0;
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) {
      x += Number(m[1]);
      y += Number(m[2]);
    }
  }
  return [x, y];
}
type Box = { x: number; y: number; w: number; h: number };
const rectBox = (r: Element, svg: Element): Box => {
  const [tx, ty] = translateOf(r.parentElement!, svg);
  return {
    x: tx + Number(r.getAttribute("x")),
    y: ty + Number(r.getAttribute("y")),
    w: Number(r.getAttribute("width")),
    h: Number(r.getAttribute("height")),
  };
};
/** Non-empty bar facet groups, top to bottom. */
const barFacets = (svg: SVGSVGElement): Element[] =>
  Array.from(svg.querySelectorAll('g[aria-label="bar"] > g'))
    .filter((g) => g.querySelector("rect"))
    .sort((a, b) => translateOf(a, svg)[1] - translateOf(b, svg)[1]);
/** Category label -> its absolute y (labels carry data-category). */
const labelYs = (svg: SVGSVGElement): Map<string, number> => {
  const out = new Map<string, number>();
  for (const t of Array.from(svg.querySelectorAll("g.tbl-cat-label text"))) {
    const [, ty] = translateOf(t, svg);
    out.set(t.getAttribute("data-category") ?? "", ty);
  }
  return out;
};
/** The facet (by drawn index) whose rect band contains absolute y. */
const facetAt = (svg: SVGSVGElement, y: number): number =>
  barFacets(svg).findIndex((g) => {
    const b = rectBox(g.querySelector("rect")!, svg);
    return y >= b.y - 0.5 && y <= b.y + b.h + 0.5;
  });
const boldTexts = (svg: SVGSVGElement): string[] =>
  Array.from(svg.querySelectorAll('g[font-weight="700"] text')).map((t) => t.textContent ?? "");

const render = (spec: ChartSpec, rows: TidyRow[]) => renderChart(spec, rows, { width: 720, height: 500, document }).svg;

// ---------------------------------------------------------------------------

describe("validation: columns.section on a stacked bar", () => {
  const base = { chartType: "stacked", title: "t", xAxisType: "categorical", data: "d.csv", columns: { section: "sec" } };
  it("accepts it on a horizontal stack", () => {
    expect(validateSpec({ ...base, orientation: "horizontal" }).valid).toBe(true);
  });
  it("rejects it on a vertical stack, naming the field and the fix", () => {
    const r = validateSpec(base);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'columns.section requires a horizontal "bar", "stacked" or "dumbbell" chart (got chartType "stacked", orientation undefined)',
    );
  });
});

describe("sectioned horizontal stack: layout", () => {
  it("draws one fy row per category, in section-grouped order, each row's segments under its label", () => {
    const svg = render(SPEC, POS);
    const facets = barFacets(svg);
    expect(facets.length).toBe(4);
    const ys = labelYs(svg);
    expect([...ys.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c)).toEqual(DRAWN);
    // Each category's label sits on its own row's segments.
    DRAWN.forEach((cat, i) => expect(facetAt(svg, ys.get(cat)!), cat).toBe(i));
    for (const g of facets) expect(g.querySelectorAll("rect").length).toBe(3);
  });

  it("prints each section header once, in bold, with a gap between the sections", () => {
    const svg = render(SPEC, POS);
    expect(boldTexts(svg).filter((t) => t === "First").length).toBe(1);
    expect(boldTexts(svg).filter((t) => t === "Second").length).toBe(1);
    const ys = labelYs(svg);
    const pitch = ys.get("Alpha two")! - ys.get("Alpha one")!;
    // One row pitch plus the fixed 33px section gap (header line + 10px clear above and below).
    expect(ys.get("Beta one")! - ys.get("Alpha two")!).toBe(pitch + 33);
  });

  it("stacks within each row: contiguous segments from 0, lengths proportional to the values", () => {
    const svg = render(SPEC, POS);
    const facets = barFacets(svg);
    const pxPerUnit: number[] = [];
    DRAWN.forEach((cat, i) => {
      const boxes = Array.from(facets[i]!.querySelectorAll("rect")).map((r) => rectBox(r, svg)).sort((a, b) => a.x - b.x);
      for (let k = 1; k < boxes.length; k++) expect(boxes[k]!.x).toBeCloseTo(boxes[k - 1]!.x + boxes[k - 1]!.w, 6);
      const total = boxes.reduce((a, b) => a + b.w, 0);
      pxPerUnit.push(total / netOf(POS, cat));
    });
    for (const k of pxPerUnit) expect(k).toBeCloseTo(pxPerUnit[0]!, 6);
  });

  it("tags every segment with the series it is painted as (legend pin/dim)", () => {
    const svg = render(SPEC, POS);
    const fillOf = new Map<string, string>();
    for (const r of Array.from(svg.querySelectorAll('g[aria-label="bar"] rect'))) {
      const s = r.getAttribute("data-series")!;
      expect(SERIES).toContain(s);
      if (!fillOf.has(s)) fillOf.set(s, r.getAttribute("fill")!);
      expect(r.getAttribute("fill"), s).toBe(fillOf.get(s));
    }
    expect(new Set(fillOf.values()).size).toBe(3);
    // ...and each row holds each series once, in the row whose data it draws: segment widths match.
    barFacets(svg).forEach((g, i) => {
      const bySeries = new Map(Array.from(g.querySelectorAll("rect")).map((r) => [r.getAttribute("data-series")!, Number(r.getAttribute("width"))]));
      const vals = new Map(POS.filter((r) => r.bar === DRAWN[i]).map((r) => [r.tax as string, Number(r.v)]));
      const k = bySeries.get("Income")! / vals.get("Income")!;
      for (const s of SERIES) expect(bySeries.get(s)!, `${DRAWN[i]} ${s}`).toBeCloseTo(vals.get(s)! * k, 6);
    });
  });

  it("all positive: the net text sits on its own row, just past the stack's end", () => {
    const svg = render(SPEC, POS);
    const texts = Array.from(svg.querySelectorAll('g[aria-label="text"] text')).filter((t) =>
      DRAWN.some((c) => t.textContent === String(netOf(POS, c))),
    );
    expect(texts.length).toBe(4);
    for (const t of texts) {
      const [tx, ty] = translateOf(t, svg);
      const i = facetAt(svg, ty);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(t.textContent).toBe(String(netOf(POS, DRAWN[i]!)));
      const end = Math.max(...Array.from(barFacets(svg)[i]!.querySelectorAll("rect")).map((r) => { const b = rectBox(r, svg); return b.x + b.w; }));
      // The label gap, plus Plot's 0.5px crisp-edge offset on the text group.
      expect(tx - end).toBeGreaterThanOrEqual(TBL_VALUE_LABEL.gap);
      expect(tx - end).toBeLessThanOrEqual(TBL_VALUE_LABEL.gap + 0.5);
    }
  });

  it("all positive: matches the golden", async () => {
    await expect(render(SPEC, POS).outerHTML).toMatchFileSnapshot("./fixtures/stacked-sectioned.golden.svg");
  });

  it("negatives: one Total-tagged net dot per row, at that row's net", () => {
    const svg = render(SPEC, NEG);
    const dots = Array.from(svg.querySelectorAll("g.tbl-net-marker circle"));
    expect(dots.length).toBe(4);
    const facets = barFacets(svg);
    for (const d of dots) {
      expect(d.getAttribute("data-series")).toBe(TOTAL_SERIES_KEY);
      const [tx, ty] = translateOf(d.parentElement!, svg);
      const cy = ty + Number(d.getAttribute("cy"));
      const i = facetAt(svg, cy);
      expect(i).toBeGreaterThanOrEqual(0);
      // Locate 0 and the scale from this row's rects: the zero edge is where positives start.
      const boxes = Array.from(facets[i]!.querySelectorAll("rect")).map((r) => ({ s: r.getAttribute("data-series")!, ...rectBox(r, svg) }));
      const inc = boxes.find((b) => b.s === "Income")!;
      const k = inc.w / Number(NEG.find((r) => r.bar === DRAWN[i] && r.tax === "Income")!.v);
      // Within Plot's 0.5px crisp-edge offset on the dot group.
      expect(Math.abs(tx + Number(d.getAttribute("cx")) - (inc.x + netOf(NEG, DRAWN[i]!) * k))).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("negatives: matches the golden", async () => {
    await expect(render(SPEC, NEG).outerHTML).toMatchFileSnapshot("./fixtures/stacked-sectioned-net-dot.golden.svg");
  });

  it("net as text with segment labels: every label sits inside a segment of its own row", () => {
    const spec: ChartSpec = { ...NET_TEXT, valueLabels: { show: true } };
    const svg = render(spec, NEG_POS_NET);
    const labels = Array.from(svg.querySelectorAll("g.tbl-segment-label text"));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      const [lx, ly] = translateOf(l, svg);
      const i = facetAt(svg, ly);
      expect(i, l.textContent ?? "").toBeGreaterThanOrEqual(0);
      const host = Array.from(barFacets(svg)[i]!.querySelectorAll("rect"))
        .map((r) => ({ s: r.getAttribute("data-series")!, ...rectBox(r, svg) }))
        .find((b) => lx >= b.x && lx <= b.x + b.w);
      expect(host, `${l.textContent} in ${DRAWN[i]}`).toBeTruthy();
      const v = NEG_POS_NET.find((r) => r.bar === DRAWN[i] && r.tax === host!.s)!.v;
      // Segment labels are unsigned magnitudes; the side of zero carries the sign.
      expect(l.textContent).toBe(String(Math.abs(Number(v))));
    }
    // Net text, one per row, on its row.
    const nets = Array.from(svg.querySelectorAll('g[aria-label="text"]:not(.tbl-segment-label) text')).filter((t) =>
      DRAWN.some((c) => t.textContent === String(netOf(NEG_POS_NET, c))),
    );
    expect(nets.length).toBe(4);
    for (const t of nets) expect(t.textContent).toBe(String(netOf(NEG_POS_NET, DRAWN[facetAt(svg, translateOf(t, svg)[1])]!)));
  });

  it("net as text: matches the golden", async () => {
    await expect(render({ ...NET_TEXT, valueLabels: { show: true } }, NEG_POS_NET).outerHTML).toMatchFileSnapshot(
      "./fixtures/stacked-sectioned-net-text.golden.svg",
    );
  });

  // Top: the first section header's floor (33), or a value-tick row above the headers (40).
  // Bottom: 26 with the value ticks at the bottom, 8 without.
  for (const [ticks, top, bottom] of [["bottom", 33, 26], ["top", 40, 8], ["both", 40, 26]] as const) {
    it(`x_axis_ticks: ${ticks} — margins ${top}/${bottom}, as on a sectioned horizontal bar`, () => {
      const stacked = render({ ...SPEC, x_axis_ticks: ticks }, POS);
      const bar = render({ ...SPEC, chartType: "bar", x_axis_ticks: ticks }, POS);
      const m = (s: SVGSVGElement) => [Number(s.dataset.marginTop), Number(s.dataset.marginBottom)];
      expect(m(stacked)).toEqual([top, bottom]);
      expect(m(bar)).toEqual([top, bottom]);
    });
  }
});

describe("sectioned horizontal stack: the PNG export matches the live chart", () => {
  const exportChart = (root: SVGSVGElement): SVGSVGElement =>
    Array.from(root.querySelectorAll("svg")).reduce((a, b) =>
      Number(b.getAttribute("width") ?? 0) > Number(a.getAttribute("width") ?? 0) ? b : a,
    ) as SVGSVGElement;
  const live = (spec: ChartSpec, rows: TidyRow[]): SVGSVGElement => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    mountChart(c, { spec, rows, width: INNER_W });
    return c.querySelector('g[aria-label="bar"] rect')!.closest("svg") as SVGSVGElement;
  };

  for (const [name, spec, rows] of [
    ["all positive", SPEC, tallRows(false)],
    ["negatives + net dot", SPEC, tallRows(true)],
    ["net as text", { ...NET_TEXT, valueLabels: { show: true } }, tallRows(true)],
  ] as Array<[string, ChartSpec, TidyRow[]]>) {
    it(`${name}: same height (sections counted), rows, headers and labels`, () => {
      const chart = exportChart(buildExportSvg(spec, rows));
      const l = live(spec, rows);
      const h = horizontalBarChartHeight(spec, rows);
      const unsectioned = { ...spec, columns: { ...spec.columns, section: undefined } };
      expect(h).toBeGreaterThan(horizontalBarChartHeight(unsectioned, rows));
      expect(Number(chart.getAttribute("height"))).toBe(h);
      expect(Number(l.getAttribute("height"))).toBe(h);
      const boxes = (s: SVGSVGElement) => Array.from(s.querySelectorAll('g[aria-label="bar"] rect')).map((r) => rectBox(r, s));
      expect(boxes(chart)).toEqual(boxes(l));
      const texts = (s: SVGSVGElement) => Array.from(s.querySelectorAll("text")).map((t) => `${t.textContent}@${translateOf(t, s).join(",")}`);
      expect(texts(chart)).toEqual(texts(l));
      expect(boldTexts(chart)).toEqual(expect.arrayContaining(["First", "Second"]));
    });
  }
});

describe("sectioned horizontal stack: hover resolves the row under the pointer", () => {
  function mount(spec: ChartSpec, rows: TidyRow[]) {
    const seen: Array<BandHoverCtx | null> = [];
    const c = document.createElement("div");
    document.body.appendChild(c);
    mountChart(c, { spec, rows, width: 720, height: 500, onHover: (ctx) => seen.push(ctx) });
    const svg = c.querySelector(".figure-canvas svg") as SVGSVGElement;
    mockRect1to1(svg);
    return { svg, seen };
  }
  /** Pointer at the middle of the drawn row `i`. */
  function hoverRow(svg: SVGSVGElement, i: number): void {
    const b = rectBox(barFacets(svg)[i]!.querySelector("rect")!, svg);
    svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
      new PointerEvent("pointermove", { clientX: b.x + b.w / 2, clientY: b.y + b.h / 2, bubbles: true }),
    );
  }

  it("all positive (pills): every row reports its own category and values", () => {
    const { svg, seen } = mount(SPEC, POS);
    DRAWN.forEach((cat, i) => {
      hoverRow(svg, i);
      const ctx = seen[seen.length - 1]!;
      expect(ctx?.category).toBe(cat);
      for (const s of SERIES) expect(ctx.values[s]).toBe(Number(POS.find((r) => r.bar === cat && r.tax === s)!.v));
      expect(coordTexts(svg).length).toBeGreaterThan(0);
    });
  });

  it("negatives (card): the card names the hovered row and its Total", () => {
    const { svg, seen } = mount(SPEC, NEG);
    DRAWN.forEach((cat, i) => {
      hoverRow(svg, i);
      expect(seen[seen.length - 1]?.category).toBe(cat);
      expect(cardShown()).toBe(true);
      expect(cardText()).toContain(cat);
      expect(cardText()).toContain("Total");
    });
  });

  it("net as text (pr67's shape): every row reports its own category and values, and pills them", () => {
    const { svg, seen } = mount(NET_TEXT, NEG_POS_NET);
    DRAWN.forEach((cat, i) => {
      hoverRow(svg, i);
      const ctx = seen[seen.length - 1]!;
      expect(ctx?.category).toBe(cat);
      for (const s of SERIES) expect(ctx.values[s]).toBe(Number(NEG_POS_NET.find((r) => r.bar === cat && r.tax === s)!.v));
      // One pill per segment, this row's.
      const own = SERIES.map((s) => Number(NEG_POS_NET.find((r) => r.bar === cat && r.tax === s)!.v));
      expect(coordTexts(svg).map(Number)).toEqual(own);
    });
  });
});
