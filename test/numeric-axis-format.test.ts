// @vitest-environment jsdom
//
// Numeric-x number formatting, at the surface a reader actually sees.
//
// The formatters themselves are unit-tested in scatter-tooltip-labels.test.ts; this file pins the
// two things only a render can show: that the AXIS TICK labels carry the thousands separator, and
// that an annual series on a TEMPORAL axis labels the right years. The second is the reason the
// first is safe — grouping every numeric x would once have printed a year as "2,021", and the
// answer is that a bare `YYYY` now belongs on a temporal axis, which renders it bare.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];
const DIMS = { width: 728, height: 400 };
const texts = (svg: SVGSVGElement): string[] =>
  Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");

describe("a numeric x axis groups thousands in its tick labels", () => {
  const spec = {
    chartType: "scatter",
    title: "T",
    xAxisType: "numeric",
    columns: { x: "x", value: "y" },
    data: "inline",
  } as unknown as ChartSpec;

  it("prints a separator on a tick above a thousand", () => {
    // A [0, 2e6] span puts d3's ticks on round hundred-thousands, every one of them grouped.
    const rows = rowsOf([{ x: "0", y: "1" }, { x: "2000000", y: "2" }]);
    const { svg } = renderChart(spec, rows, { ...DIMS, document });
    const all = texts(svg as SVGSVGElement);
    const grouped = all.filter((s) => /^[\d,]+$/.test(s) && s.includes(","));
    // Non-vacuity: there ARE such ticks, and none of them is an ungrouped six-or-more-digit run.
    expect(grouped.length).toBeGreaterThan(0);
    expect(all.filter((s) => /^\d{5,}$/.test(s))).toEqual([]);
  });

  it("leaves a sub-thousand tick bare, so a small domain is unaffected", () => {
    const rows = rowsOf([{ x: "0", y: "1" }, { x: "8", y: "2" }]);
    const { svg } = renderChart(spec, rows, { ...DIMS, document });
    expect(texts(svg as SVGSVGElement).some((s) => s.includes(","))).toBe(false);
  });
});

describe("an annual series belongs on a temporal axis, and reads as bare years there", () => {
  const spec = {
    chartType: "line",
    title: "T",
    xAxisType: "temporal",
    columns: { x: "year", series: "series", value: "value" },
    data: "inline",
  } as unknown as ChartSpec;
  // Bare `YYYY` cells — the natural spelling for an annual series, and the form `new Date(s)`
  // parses as UTC. NOTE these two tests pin the INTENDED labels; they cannot catch the year shift
  // itself, because the harness pins TZ=UTC where the two parses agree (verified: they pass against
  // the unfixed parseDate). The shift is covered in test/parse-time.test.ts, which moves the zone.
  const rows = rowsOf(
    Array.from({ length: 80 }, (_, i) => ({ year: String(1947 + i), series: "A", value: String(i) })),
  );

  it("labels the decades of the span, not the year before each", () => {
    const { svg } = renderChart(spec, rows, { ...DIMS, document });
    const all = texts(svg as SVGSVGElement);
    // A ~79-year span takes the 10-year cadence, and every tick lands on January, so
    // tblTemporalXAxis collapses to a single bare `%Y` line.
    for (const y of ["1950", "1960", "1970", "1980", "1990", "2000", "2010", "2020"]) {
      expect(all, `tick ${y}`).toContain(y);
    }
    // The off-by-one this guards: no decade label from the year before.
    for (const y of ["1949", "1959", "1969", "1979", "1989", "1999", "2009", "2019"]) {
      expect(all, `must not label ${y}`).not.toContain(y);
    }
    // And bare, not grouped — the temporal axis formats with %Y, never a number formatter.
    expect(all.some((s) => s === "2,020")).toBe(false);
  });

  it("puts the first and last row inside the frame rather than a year adrift", () => {
    // The domain is built from the parsed dates, so a UTC-shifted parse moved the whole series.
    // Reading the drawn extent back is what shows the parse landed on the right years.
    const { svg } = renderChart(spec, rows, { ...DIMS, document });
    const all = texts(svg as SVGSVGElement);
    expect(all).not.toContain("1940");
    expect(all).not.toContain("2030");
  });
});
