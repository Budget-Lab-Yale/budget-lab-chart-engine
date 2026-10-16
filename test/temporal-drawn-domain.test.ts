// @vitest-environment jsdom
//
// A5: on a single temporal/quarterly chart, an x marker, band or point callout past the data widens
// the scale the chart is DRAWN over. Everything that maps px <-> data before the render — overlay
// `domain: "axis"`, the top-label auto-stagger and the point-callout flip/sweep/leader — must read
// that drawn domain at every width. They used to read the data extent, except at the widths where a
// second render (fired only when the tick COUNT changed) happened to supply the drawn one.
import { describe, it, expect, vi } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import { OVERLAY_LINE_CLASS } from "../src/engine/marks/overlay";
import { TBL_MARGIN_RIGHT } from "../src/engine/theme";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// `drawnDateDomain` can be switched off, which hands the axis no explicit range and leaves Plot to
// infer it from the marks, as it did before A5. The equality suite below compares the two.
const inferred = vi.hoisted(() => ({ on: false }));
vi.mock("../src/engine/x-adapter", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/engine/x-adapter")>();
  return {
    ...m,
    drawnDateDomain: (...a: Parameters<typeof m.drawnDateDomain>) => (inferred.on ? undefined : m.drawnDateDomain(...a)),
  };
});

const WIDTHS = [760, 600, 500, 390];

const annual = (from: number, to: number): TidyRow[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ time: String(from + i), value: String((i * 7) % 5 + i / 4) })) as unknown as TidyRow[];

function line(extra: Record<string, unknown>): ChartSpec {
  return { chartType: "line", title: "t", xAxisType: "temporal", data: "x.csv", ...extra } as unknown as ChartSpec;
}

const xDomainYear = (svg: SVGSVGElement, i: 0 | 1): number =>
  new Date((svg as any).scale("x").domain[i]).getFullYear();

/** Every x coordinate in an overlay path's `d`. */
const overlayXs = (svg: SVGSVGElement): number[] =>
  Array.from(svg.querySelectorAll<SVGPathElement>(`g.${OVERLAY_LINE_CLASS} path`)).flatMap((p) =>
    Array.from(p.getAttribute("d")!.matchAll(/[ML](-?[\d.]+),/g)).map((m) => Number(m[1])),
  );

const textNamed = (svg: SVGSVGElement, label: string): SVGTextElement => {
  const t = Array.from(svg.querySelectorAll("text")).find((e) => e.textContent === label);
  if (!t) throw new Error(`no text "${label}"`);
  return t as SVGTextElement;
};

/** A text mark's `dy`, which Plot writes into its group's transform. */
const markDy = (t: SVGTextElement): number => {
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(t.parentElement!.getAttribute("transform") ?? "");
  if (!m) throw new Error("text group has no translate");
  return Number(m[2]);
};

describe("overlay `domain: axis` spans the drawn x scale (CONFIG-SPEC overlays[].domain)", () => {
  // Data 2000–2020, a marker at 2030: the scale runs 2000–2030 at every width.
  const spec = line({
    annotations: { xAxis: [{ x: "2030" }] },
    overlays: [{ method: "lm", domain: "axis" }],
  });
  const rows = annual(2000, 2020);

  it.each(WIDTHS)("reaches the frame's right edge at %ipx", (width) => {
    const { svg } = renderChart(spec, rows, { width, height: 320, document });
    expect(xDomainYear(svg, 1)).toBe(2030);
    const xs = overlayXs(svg);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeCloseTo(width - TBL_MARGIN_RIGHT, 1);
  });

  it("reaches it in the PNG export too", () => {
    const svg = buildExportSvg(spec, rows);
    const xs = overlayXs(svg);
    expect(xs.length).toBeGreaterThan(0);
    // The export lays the chart into its own canvas, so compare against the 2030 marker's rule,
    // which sits on the frame's right edge in the same coordinates.
    const rules = Array.from(svg.querySelectorAll('g[aria-label="rule"] line')).map((l) => Number(l.getAttribute("x1")));
    expect(Math.max(...xs)).toBeCloseTo(Math.max(...rules), 1);
  });
});

