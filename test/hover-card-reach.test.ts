// @vitest-environment jsdom
//
// WHICH CHART TYPES BUILD A FLOATING HOVER CARD AT DEFAULT SETTINGS — and therefore where
// `hooks.tooltip` can possibly fire.
//
// This file exists because the same defect shipped three times on this branch: a CONFIG-SPEC.md
// claim about "the hover tooltip" written from the standalone case, verified by a test that set a
// NON-DEFAULT dial to make the card appear (`coordinated_cursor: false`, or
// `barStack.hover: "tooltip"`), and then generalised to "standalone and faceted alike". EVERY case
// below therefore mounts at DEFAULT settings — no `small_multiples.coordinated_cursor`, no
// `barStack.hover`, no `chrome.*`. A case that needs a dial to produce a card is marked as such and
// asserts the DEFAULT outcome, with the dial only as a paired control.
//
// The two mechanisms that decide it (see crosshair.ts / spec/bar-stack.ts for the reasoning):
//   1. `emitOnly` — a coordinated small-multiples pane builds NO card (`const tip = emitOnly ? null
//      : getSharedTooltip(...)`, then `if (emitOnly) return;`). The secondary cursor draws the
//      in-place guide/dot/pill instead. Deliberate.
//   2. `resolveHoverMode` returns "pills" whenever `netMode == null`, i.e. for every plain/grouped
//      BAR and every WATERFALL, in any configuration — so those two never reach a card at all, even
//      standalone, and `barStack.hover` cannot talk them into one.
//
// `hooks.tooltip` is wired at the two `buildBandTooltipHtml` call sites (attachBandCrosshair,
// attachCategoricalLineCrosshair) and fires unconditionally whenever either builds a card — so the
// hook column below is exactly "a card was built here", never a separate forwarding question. The
// other card builders (attachCrosshair, attachHistogramHover, attachPointHover) do not call it, by
// documented design; they are asserted here so that stays a fact rather than an assumption.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// The card is module-level singleton state (crosshair.ts's `activeTooltip`), reused across mounts
// while it stays attached to document.body — so card assertions are order-dependent unless the
// body is cleared between tests.
beforeEach(() => {
  document.body.innerHTML = "";
});

/** jsdom has no layout: map the SVG's own rect 1:1 onto its viewBox so clientX/Y are user-space,
 *  and give every <text> and <circle> a rect derived from its own coords plus its ancestors'
 *  transforms. Both are load-bearing: `readCategoryCentersFromAxis` measures axis-label rects and
 *  `readCategoryCentersFromMarks` measures `[data-category]` marks, skipping any whose rect is
 *  0×0 — which is every SVG element in jsdom unless mocked, so a dot plot would otherwise report
 *  "no card" for a harness reason rather than a behavioural one. */
function mockRect1to1(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ width: vb.width, height: vb.height, top: 0, left: 0, right: vb.width, bottom: vb.height, x: 0, y: 0 }),
    configurable: true,
  });
  const translate = (el: Element | null): [number, number] => {
    let x = 0, y = 0;
    let cur: Element | null = el;
    while (cur && cur !== svg) {
      const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(cur.getAttribute("transform") ?? "");
      if (m) { x += +m[1]!; y += +m[2]!; }
      cur = cur.parentElement;
    }
    return [x, y];
  };
  const box = (el: Element, cx: number, cy: number, w: number, h: number): void => {
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, width: w, height: h, x: cx - w / 2, y: cy - h / 2 }),
      configurable: true,
    });
  };
  for (const t of Array.from(svg.querySelectorAll<SVGTextElement>("text"))) {
    const [tx, ty] = translate(t.parentElement);
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(t.getAttribute("transform") ?? "");
    const ox = m ? +m[1]! : +(t.getAttribute("x") ?? 0);
    const oy = m ? +m[2]! : +(t.getAttribute("y") ?? 0);
    box(t, tx + ox, ty + oy, Math.max(6, (t.textContent ?? "").length * 5), 10);
  }
  for (const c of Array.from(svg.querySelectorAll<SVGCircleElement>("circle"))) {
    const [tx, ty] = translate(c.parentElement);
    const r = Math.max(1, +(c.getAttribute("r") ?? 3));
    box(c, tx + +(c.getAttribute("cx") ?? 0), ty + +(c.getAttribute("cy") ?? 0), r * 2, r * 2);
  }
}

