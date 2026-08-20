// @vitest-environment jsdom
//
// `valueLabels.show: true` flips the DEFAULT for the hover value pills to off.
//
// A stacked chart with segment labels prints its numbers in the bars; hovering then added value
// pills showing the same numbers in nearly the same place. Nothing coordinated the two.
//
// It flips the DEFAULT, not the value: `chrome.valuePills: true` still wins, so an author who wants
// both can still ask for both. Implemented as an override it would be a switch that ignores what it
// was set to.
//
// And it flips it only where the labels are actually PAINTED. `valueLabels.show` is a request, and
// three stacked cases refuse it — a diverging (net-dot) stack, and every small-multiples pane. A
// waterfall paints labels but they are the running LEVEL while its hover pill is the signed DELTA, so
// there is nothing duplicated there either. One helper answers "are the labels painted", and the
// label mark and the pill default both read it, so they cannot drift apart.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// All-positive, so `netDisplay: auto` resolves to "text" and `resolveHoverMode` gives "pills" — the
// treatment whose pills this is about. Two categories, two series.
const ROWS: TidyRow[] = [
  { cat: "A", series: "one", value: "40" },
  { cat: "A", series: "two", value: "60" },
  { cat: "B", series: "one", value: "30" },
  { cat: "B", series: "two", value: "70" },
] as unknown as TidyRow[];

function stacked(patch: Record<string, unknown> = {}): ChartSpec {
  return {
    chartType: "stacked",
    title: "t",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "cat", value: "value", series: "series" },
    ...patch,
  } as unknown as ChartSpec;
}

function mount(s: ChartSpec, rows: TidyRow[] = ROWS): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  mountChart(el, { spec: s, rows, width: 720, height: 420 });
  return el;
}

/** Hover the first bar of `svg`, stubbing jsdom's all-zero rect (mirrors
 *  test/chrome-switches.test.ts's `mountAndHover`). */
function hoverFirstBand(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({
      width: vb.width, height: vb.height, top: 0, left: 0,
      right: vb.width, bottom: vb.height, x: 0, y: 0,
    }),
    configurable: true,
  });
  const rect = svg.querySelector<SVGRectElement>('g[aria-label="bar"] rect')!;
  const cx = parseFloat(rect.getAttribute("x") ?? "0") + parseFloat(rect.getAttribute("width") ?? "0") / 2;
  svg
    .querySelector(".tbl-band-crosshair-hit")!
    .dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
}

/** Hover the band at `i` (categories left-to-right), stubbing jsdom's all-zero rect as above.
 *  Band centres are read off the bar rects' own x, deduped — a stacked band has one rect per
 *  segment, all sharing the band's x. */
function hoverBand(svg: SVGSVGElement, i: number): void {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({
      width: vb.width, height: vb.height, top: 0, left: 0,
      right: vb.width, bottom: vb.height, x: 0, y: 0,
    }),
    configurable: true,
  });
  const xs = new Set<number>();
  svg.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect').forEach((r) => {
    xs.add(parseFloat(r.getAttribute("x") ?? "0") + parseFloat(r.getAttribute("width") ?? "0") / 2);
  });
  const cx = [...xs].sort((a, b) => a - b)[i]!;
  svg
    .querySelector(".tbl-band-crosshair-hit")!
    .dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
}

function chartSvg(el: HTMLElement): SVGSVGElement {
  return el.querySelector<SVGSVGElement>(".figure-canvas svg")!;
}

/** How many in-frame text marks read exactly `text`. The waterfall's running-total labels carry no
 *  class, so they are identified by their content — the fixtures below pick levels that are not also
 *  axis ticks or category names, so a hit can only be a value label. */