describe("top-label auto-stagger measures on the drawn x scale", () => {
  // Two labelled markers two years apart, plus an unlabelled one past the data that widens the
  // scale to 2000–2030. On the drawn scale the pair sit 1/15 of the frame apart and their labels
  // overlap; measured on the data extent (2000–2020) they were 1/10 apart and did not.
  const spec = line({
    annotations: {
      xAxis: [
        { x: "2010", label: "Event A1" },
        { x: "2012", label: "Event B2" },
        { x: "2030" },
      ],
    },
  });
  const rows = annual(2000, 2020);

  it.each(WIDTHS)("puts the overlapping labels on different rows at %ipx", (width) => {
    const { svg } = renderChart(spec, rows, { width, height: 320, document });
    expect(xDomainYear(svg, 1)).toBe(2030);
    expect(markDy(textNamed(svg, "Event B2"))).not.toBe(markDy(textNamed(svg, "Event A1")));
  });
});

describe("point-callout frame-edge flip measures on the drawn x scale", () => {
  // The callout sits on the last observation (2020); a marker at 2030 widens the scale, so the
  // point is two thirds of the way across the frame, clear of the edge. Measured on the data
  // extent it sat ON the right edge and the label flipped to end-anchored.
  const spec = line({
    annotations: {
      xAxis: [{ x: "2030" }],
      points: [{ x: "2020", y: 3, label: "A fairly long callout label" }],
    },
  });
  const rows = annual(2000, 2020);

  it.each(WIDTHS)("keeps the label centred at %ipx", (width) => {
    const { svg } = renderChart(spec, rows, { width, height: 320, document });
    expect(xDomainYear(svg, 1)).toBe(2030);
    const t = textNamed(svg, "A fairly long callout label");
    const anchor = t.getAttribute("text-anchor") ?? t.closest("g")?.getAttribute("text-anchor");
    expect(anchor ?? "middle").toBe("middle");
  });
});

describe("a single chart and a one-pane figure draw the same x scale", () => {
  it.each(WIDTHS)("at %ipx", (width) => {
    const spec = line({
      annotations: { xAxis: [{ x: "2030", label: "later" }] },
      overlays: [{ method: "lm", domain: "axis" }],
    });
    const rows = annual(2000, 2020);
    const single = renderChart(spec, rows, { width, height: 320, document }).svg;
    const faceted = { ...spec, columns: { facet: "f" }, small_multiples: { columns: 1, mode: "per-pane" } } as unknown as ChartSpec;
    const fig = renderFigure(faceted, rows.map((r) => ({ ...r, f: "only" })) as TidyRow[], { width, gridWidth: width, height: 320, document });
    const pane = fig.panes[0]!.svg as SVGSVGElement;
    expect((pane as any).scale("x").domain.map(Number)).toEqual((single as any).scale("x").domain.map(Number));
    // Both overlays end on their own frame's right edge.
    for (const svg of [single, pane]) {
      const sx = (svg as any).scale("x");
      expect(Math.max(...overlayXs(svg))).toBeCloseTo(sx.apply(sx.domain[1]), 1);
    }
  });
});

