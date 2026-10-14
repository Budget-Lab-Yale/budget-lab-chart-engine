// @vitest-environment jsdom
//
// Small-multiples panes on a continuous x-axis share ONE x range, and a temporal axis thins its
// ticks when their labels would not fit the plot width.
//
// Motivating figure: an SCF chart whose two panes ran 2001–2025 and 2004–2025 (balances by IRA
// type start in 2004). Each pane fitted its own rows, so the panes' axes disagreed, and the
// 24-year span picked a 2-year cadence that crowded a half-width pane.

import { describe, it, expect, beforeEach } from "vitest";
import { mountHover, coordShown, coordTexts } from "./helpers/hover-harness";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { renderFigure, renderChart } from "../src/engine/index";
import { temporalXTicks, measuredLabelWidth } from "../src/engine/axes";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SURVEYS = ["2001", "2004", "2007", "2010", "2013", "2016", "2019", "2022", "2025"];

function rowsFor(facet: string, years: string[], xKey = "time"): TidyRow[] {
  return years.map((y, i) => ({ facet, [xKey]: y, value: String(10 + i) }));
}

// Two panes with different x spans: the second starts three surveys later.
const ROWS: TidyRow[] = [...rowsFor("Holders", SURVEYS), ...rowsFor("Balances", SURVEYS.slice(1))];

function spec(mode: "shared" | "per-pane", extra: Partial<ChartSpec> = {}): ChartSpec {
  return {
    chartType: "line",
    title: "t",
    xAxisType: "temporal",
    data: "x.csv",
    columns: { facet: "facet" },
    small_multiples: { columns: 2, mode, pane_order: ["Holders", "Balances"] },
    ...extra,
  } as ChartSpec;
}

const yearLabels = (svg: SVGSVGElement): string[] =>
  Array.from(svg.querySelectorAll("text"))
    .map((t) => t.textContent ?? "")
    .filter((t) => /^\d{4}$/.test(t));

const xDomainMs = (svg: SVGSVGElement): number[] =>
  ((svg as any).scale("x").domain as Array<Date | number>).map((d) => +d);

describe("temporalXTicks — thins when labels would collide", () => {
  const span: [Date, Date] = [new Date(2001, 0, 1), new Date(2025, 0, 1)];

  it("keeps the span-based cadence when no width is given", () => {
    const ticks = temporalXTicks(span);
    expect(ticks[1]!.getFullYear() - ticks[0]!.getFullYear()).toBe(2);
  });

  it("keeps the span-based cadence when the labels fit", () => {
    const ticks = temporalXTicks(span, 640);
    expect(ticks[1]!.getFullYear() - ticks[0]!.getFullYear()).toBe(2);
  });

  it("steps up the cadence in a narrow plot", () => {
    const ticks = temporalXTicks(span, 300);
    const step = ticks[1]!.getFullYear() - ticks[0]!.getFullYear();
    expect(step).toBeGreaterThan(2);
    expect(ticks.every((t) => t.getMonth() === 0)).toBe(true);
  });

  it("stops at the coarsest cadence in a plot too narrow for any", () => {
    const ticks = temporalXTicks(span, 40);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
  });
});

