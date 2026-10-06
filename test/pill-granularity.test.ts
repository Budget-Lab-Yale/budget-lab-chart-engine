// @vitest-environment jsdom
//
// TEMPORARY A/B switch (MountOptions.pillGranularity), not a spec field. A designer is choosing
// between two granularities for the stacked-chart hover value pills when `valueLabels.show` paints
// in-bar labels but the fit threshold refuses some of them:
//   "band"    (default, current) — if ANY segment's label was refused, the hovered band pills EVERY
//             segment, so a number already painted in a bar appears twice.
//   "segment" — pills only for the segments whose label was refused.
// Once one is chosen, the other mode and this switch go.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import type { MountOptions } from "../src/engine/render-live";
import { renderChart } from "../src/engine/index";
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

describe("renderChart reports WHICH segments' labels were refused", () => {
  it("lists exactly the refused (category, series) pairs, and nothing when labels are off", () => {
    const withLabels = renderChart(stacked(), ROWS, { width: 720, height: 400, document });
    expect(withLabels.segmentLabelsDropped).toBe(true);
    expect(
      (withLabels.segmentLabelsRefused ?? []).map((s) => `${s.category}/${s.series}`).sort(),
    ).toEqual(["Mixed/two", "Thin/one", "Thin/two"]);
    const noLabels = renderChart(stacked({ valueLabels: undefined }), ROWS, { width: 720, height: 400, document });
    expect(noLabels.segmentLabelsRefused).toBeUndefined();
  });
});

describe.each([
  ["band (default, omitted)", {}],
  ["band (explicit)", { pillGranularity: "band" as const }],
])("pillGranularity %s: the whole hovered band is pilled", (_name, extra) => {
  it("a mixed band pills its painted segment too", () => {
    const svg = chartSvg(mount(stacked(), extra));
    // The premise: 95 painted, 3 refused in "Mixed".
    expect(segLabels(svg)).toEqual([50, 50, 95]);
    hoverBand(svg, BAND.Mixed);
    expect(bandPills(svg)).toEqual([3, 95]);
  });

  it("a fully labelled band still pills every segment", () => {
    const svg = chartSvg(mount(stacked(), extra));
    hoverBand(svg, BAND.Full);
    expect(bandPills(svg)).toEqual([50, 50]);
  });
});

describe("pillGranularity: segment — pills only where the in-bar label was refused", () => {
  const SEG = { pillGranularity: "segment" as const };

  it("a mixed band pills only its refused segment", () => {
    const svg = chartSvg(mount(stacked(), SEG));
    expect(segLabels(svg)).toEqual([50, 50, 95]);
    hoverBand(svg, BAND.Mixed);
    expect(bandPills(svg)).toEqual([3]);
  });

  it("a fully labelled band gets no pills, but keeps its shaded region", () => {
    const svg = chartSvg(mount(stacked(), SEG));
    hoverBand(svg, BAND.Full);
    expect(bandPills(svg)).toEqual([]);
    expect(svg.querySelectorAll("g.tbl-coord .tbl-coord-region").length).toBeGreaterThan(0);
  });

  it("a fully refused band pills every segment", () => {
    const svg = chartSvg(mount(stacked(), SEG));
    hoverBand(svg, BAND.Thin);
    expect(bandPills(svg)).toEqual([4, 4]);
  });

  it("horizontal stacks gate the same way", () => {
    const h = stacked({ orientation: "horizontal" });
    const svgB = chartSvg(mount(h));
    hoverBand(svgB, BAND.Mixed, true);
    expect(bandPills(svgB)).toEqual([3, 95]);
    const svgS = chartSvg(mount(h, SEG));
    // The wider value axis paints "Thin"'s 4s here; "Mixed"'s 3 is still refused.
    expect(segLabels(svgS)).toEqual([4, 4, 50, 50, 95]);
    hoverBand(svgS, BAND.Mixed, true);
    expect(bandPills(svgS)).toEqual([3]);
  });

  it("legend-highlight pills skip the painted segments too", () => {
    const el = mount(stacked(), SEG);
    const svg = chartSvg(el);
    el.querySelector<HTMLElement>('.tbl-legend-item[data-series="two"]')!
      .dispatchEvent(new Event("pointerenter"));
    const hl = [...svg.querySelectorAll("g.tbl-hl-pills text")]
      .map((t) => parseFloat(t.textContent ?? ""))
      .sort((a, b) => a - b);
    // `two` is 3 (refused), 50 (painted), 4 (refused).
    expect(hl).toEqual([3, 4]);
  });

  it("the same legend gesture in band mode pills every segment of the series", () => {
    const el = mount(stacked());
    const svg = chartSvg(el);
    el.querySelector<HTMLElement>('.tbl-legend-item[data-series="two"]')!
      .dispatchEvent(new Event("pointerenter"));
    const hl = [...svg.querySelectorAll("g.tbl-hl-pills text")]
      .map((t) => parseFloat(t.textContent ?? ""))
      .sort((a, b) => a - b);
    expect(hl).toEqual([3, 4, 50]);
  });

  it("labels off: nothing is painted, so every segment keeps its pill", () => {
    const svg = chartSvg(mount(stacked({ valueLabels: undefined }), SEG));
    hoverBand(svg, BAND.Full);
    expect(bandPills(svg)).toEqual([50, 50]);
  });

  it("an explicit chrome.valuePills: true still pills every segment", () => {
    const svg = chartSvg(mount(stacked({ chrome: { valuePills: true } }), SEG));
    hoverBand(svg, BAND.Mixed);
    expect(bandPills(svg)).toEqual([3, 95]);
  });

  it("every label painted: no pills in either mode (the default is unchanged)", () => {
    for (const extra of [{}, SEG]) {
      const svg = chartSvg(mount(stacked(), extra, ROWS, 1400));
      expect(segLabels(svg).length).toBe(6);
      hoverBand(svg, BAND.Mixed);
      expect(bandPills(svg)).toEqual([]);
    }
  });

  it("the static chart is byte-identical in both modes (pills are hover-only)", () => {
    const a = chartSvg(mount(stacked())).outerHTML;
    const b = chartSvg(mount(stacked(), SEG)).outerHTML;
    expect(b).toBe(a);
  });
});