// The computed range must be the one Plot infers from the marks, for every kind of mark that can sit
// past the data: anything it misses would be drawn off the frame. Each case renders twice, with the
// computed range and with Plot left to infer it.
describe("the computed drawn range equals Plot's own over the marks", () => {
  const rows = annual(2005, 2015);
  const cases: Array<[string, Record<string, unknown>]> = [
    ["no annotations", {}],
    ["x markers on both sides of the data", { annotations: { xAxis: [{ x: "1998", label: "before" }, { x: "2021-06-01" }] } }],
    ["an x marker inside the data", { annotations: { xAxis: [{ x: "2010" }] } }],
    ["a legend-keyed x marker", { annotations: { xAxis: [{ x: "2024", label: "keyed", legend: true }] } }],
    ["a band reaching past the data", { annotations: { bands: [{ start: "2013", end: "2019-03-01", label: "proj" }] } }],
    ["a band before the data", { annotations: { bands: [{ start: "1999", end: "2001" }] } }],
    ["a rug-keyed band", { annotations: { bands: [{ start: "2012", end: "2018", label: "r", rug: true }] } }],
    ["a point callout past the data", { annotations: { points: [{ x: "2020", y: 2, label: "later" }] } }],
    ["a point callout before the data", { annotations: { points: [{ x: "2001", y: 2, label: "earlier", connector: true, dy: 20 }] } }],
    ["a sideways connector whose label end stays inside the data", { annotations: { points: [{ x: "2010", y: 2, label: "mid", connector: true, dx: 40, dy: 30 }] } }],
    ["a series-snapped callout with no row at its x (draws nothing)", { annotations: { points: [{ x: "2030", series: "", label: "none" }] } }],
    ["overlay domain axis with a marker", { annotations: { xAxis: [{ x: "2025" }] }, overlays: [{ method: "lm", domain: "axis" }] }],
    ["shading and a marker", { shading: [{ from: "2007", to: "2012" }], annotations: { xAxis: [{ x: "2019" }] } }],
    ["x_ticks with a marker", { x_ticks: ["2005", "2010", "2015", "2020"], annotations: { xAxis: [{ x: "2022" }] } }],
  ];

  const domainOf = (spec: ChartSpec, r: TidyRow[], width: number, infer: boolean): number[] => {
    inferred.on = infer;
    try {
      return (renderChart(spec, r, { width, height: 320, document }).svg as any).scale("x").domain.map(Number);
    } finally {
      inferred.on = false;
    }
  };

  it.each(cases)("line: %s", (_name, extra) => {
    const spec = line(extra);
    for (const width of [760, 390]) expect(domainOf(spec, rows, width, false)).toEqual(domainOf(spec, rows, width, true));
  });

  it.each(cases.filter(([n]) => !n.includes("callout with no row")))("area: %s", (_name, extra) => {
    const spec = { ...line(extra), chartType: "area" } as ChartSpec;
    expect(domainOf(spec, rows, 600, false)).toEqual(domainOf(spec, rows, 600, true));
  });

  it("quarterly: markers, a band and a callout past the data", () => {
    const qrows = ["2019Q1", "2019Q2", "2019Q3", "2019Q4", "2020Q1"].map((q, i) => ({ time: q, value: String(i) })) as unknown as TidyRow[];
    const spec = line({
      xAxisType: "quarterly",
      annotations: {
        xAxis: [{ x: "2018Q3" }],
        bands: [{ start: "2019Q4", end: "2021Q2" }],
        points: [{ x: "2021Q4", y: 1, label: "q" }],
      },
    });
    expect(domainOf(spec, qrows, 600, false)).toEqual(domainOf(spec, qrows, 600, true));
  });

  it("a legend-scoped series_order drops rows from the domain the same way", () => {
    const two = [...rows.map((r) => ({ ...r, series: "A" })), ...annual(1990, 2025).map((r) => ({ ...r, series: "B" }))] as unknown as TidyRow[];
    const spec = line({ columns: { series: "series" }, series_order: ["A"], annotations: { xAxis: [{ x: "2018" }] } });
    expect(domainOf(spec, two, 600, false)).toEqual(domainOf(spec, two, 600, true));
  });

  it("the probe a small-multiples figure reads matches too (facet-scoped markers)", () => {
    const fr = [...rows.map((r) => ({ ...r, f: "P" })), ...annual(2008, 2012).map((r) => ({ ...r, f: "Q" }))] as unknown as TidyRow[];
    const spec = line({
      columns: { facet: "f" },
      small_multiples: { columns: 2, mode: "shared" },
      annotations: { xAxis: [{ x: "2003", facet: "Q" }, { x: "2017", facet: "P" }], points: [{ x: "2019", y: 1, label: "p" }] },
    });
    const domains = (infer: boolean) => {
      inferred.on = infer;
      try {
        return renderFigure(spec, fr, { width: 720, height: 320, document }).panes.map((p) => (p.svg as any).scale("x").domain.map(Number));
      } finally {
        inferred.on = false;
      }
    };
    expect(domains(false)).toEqual(domains(true));
  });
});