type Mounted = { container: HTMLElement; svgs: SVGSVGElement[]; calls: () => number };

/** Mount at DEFAULT settings with a counting `hooks.tooltip`. `faceted` only picks the pane
 *  selector — the spec decides whether panes exist. */
function mount(spec: ChartSpec, rows: TidyRow[], faceted = false): Mounted {
  let calls = 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, {
    spec,
    rows,
    width: faceted ? 838 : 720,
    height: faceted ? 420 : 400,
    hooks: { tooltip: () => { calls++; return null; } },
  } as never);
  const sel = faceted ? ".figure-pane svg" : ".figure-canvas svg";
  const svgs = Array.from(container.querySelectorAll<SVGSVGElement>(sel));
  svgs.forEach(mockRect1to1);
  return { container, svgs, calls: () => calls };
}

/** Is a floating card actually SHOWN? A non-emitOnly attach creates the singleton up front, so
 *  presence alone is not enough — the shown state is opacity 1. */
function cardShown(): boolean {
  const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip");
  return !!tip && tip.style.opacity === "1";
}

/** Did the pane RESPOND to the hover? Paired with every `cardShown() === false` assertion below,
 *  so "no card" can never silently mean "the hover never resolved a category". The coordinated
 *  cursor group is the substitute the engine draws in place of the card. */
function coordShown(svg: SVGSVGElement): boolean {
  return svg.querySelector("g.tbl-coord")?.getAttribute("opacity") === "1";
}

/** Hover the horizontal centre of the first mark matching `markSel`, on whichever hit rect the
 *  chart attached. Falls back to the middle of the pane when there is no such mark. */
function hoverFirstMark(svg: SVGSVGElement, markSel: string): void {
  const vb = svg.viewBox.baseVal;
  const mark = svg.querySelector<SVGGraphicsElement>(markSel);
  let cx = vb.width / 2;
  if (mark) {
    const x = mark.getAttribute("x");
    if (x != null) cx = parseFloat(x) + parseFloat(mark.getAttribute("width") ?? "0") / 2;
    else if (mark.getAttribute("cx") != null) cx = parseFloat(mark.getAttribute("cx")!);
  }
  const hit = svg.querySelector(CROSSHAIR_HIT_SELECTOR)!;
  hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: vb.height / 2, bubbles: true }));
}

const BAR = 'g[aria-label="bar"] rect';
const HIST = 'g[aria-label="rect"] rect';

// ---------------------------------------------------------------------------
// Fixtures. Every spec here is DEFAULT apart from the fields that define the chart type; the
// faceted variants add only `columns.facet` + `small_multiples` (whose `coordinated_cursor`
// defaults to true, which is the whole point).
// ---------------------------------------------------------------------------

const sm = { small_multiples: { columns: 2, mode: "shared" } };
const facetCols = (extra: Record<string, string> = {}) => ({
  columns: { x: "time", value: "value", series: "series", facet: "pane", ...extra },
});

const spec = (s: Record<string, unknown>): ChartSpec =>
  ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;

const catRows = (series: Array<[string, number, number]>, pane?: string): TidyRow[] =>
  series.flatMap(([s, a, b]) => [
    { ...(pane ? { pane } : {}), time: "A", series: s, value: String(a) },
    { ...(pane ? { pane } : {}), time: "B", series: s, value: String(b) },
  ]) as unknown as TidyRow[];