function textMarkCount(svg: SVGSVGElement, text: string): number {
  return [...svg.querySelectorAll("text")].filter((t) => t.textContent === text).length;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("stacked segment labels vs. hover value pills", () => {
  it("labels ON: the numbers are in the bars, so hovering adds no pills", () => {
    const el = mount(stacked({ valueLabels: { show: true } }));
    const svg = chartSvg(el);
    // The premise: the labels really are painted on this chart.
    expect(svg.querySelectorAll("g.tbl-segment-label text").length).toBeGreaterThan(0);
    hoverFirstBand(svg);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBe(0);
    expect(svg.querySelectorAll(".tbl-hl-pills").length).toBe(0);
    // Only the pills go — the shaded band region and hit-testing are untouched, exactly as
    // `chrome.valuePills: false` behaves.
    expect(svg.querySelectorAll(".tbl-coord-region").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".tbl-band-crosshair-hit").length).toBeGreaterThan(0);
  });

  it("labels ON + chrome.valuePills: true: an explicit ask still wins, so both show", () => {
    const el = mount(stacked({ valueLabels: { show: true }, chrome: { valuePills: true } }));
    const svg = chartSvg(el);
    expect(svg.querySelectorAll("g.tbl-segment-label text").length).toBeGreaterThan(0);
    hoverFirstBand(svg);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBeGreaterThan(0);
  });

  it("labels OFF: pills as before", () => {
    const el = mount(stacked());
    const svg = chartSvg(el);
    expect(svg.querySelectorAll("g.tbl-segment-label text").length).toBe(0);
    hoverFirstBand(svg);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBeGreaterThan(0);
  });

  it("labels OFF + chrome.valuePills: false: still off — the switch is unchanged", () => {
    const el = mount(stacked({ chrome: { valuePills: false } }));
    const svg = chartSvg(el);
    hoverFirstBand(svg);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBe(0);
  });

  it("a diverging (net-dot) stack keeps its pills — it paints no segment labels to duplicate", () => {
    // marks/stacked.ts suppresses segment labels when the net is a dot, so `valueLabels.show: true`
    // draws nothing there; taking the pills away too would be a pure loss.
    const diverging: TidyRow[] = [
      { cat: "A", series: "one", value: "40" },
      { cat: "A", series: "two", value: "-60" },
      { cat: "B", series: "one", value: "30" },
      { cat: "B", series: "two", value: "-70" },
    ] as unknown as TidyRow[];
    const el = mount(
      // `hover: "pills"` pins the treatment: a dot stack otherwise defaults to the floating tooltip
      // and would never reach the pills at all, leaving this vacuous.
      stacked({ valueLabels: { show: true }, barStack: { hover: "pills" } }),
      diverging,
    );
    const svg = chartSvg(el);
    expect(svg.querySelectorAll("g.tbl-segment-label text").length).toBe(0);
    hoverFirstBand(svg);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBeGreaterThan(0);
  });

  it("a waterfall paints running-total labels only when asked — the flag really drives them", () => {
    const wfRows: TidyRow[] = [
      { cat: "Start", value: "37", kind: "total" },
      { cat: "Up", value: "5", kind: "delta" },
      { cat: "End", value: "42", kind: "total" },
    ] as unknown as TidyRow[];
    const wf = (patch: Record<string, unknown>): ChartSpec =>
      ({
        chartType: "waterfall",
        title: "t",
        xAxisType: "categorical",
        data: "data.csv",
        columns: { x: "cat", value: "value", kind: "kind" },
        ...patch,
      }) as unknown as ChartSpec;
    expect(textMarkCount(chartSvg(mount(wf({}), wfRows)), "37")).toBe(0);
    expect(
      textMarkCount(chartSvg(mount(wf({ valueLabels: { show: true } }), wfRows)), "37"),
    ).toBeGreaterThan(0);
  });

  it("a waterfall keeps its pills — its label is the running level, its pill the signed delta", () => {
    const wfRows: TidyRow[] = [
      { cat: "Start", value: "37", kind: "total" },
      { cat: "Up", value: "5", kind: "delta" },
      { cat: "End", value: "42", kind: "total" },
    ] as unknown as TidyRow[];
    const el = mount(
      {
        chartType: "waterfall",
        title: "t",
        xAxisType: "categorical",
        data: "data.csv",
        columns: { x: "cat", value: "value", kind: "kind" },
        valueLabels: { show: true },
      } as unknown as ChartSpec,
      wfRows,
    );
    const svg = chartSvg(el);
    // The premise, and the correction to CONFIG-SPEC.md's "stacked bars only" claim on
    // `valueLabels.show`: a waterfall DOES paint labels for it — the running LEVEL after each step
    // (37 → 42), which is a different number from the signed DELTA its hover pill carries (+5).
    expect(textMarkCount(svg, "37")).toBeGreaterThan(0);
    // Hover a DELTA step (index 1) — only those carry a pill (see attachSecondaryBandCursor).
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        width: vb.width, height: vb.height, top: 0, left: 0,
        right: vb.width, bottom: vb.height, x: 0, y: 0,
      }),
      configurable: true,
    });
    const rects = svg.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect');
    const r = rects[1]!;
    const cx = parseFloat(r.getAttribute("x") ?? "0") + parseFloat(r.getAttribute("width") ?? "0") / 2;
    svg
      .querySelector(".tbl-band-crosshair-hit")!
      .dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBeGreaterThan(0);
  });
});