// A connector with an author's `dx` ends at a DATA coordinate (point + dx px, converted at the drawn
// span per px), so it is part of the range too. Plot's own inference cannot be the reference here:
// it saw an end converted at the DATA extent's span per px, a scale the chart is no longer drawn
// over. The computed range is the least one that holds every end converted at its own span, so the
// binding end lands exactly on the frame edge, the leader is exactly `dx` px long, and the range
// contains what Plot inferred.
describe("sideways connectors widen the drawn range to hold their label end", () => {
  const rows = annual(2000, 2020);
  const arrowXs = (svg: SVGSVGElement): number[] =>
    Array.from(svg.querySelectorAll<SVGPathElement>('g[aria-label="arrow"] path')).flatMap((p) =>
      Array.from(p.getAttribute("d")!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)).map((m) => Number(m[1])),
    );
  const render = (spec: ChartSpec, width: number, infer = false) => {
    inferred.on = infer;
    try {
      return renderChart(spec, rows, { width, height: 320, document }).svg;
    } finally {
      inferred.on = false;
    }
  };
  const callout = (x: string, dx: number) => ({ x, y: 3, label: "c", connector: true, dx, dy: 60 });

  it.each([
    ["right, from the last observation", [callout("2020", 80)], "right"],
    ["left, from the first observation", [callout("2000", -80)], "left"],
    ["both sides at once", [callout("2020", 80), callout("2000", -50)], "both"],
    ["right, past an x marker that already widens the axis", [callout("2020", 120)], "right"],
  ] as const)("%s", (name, points, side) => {
    const extra = name.includes("x marker") ? { xAxis: [{ x: "2024" }] } : {};
    const spec = line({ annotations: { ...extra, points } });
    for (const width of WIDTHS) {
      const svg = render(spec, width);
      const sx = (svg as any).scale("x");
      const [lo, hi] = sx.domain as [Date, Date];
      const frame = [sx.apply(lo) as number, sx.apply(hi) as number];
      // Every arrow is inside the frame (the repro drew one to x≈822 on a 760px chart).
      const xs = arrowXs(svg);
      expect(xs.length).toBe(points.length * 2);
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(frame[0]! - 0.01);
        expect(x).toBeLessThanOrEqual(frame[1]! + 0.01);
      }
      // The binding end sits ON the frame edge: the edge is exactly `dx` px from its point.
      for (const p of points) {
        const at = sx.apply(new Date(Number(p.x), 0, 1)) as number;
        if (p.dx > 0 && side !== "left") expect(frame[1]! - at).toBeCloseTo(p.dx, 2);
        if (p.dx < 0 && side !== "right") expect(frame[0]! - at).toBeCloseTo(p.dx, 2);
      }
      // And the range holds everything Plot inferred from the old, data-extent conversion.
      const old = ((render(spec, width, true) as any).scale("x").domain as Date[]).map(Number);
      expect(+lo).toBeLessThanOrEqual(old[0]!);
      expect(+hi).toBeGreaterThanOrEqual(old[1]!);
    }
  });

  it("an end that stays inside the data leaves the range alone", () => {
    const spec = line({ annotations: { points: [callout("2010", 60), callout("2012", -60)] } });
    for (const width of WIDTHS) {
      expect(((render(spec, width) as any).scale("x").domain as Date[]).map((d) => new Date(d).getFullYear())).toEqual([2000, 2020]);
    }
  });
});