const twoPane = (series: Array<[string, number, number]>): TidyRow[] => [
  ...catRows(series, "P1"),
  ...catRows(series.map(([s, a, b]) => [s, a / 2, b / 2] as [string, number, number]), "P2"),
];

const TEMPORAL_ROWS: TidyRow[] = ["2020-01-01", "2020-02-01", "2020-03-01"].flatMap((t, i) =>
  ["A", "B"].flatMap((s) => [
    { pane: "P1", time: t, series: s, value: String(3 + i) },
    { pane: "P2", time: t, series: s, value: String(5 + i) },
  ]),
) as unknown as TidyRow[];

// ---------------------------------------------------------------------------
// No card in ANY configuration: plain/grouped bar and waterfall.
// ---------------------------------------------------------------------------

describe("no floating card exists in any configuration (hoverMode is always \"pills\")", () => {
  it("plain bar, standalone: no card, hooks.tooltip never fires", () => {
    const m = mount(spec({ chartType: "bar", xAxisType: "categorical" }), catRows([["S", 6, 4]]));
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("grouped bar, standalone: no card, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "bar", xAxisType: "categorical", series_order: ["Up", "Down"] }),
      catRows([["Up", 6, 5], ["Down", 4, 2]]),
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("plain bar, 2-pane: no card, hooks.tooltip never fires", () => {
    const m = mount(spec({ chartType: "bar", xAxisType: "categorical", data: "d.csv", ...facetCols(), ...sm }), twoPane([["S", 10, 20]]), true);
    expect(m.svgs.length).toBe(2);
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("waterfall, standalone: no card, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "waterfall", xAxisType: "categorical" }),
      [
        { time: "Start", series: "S", value: "10" },
        { time: "Up", series: "S", value: "5" },
        { time: "Down", series: "S", value: "-3" },
      ] as unknown as TidyRow[],
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("bar: even an explicit barStack.hover \"tooltip\" does NOT produce one (netMode == null)", () => {
    let calls = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, {
      spec: spec({ chartType: "bar", xAxisType: "categorical", barStack: { hover: "tooltip" } }),
      rows: catRows([["S", 6, 4]]),
      width: 720,
      height: 400,
      hooks: { tooltip: () => { calls++; return null; } },
    } as never);
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mockRect1to1(svg);
    hoverFirstMark(svg, BAR);
    expect(coordShown(svg)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stacked bar: the card is DATA-dependent (the net dot), not dial-dependent.
// ---------------------------------------------------------------------------

describe("stacked bar — a card only where the net dot is drawn", () => {
  it("all-positive, standalone: no card at defaults, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"] }),
      catRows([["Up", 6, 5], ["Down", 4, 2]]),
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("all-positive, 2-pane: no card at defaults, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["Up", 6, 5], ["Down", 4, 2]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("diverging (a negative value), standalone: card at defaults, hooks.tooltip fires", () => {
    const m = mount(
      spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"] }),
      catRows([["Up", 6, 5], ["Down", -4, -2]]),
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("diverging, 2-pane: card at defaults too — hover:tooltip beats coordination per pane", () => {
    const m = mount(
      spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["Up", 6, 5], ["Down", -4, -2]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, BAR);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Categorical-x line and dot plot: a card standalone, none in a coordinated pane.
// ---------------------------------------------------------------------------

describe("categorical-x line — card standalone, none in a default pane", () => {
  const rows = catRows([["A", 10, 20], ["B", 12, 22]]);

  it("standalone: card at defaults, hooks.tooltip fires", () => {
    const m = mount(spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"] }), rows);
    hoverFirstMark(m.svgs[0]!, "nothing-matches");
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("2-pane: NO card at defaults, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["A", 10, 20], ["B", 12, 22]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, "nothing-matches");
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });
});

describe("dot plot — card standalone, none in a default pane", () => {
  it("standalone: card at defaults, hooks.tooltip fires", () => {
    const m = mount(
      spec({ chartType: "dotplot", xAxisType: "categorical", series_order: ["A", "B"] }),
      catRows([["A", 10, 20], ["B", 12, 22]]),
    );
    hoverFirstMark(m.svgs[0]!, 'g[aria-label="dot"] circle');
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("2-pane: NO card at defaults, hooks.tooltip never fires", () => {
    const m = mount(
      spec({ chartType: "dotplot", xAxisType: "categorical", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["A", 10, 20], ["B", 12, 22]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, 'g[aria-label="dot"] circle');
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dumbbell: the one type that keeps its card in a coordinated pane, on purpose
// (render-live.ts's "NOT emitOnly" comment).
// ---------------------------------------------------------------------------

describe("dumbbell — card standalone AND in a default pane", () => {
  it("standalone: card at defaults, hooks.tooltip fires", () => {
    const m = mount(
      spec({ chartType: "dumbbell", xAxisType: "categorical", series_order: ["A", "B"] }),
      catRows([["A", 3, 4], ["B", 7, 9]]),
    );
    hoverFirstMark(m.svgs[0]!, 'g[aria-label="dot"] circle');
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });

  it("2-pane: card at defaults, hooks.tooltip fires", () => {
    const m = mount(
      spec({ chartType: "dumbbell", xAxisType: "categorical", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      twoPane([["A", 3, 4], ["B", 7, 9]]),
      true,
    );
    hoverFirstMark(m.svgs[0]!, 'g[aria-label="dot"] circle');
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Card builders that do NOT call hooks.tooltip, by documented design. Asserted so the
// CONFIG-SPEC carve-out stays a fact.
// ---------------------------------------------------------------------------

describe("card builders outside hooks.tooltip's two call sites", () => {
  it("temporal line, standalone: card at defaults but hooks.tooltip never fires", () => {
    const m = mount(spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"] }), TEMPORAL_ROWS);
    hoverFirstMark(m.svgs[0]!, "nothing-matches");
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBe(0);
  });

  it("temporal line, 2-pane: no card at defaults either", () => {
    const m = mount(
      spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      TEMPORAL_ROWS,
      true,
    );
    hoverFirstMark(m.svgs[0]!, "nothing-matches");
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("area, standalone: card at defaults but hooks.tooltip never fires", () => {
    const m = mount(spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"] }), TEMPORAL_ROWS);
    hoverFirstMark(m.svgs[0]!, "nothing-matches");
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBe(0);
  });

  it("area, 2-pane: no card at defaults", () => {
    const m = mount(
      spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"], data: "d.csv", ...facetCols(), ...sm }),
      TEMPORAL_ROWS,
      true,
    );
    hoverFirstMark(m.svgs[0]!, "nothing-matches");
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });

  it("histogram, standalone: card at defaults but hooks.tooltip never fires", () => {
    const rows: TidyRow[] = [];
    for (let v = 0; v < 16; v++) rows.push({ amount: String(v) } as unknown as TidyRow);
    const m = mount(
      spec({ chartType: "histogram", xAxisType: "numeric", histogram: { bins: 4, domain: [0, 20] }, columns: { x: "amount" } }),
      rows,
    );
    hoverFirstMark(m.svgs[0]!, HIST);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBe(0);
  });

  it("histogram, 2-pane: no card at defaults", () => {
    const rows: TidyRow[] = [];
    for (const pane of ["P1", "P2"]) for (let v = 0; v < 16; v++) rows.push({ pane, amount: String(v) } as unknown as TidyRow);
    const m = mount(
      spec({ chartType: "histogram", xAxisType: "numeric", data: "d.csv", histogram: { bins: 4, domain: [0, 20] }, columns: { x: "amount", facet: "pane" }, ...sm }),
      rows,
      true,
    );
    hoverFirstMark(m.svgs[0]!, HIST);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
    expect(m.calls()).toBe(0);
  });
});