// Every hover-chrome decision in this engine has a standalone `mountChart` site AND a faceted-pane
// site inside `wireFigureSvg`; the two computing it differently is how the faceted-histogram and
// faceted-line pill gaps happened. Both now call the same helper — and pass a different `pane`
// argument, because a pane genuinely paints no segment labels.
describe("the same rule on a small-multiples figure", () => {
  const FACETED: TidyRow[] = [
    { pane: "P1", cat: "A", series: "one", value: "40" },
    { pane: "P1", cat: "A", series: "two", value: "60" },
    { pane: "P1", cat: "B", series: "one", value: "30" },
    { pane: "P1", cat: "B", series: "two", value: "70" },
    { pane: "P2", cat: "A", series: "one", value: "20" },
    { pane: "P2", cat: "A", series: "two", value: "50" },
    { pane: "P2", cat: "B", series: "one", value: "35" },
    { pane: "P2", cat: "B", series: "two", value: "65" },
  ] as unknown as TidyRow[];

  function facetSpec(patch: Record<string, unknown> = {}): ChartSpec {
    return {
      chartType: "stacked",
      title: "t",
      xAxisType: "categorical",
      data: "data.csv",
      columns: { x: "cat", value: "value", series: "series", facet: "pane" },
      small_multiples: { columns: 2, mode: "per-pane" },
      ...patch,
    } as unknown as ChartSpec;
  }

  it("panes paint no segment labels, so `valueLabels.show` leaves their pills alone", () => {
    const el = mount(facetSpec({ valueLabels: { show: true } }), FACETED);
    expect(el.querySelectorAll("g.tbl-segment-label text").length).toBe(0);
    expect(el.querySelectorAll(".tbl-hl-pills").length).toBeGreaterThan(0);
  });

  it("chrome.valuePills: false still suppresses them", () => {
    const el = mount(facetSpec({ valueLabels: { show: true }, chrome: { valuePills: false } }), FACETED);
    expect(el.querySelectorAll(".tbl-hl-pills").length).toBe(0);
  });
});