// Intentional difference (ruled a correction in the A5 review): "blank values at the x-extent
// boundary". Where a chart's marks drop rows with a blank value — point marks (scatter, dot plot)
// and a line split by `projected_field` — and the first or last rows are blank, Plot inferred a
// range from the remaining marks, which on a date axis meant the first and last tick LABEL: an
// artifact of where the ticks fell. The drawn range is now the data extent, blank rows included, as
// on a plain line or area chart, whose marks keep those rows. A precomputed range cannot reproduce
// the artifact without a second render. No published figure has the trigger (see T5.5 report:
// no archive temporal chart is a point chart or uses `projected_field`, none has a blank boundary
// row, and every one draws the same range computed or inferred). Scatter and dot plot are rejected
// on a date axis by validation, so they reach this only through an unvalidated render.
describe("blank values at the x-extent boundary: the drawn range is the full data extent", () => {
  const months = ["2010-05-01", "2010-09-01", "2011-03-01", "2011-08-01", "2012-04-01"];
  const quarters = ["2010Q2", "2010Q3", "2011Q1", "2011Q3", "2012Q2"];
  const values = ["", "1", "2", "3", ""];
  const rowsOn = (xs: string[]) =>
    xs.map((time, i) => ({ time, value: values[i], proj: i >= 2 ? "1" : "0" })) as unknown as TidyRow[];
  const domain = (spec: ChartSpec, rows: TidyRow[], width: number, infer: boolean): string[] => {
    inferred.on = infer;
    try {
      return ((renderChart(spec, rows, { width, height: 320, document }).svg as any).scale("x").domain as Date[]).map((d) =>
        new Date(d).toISOString().slice(0, 10),
      );
    } finally {
      inferred.on = false;
    }
  };

  // The affected class: the marks drop the blank rows. On the monthly rows Plot's own range started
  // at the first tick label (Jul 2010) rather than the first row (May 2010).
  it.each([
    ["scatter", { chartType: "scatter" }],
    ["dot plot", { chartType: "dotplot" }],
    ["projected line", { projected_field: "proj" }],
    ["projected line, solid", { projected_field: "proj", projected_style: { dashed: false } }],
  ] as const)("%s", (_name, extra) => {
    const spec = line(extra);
    const rows = rowsOn(months);
    for (const width of WIDTHS) {
      expect(domain(spec, rows, width, false)).toEqual(["2010-05-01", "2012-04-01"]);
      expect(domain(spec, rows, width, true)[0]).toBe("2010-07-01");
    }
  });

  // On a quarterly axis whether a tick sits on the first row depends on the width; the drawn range
  // is the data extent at every width.
  it("projected line, quarterly", () => {
    const spec = line({ xAxisType: "quarterly", projected_field: "proj" });
    for (const width of WIDTHS) expect(domain(spec, rowsOn(quarters), width, false)).toEqual(["2010-04-01", "2012-04-01"]);
  });

  // Outside the class: the marks keep blank rows, so computed and inferred already agree.
  it.each([
    ["line", {}],
    ["line with a dashed series", { columns: { series: "s" }, series_styles: { A: { dashed: true } } }],
    ["area", { chartType: "area" }],
    ["area with projected_field", { chartType: "area", projected_field: "proj" }],
  ] as const)("%s is unchanged", (_name, extra) => {
    const spec = line(extra);
    const rows = rowsOn(months).map((r) => ({ ...r, s: "A" })) as unknown as TidyRow[];
    for (const width of WIDTHS) {
      expect(domain(spec, rows, width, false)).toEqual(["2010-05-01", "2012-04-01"]);
      expect(domain(spec, rows, width, true)).toEqual(["2010-05-01", "2012-04-01"]);
    }
  });
});

// CONFIG-SPEC overlays[].domain: "An overlay never widens the x axis … On a temporal or quarterly
// axis, an `annotations.xAxis` marker, a `bands` entry or a `points` callout past the data does."
describe("what widens a date axis (CONFIG-SPEC overlays[].domain)", () => {
  const rows = annual(2000, 2020);
  const years = (extra: Record<string, unknown>, xAxisType = "temporal"): number[] => {
    const r = xAxisType === "quarterly" ? (rows.map((x: any) => ({ ...x, time: `${x.time}Q1` })) as unknown as TidyRow[]) : rows;
    const svg = renderChart(line({ xAxisType, ...extra }), r, { width: 600, height: 320, document }).svg;
    return ((svg as any).scale("x").domain as Date[]).map((d) => new Date(d).getFullYear());
  };

  it("an overlay does not", () => {
    expect(years({ overlays: [{ method: "lm", domain: "axis" }, { column: "value" }] })).toEqual([2000, 2020]);
  });

  it.each(["temporal", "quarterly"])("%s: a marker, a band or a callout past the data does", (axis) => {
    const at = (y: number) => (axis === "quarterly" ? `${y}Q1` : String(y));
    expect(years({ annotations: { xAxis: [{ x: at(2026) }] } }, axis)).toEqual([2000, 2026]);
    expect(years({ annotations: { bands: [{ start: at(1995), end: at(2001) }] } }, axis)).toEqual([1995, 2020]);
    expect(years({ annotations: { points: [{ x: at(2028), y: 1, label: "p" }] } }, axis)).toEqual([2000, 2028]);
  });
});

