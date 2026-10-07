// @vitest-environment jsdom
//
// Stacked hover value pills when `valueLabels.show` paints in-bar labels but the fit threshold
// refuses some of them: the hovered band, and a legend-highlighted series, pill EVERY segment,
// painted labels included (spec/bar-stack.ts resolveValuePills). Sylva chose this over pilling only
// the refused segments (F9b), and the temporary MountOptions.pillGranularity switch that offered
// the alternative was removed; these tests pin the chosen behaviour.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import type { MountOptions } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// At 720x400 "Mixed"'s `two` (3 of a 100-tall tallest bar) is ~10px tall -> under the 25px fit
// threshold, so its label is refused while `one`'s (95) is painted. "Full" paints both labels.
// "Thin" refuses both.
const ROWS: TidyRow[] = [
  { cat: "Mixed", series: "one", value: "95" },
  { cat: "Mixed", series: "two", value: "3" },
  { cat: "Full", series: "one", value: "50" },
  { cat: "Full", series: "two", value: "50" },
  { cat: "Thin", series: "one", value: "4" },
  { cat: "Thin", series: "two", value: "4" },
] as unknown as TidyRow[];
const BAND = { Mixed: 0, Full: 1, Thin: 2 } as const;

function stacked(patch: Record<string, unknown> = {}): ChartSpec {
  return {
    chartType: "stacked",
    title: "t",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "cat", value: "value", series: "series" },
    valueLabels: { show: true },
    ...patch,
  } as unknown as ChartSpec;
}

function mount(
  s: ChartSpec,
  extra: Partial<MountOptions> = {},
  rows: TidyRow[] = ROWS,
  height = 400,
): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  mountChart(el, { spec: s, rows, width: 720, height, ...extra });
  return el;
}

function chartSvg(el: HTMLElement): SVGSVGElement {
  return el.querySelector<SVGSVGElement>(".figure-canvas svg")!;
}

function stubRect(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({
      width: vb.width, height: vb.height, top: 0, left: 0,
      right: vb.width, bottom: vb.height, x: 0, y: 0,
    }),
    configurable: true,
  });
}

/** Hover band `i` (categories in order along the category axis). */
function hoverBand(svg: SVGSVGElement, i: number, horizontal = false): void {
  stubRect(svg);
  const cs = new Set<number>();
  svg.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect').forEach((r) => {
    const pos = parseFloat(r.getAttribute(horizontal ? "y" : "x") ?? "0");
    const size = parseFloat(r.getAttribute(horizontal ? "height" : "width") ?? "0");
    cs.add(Math.round((pos + size / 2) * 100) / 100);
  });
  const c = [...cs].sort((a, b) => a - b)[i]!;
  const vb = svg.viewBox.baseVal;
  const pt = horizontal
    ? { clientX: vb.width - 20, clientY: c }
    : { clientX: c, clientY: 20 };
  svg
    .querySelector(".tbl-band-crosshair-hit")!
    .dispatchEvent(new PointerEvent("pointermove", { ...pt, bubbles: true }));
}

/** The band-hover value pills' numbers, sorted. */
function bandPills(svg: SVGSVGElement): number[] {
  return [...svg.querySelectorAll("g.tbl-coord .tbl-coord-pill-text")]
    .map((t) => parseFloat((t.textContent ?? "").replace(/[^\d.-]/g, "")))
    .sort((a, b) => a - b);
}

/** The painted in-bar labels' numbers, sorted. */
function segLabels(svg: SVGSVGElement): number[] {
  return [...svg.querySelectorAll("g.tbl-segment-label text")]
    .map((t) => parseFloat(t.textContent ?? ""))
    .sort((a, b) => a - b);
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the whole hovered band is pilled", () => {
  it("a mixed band pills its painted segment too", () => {
    const svg = chartSvg(mount(stacked()));
    // The premise: 95 painted, 3 refused in "Mixed".
    expect(segLabels(svg)).toEqual([50, 50, 95]);
    hoverBand(svg, BAND.Mixed);
    expect(bandPills(svg)).toEqual([3, 95]);
  });

  it("a fully labelled band still pills every segment", () => {
    const svg = chartSvg(mount(stacked()));
    hoverBand(svg, BAND.Full);
    expect(bandPills(svg)).toEqual([50, 50]);
  });

  it("a horizontal stack pills its mixed band the same way", () => {
    const svg = chartSvg(mount(stacked({ orientation: "horizontal" })));
    hoverBand(svg, BAND.Mixed, true);
    expect(bandPills(svg)).toEqual([3, 95]);
  });

  it("a legend-highlighted series pills every segment of the series", () => {
    const el = mount(stacked());
    const svg = chartSvg(el);
    el.querySelector<HTMLElement>('.tbl-legend-item[data-series="two"]')!
      .dispatchEvent(new Event("pointerenter"));
    const hl = [...svg.querySelectorAll("g.tbl-hl-pills text")]
      .map((t) => parseFloat(t.textContent ?? ""))
      .sort((a, b) => a - b);
    // `two` is 3 (refused), 50 (painted), 4 (refused).
    expect(hl).toEqual([3, 4, 50]);
  });

  it("every label painted: no pills", () => {
    const svg = chartSvg(mount(stacked(), {}, ROWS, 1400));
    expect(segLabels(svg).length).toBe(6);
    hoverBand(svg, BAND.Mixed);
    expect(bandPills(svg)).toEqual([]);
  });
});