describe.each(["per-pane", "shared"] as const)("%s mode — panes share one x range", (mode) => {
  // As the live grid calls it: per-pane mode renders each pane at its cell width, shared mode
  // splits the grid width itself.
  const size = mode === "per-pane" ? { width: 350, gridWidth: 720 } : { width: 720 };
  it("gives every pane the same x domain and the same tick labels", () => {
    const fig = renderFigure(spec(mode), ROWS, { ...size, height: 400, document });
    const [a, b] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(xDomainMs(a!)).toEqual(xDomainMs(b!));
    expect(yearLabels(b!)).toEqual(yearLabels(a!));
    // The later-starting pane is drawn against the full range, not its own rows.
    expect(new Date(xDomainMs(b!)[0]!).getFullYear()).toBe(2001);
  });

  it("does not crowd a half-width pane with a 2-year cadence", () => {
    const fig = renderFigure(spec(mode), ROWS, { ...size, height: 400, document });
    const labels = yearLabels(fig.panes[0]!.svg as SVGSVGElement).map(Number);
    expect(labels.length).toBeGreaterThan(1);
    expect(labels[1]! - labels[0]!).toBeGreaterThan(2);
  });

  it.each([
    ["marker", { xAxis: [{ x: "2030", label: "later", facet: "Balances" }] }],
    ["band", { bands: [{ start: "2022", end: "2030", label: "later" }] }],
    ["callout", { points: [{ x: "2030", y: 12, label: "later", facet: "Balances" }] }],
  ])("widens every pane to a %s that reaches beyond the data", (_kind, annotations) => {
    const fig = renderFigure(spec(mode, { annotations } as Partial<ChartSpec>), ROWS, { ...size, height: 400, document });
    const [a, b] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(new Date(xDomainMs(b!)[1]!).getFullYear()).toBe(2030);
    expect(xDomainMs(a!)).toEqual(xDomainMs(b!));
  });

  it("shares a quarterly x range", () => {
    const quarters = ["2020Q1", "2020Q2", "2020Q3", "2020Q4", "2021Q1", "2021Q2"];
    const rows = [...rowsFor("Holders", quarters), ...rowsFor("Balances", quarters.slice(2))];
    const fig = renderFigure(spec(mode, { xAxisType: "quarterly" }), rows, { ...size, height: 400, document });
    const [a, b] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(xDomainMs(a!)).toEqual(xDomainMs(b!));
    expect(new Date(xDomainMs(b!)[0]!).getMonth()).toBe(0);
  });

  it("shares a numeric x range too", () => {
    const numeric = spec(mode, { xAxisType: "numeric" });
    const fig = renderFigure(numeric, ROWS, { ...size, height: 400, document });
    const [a, b] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(xDomainMs(a!)).toEqual(xDomainMs(b!));
    expect(xDomainMs(b!)[0]).toBe(2001);
  });

  it("leaves categorical panes with their own categories", () => {
    const categorical = spec(mode, { xAxisType: "categorical" });
    const fig = renderFigure(categorical, ROWS, { ...size, height: 400, document });
    const [a, b] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect((a as any).scale("x").domain).toEqual(SURVEYS);
    expect((b as any).scale("x").domain).toEqual(SURVEYS.slice(1));
  });

  it("aligns categorical panes padded with a blank-value row and x_order", () => {
    const padded = [...ROWS, { facet: "Balances", time: "2001", value: "" }];
    const fig = renderFigure(spec(mode, { xAxisType: "categorical", x_order: SURVEYS }), padded, {
      ...size,
      height: 400,
      document,
    });
    const [a, b] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect((a as any).scale("x").domain).toEqual(SURVEYS);
    expect((b as any).scale("x").domain).toEqual(SURVEYS);
  });
});

// Hover maps the pointer through the x range the pane DREW, not the pane's own data extent: a
// pane whose data starts later is drawn over the shared range, and its cursor must agree.
describe("hover on a pane drawn over the shared x range", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const hoverRows: TidyRow[] = [
    ...["0", "5", "10"].map((x, i) => ({ pane: "A", time: x, value: String(1 + i) })),
    ...["5", "7", "10"].map((x, i) => ({ pane: "B", time: x, value: String(4 + i) })),
  ];
  const hoverSpec = (mode: "shared" | "per-pane"): ChartSpec =>
    ({
      title: "t",
      data: "inline",
      chartType: "line",
      xAxisType: "numeric",
      columns: { x: "time", value: "value", facet: "pane" },
      small_multiples: { columns: 2, mode, pane_order: ["A", "B"] },
    }) as unknown as ChartSpec;

  it.each(["shared", "per-pane"] as const)("%s: hovering B's point at x=7 reads 7, and the dot sits on it", (mode) => {
    const m = mountHover(hoverSpec(mode), hoverRows, true);
    const b = m.svgs[1]!;
    const px = (b as any).scale("x").apply(7) as number;
    b.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
      new PointerEvent("pointermove", { clientX: px, clientY: 100, bubbles: true }),
    );
    expect(coordShown(b)).toBe(true);
    expect(coordTexts(b)).toContain("7");
    const dot = b.querySelector<SVGCircleElement>("g.tbl-coord circle");
    expect(Math.abs(+dot!.getAttribute("cx")! - px)).toBeLessThan(1);
  });
});