// The pill DEFAULT must not be able to leave a segment with no number anywhere.
//
// `valueLabels.show` is a request that marks/stacked.ts refuses PER SEGMENT as well as per chart: a
// segment thinner than SEGMENT_LABEL_MIN_PX (25px) gets no in-bar label. The pill default was keyed
// on the per-CHART half only, so a chart whose labels were requested-and-painted-in-general could
// still have segments carrying no number at all — and because painted labels also mean
// `netMode: "text"` -> `hoverMode: "pills"` -> a band crosshair attached `emitOnly`, there is no
// floating tooltip behind it either. The reader got nothing.
//
// The rule is COARSE on purpose: the default flips off only when EVERY segment's label is painted.
// See spec/bar-stack.ts resolveValuePills for why the finer per-segment rule was rejected.
describe("a dropped in-bar label must not also cost the segment its pill", () => {
  // Four rows, the smallest trigger: "Small"'s segments are 6.9 of a 100-tall tallest bar, ~6.9% of
  // the plot height at 720x400 -> under the 25px threshold, so their labels are refused while
  // "Big"'s are painted.
  const MIXED: TidyRow[] = [
    { cat: "Big", series: "one", value: "50" },
    { cat: "Big", series: "two", value: "50" },
    { cat: "Small", series: "one", value: "6.9" },
    { cat: "Small", series: "two", value: "6.9" },
  ] as unknown as TidyRow[];

  function mount400(s: ChartSpec, rows: TidyRow[]): HTMLElement {
    const el = document.createElement("div");
    document.body.appendChild(el);
    mountChart(el, { spec: s, rows, width: 720, height: 400 });
    return el;
  }

  it("a segment whose label was dropped still gets a number on hover", () => {
    const el = mount400(stacked({ valueLabels: { show: true } }), MIXED);
    const svg = chartSvg(el);
    // The premise: only "Big"'s two labels are painted; "Small"'s two are refused.
    expect([...svg.querySelectorAll("g.tbl-segment-label text")].map((t) => t.textContent)).toEqual([
      "50.0",
      "50.0",
    ]);
    // Band 1 is "Small". Its value must appear SOMEWHERE after hovering it -- it is in no bar.
    expect(textMarkCount(svg, "6.90")).toBe(0);
    hoverBand(svg, 1);
    expect(textMarkCount(svg, "6.90")).toBe(2);
  });

  it("every label dropped (15 equal series) keeps the pills", () => {
    const many: TidyRow[] = Array.from({ length: 15 }, (_, i) => ({
      cat: "A",
      series: `s${i}`,
      value: "1",
    })) as unknown as TidyRow[];
    const el = mount400(stacked({ valueLabels: { show: true } }), many);
    const svg = chartSvg(el);
    expect(svg.querySelectorAll("g.tbl-segment-label text").length).toBe(0);
    hoverBand(svg, 0);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBeGreaterThan(0);
  });

  it("all-zero data paints no label and so keeps the pills", () => {
    const zeros: TidyRow[] = [
      { cat: "A", series: "one", value: "0" },
      { cat: "B", series: "one", value: "0" },
      { cat: "C", series: "one", value: "0" },
    ] as unknown as TidyRow[];
    const el = mount400(stacked({ valueLabels: { show: true } }), zeros);
    const svg = chartSvg(el);
    expect(svg.querySelectorAll("g.tbl-segment-label text").length).toBe(0);
    hoverBand(svg, 0);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBeGreaterThan(0);
  });

  it("chrome.valuePills: false still wins over the dropped-label rescue", () => {
    const el = mount400(
      stacked({ valueLabels: { show: true }, chrome: { valuePills: false } }),
      MIXED,
    );
    const svg = chartSvg(el);
    hoverBand(svg, 1);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBe(0);
  });

  it("when every label IS painted the pills still default off -- afc61bf's behaviour is kept", () => {
    // Same fixture, twice the frame height: 6.9% of a taller plot clears 25px, so all four labels
    // paint and there is nothing left for a pill to rescue.
    const el = document.createElement("div");
    document.body.appendChild(el);
    mountChart(el, { spec: stacked({ valueLabels: { show: true } }), rows: MIXED, width: 720, height: 900 });
    const svg = chartSvg(el);
    expect(svg.querySelectorAll("g.tbl-segment-label text").length).toBe(4);
    hoverBand(svg, 1);
    expect(svg.querySelectorAll(".tbl-coord-pill").length).toBe(0);
  });
});