// Labels sit on the DRAWN scale: when a marker past the data widens it, the gaps between them shrink.
describe("tick labels clear each other on the drawn scale", () => {
  const minGap = (svg: SVGSVGElement): number => {
    const sx = (svg as any).scale("x");
    const xs = yearLabels(svg).map((y) => sx.apply(new Date(+y, 0, 1)) as number);
    return Math.min(...xs.slice(1).map((x, i) => x - xs[i]!));
  };
  const clearance = measuredLabelWidth("2000") + 8;

  it("on a single chart with a marker far past the data", () => {
    const rows = SURVEYS.map((y, i) => ({ time: y, value: String(i) }));
    const marker = { chartType: "line", title: "t", xAxisType: "temporal", data: "x.csv",
      annotations: { xAxis: [{ x: "2100", label: "later" }] } } as unknown as ChartSpec;
    const { svg } = renderChart(marker, rows as TidyRow[], { width: 350, height: 300, document });
    expect(new Date(xDomainMs(svg)[1]!).getFullYear()).toBe(2100);
    expect(minGap(svg)).toBeGreaterThanOrEqual(clearance);
  });

  it.each(["per-pane", "shared"] as const)("on %s panes when one pane's marker widens the shared range", (mode) => {
    const size = mode === "per-pane" ? { width: 350, gridWidth: 720 } : { width: 720 };
    const marker = spec(mode, { annotations: { xAxis: [{ x: "2100", label: "later", facet: "Balances" }] } } as Partial<ChartSpec>);
    const fig = renderFigure(marker, ROWS, { ...size, height: 400, document });
    for (const p of fig.panes) expect(minGap(p.svg as SVGSVGElement)).toBeGreaterThanOrEqual(clearance);
  });
});

describe("unequal pane_widths", () => {
  it.each(["per-pane", "shared"] as const)("%s: every pane gets the same ticks and bottom margin", (mode) => {
    const quarters = ["2020Q1", "2020Q3", "2021Q1", "2021Q3", "2022Q1"];
    const rows = [...rowsFor("Holders", quarters), ...rowsFor("Balances", quarters)];
    const s = spec(mode, { xAxisType: "quarterly" });
    s.small_multiples = { ...s.small_multiples!, pane_widths: [1, 5] } as never;
    const fig = renderFigure(s, rows, { width: 720, gridWidth: 720, height: 320, document });
    const [a, b] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(a!.dataset.marginBottom).toBe(b!.dataset.marginBottom);
    const labels = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "").filter((t) => /^(\d{4}|[A-Z][a-z]{2})$/.test(t));
    expect(labels(b!)).toEqual(labels(a!));
  });
});

describe("tick fitting edge cases", () => {
  it("keeps stepping past 50 years until the labels clear", () => {
    const span: [Date, Date] = [new Date(1900, 0, 1), new Date(2025, 0, 1)];
    const scale: [number, number] = [+span[0], +new Date(3000, 0, 1)];
    const ticks = temporalXTicks(span, 290, scale);
    const pxPerMs = 290 / (scale[1] - scale[0]);
    const gaps = ticks.slice(1).map((t, i) => (+t - +ticks[i]!) * pxPerMs);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(measuredLabelWidth("2000") + 8);
  });

  it.each(["per-pane", "shared"] as const)("%s: fits ticks to the plot width a margin override leaves", (mode) => {
    const size = mode === "per-pane" ? { width: 350, gridWidth: 720 } : { width: 720 };
    const fig = renderFigure(spec(mode), ROWS, { ...size, height: 400, marginRight: 220, document });
    for (const p of fig.panes) {
      const svg = p.svg as SVGSVGElement;
      const sx = (svg as any).scale("x");
      const xs = yearLabels(svg).map((y) => sx.apply(new Date(+y, 0, 1)) as number);
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(measuredLabelWidth("2000") + 8);
    }
  });

  it.each(["per-pane", "shared"] as const)("%s temporal histogram with unequal pane_widths: same bottom margin", (mode) => {
    const days = ["2020-01-01", "2020-06-01", "2021-01-01", "2021-06-01", "2022-01-01"];
    const rows = ["Holders", "Balances"].flatMap((facet) => days.map((d) => ({ facet, time: d })));
    const hist = {
      chartType: "histogram",
      title: "t",
      xAxisType: "temporal",
      data: "x.csv",
      columns: { x: "time", facet: "facet" },
      histogram: { bins: 4 },
      small_multiples: { columns: 2, mode, pane_order: ["Holders", "Balances"], pane_widths: [1, 5] },
    } as unknown as ChartSpec;
    const fig = renderFigure(hist, rows as TidyRow[], { width: 720, gridWidth: 720, height: 320, document });
    const [a, b] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(a!.dataset.marginBottom).toBe(b!.dataset.marginBottom);
  });
});
