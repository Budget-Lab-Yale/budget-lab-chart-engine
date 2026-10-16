// validateSpec runs its cross-field rules as one table and reports every rule's errors, in table
// order — so errors[0] is the error the validator reported when it stopped at the first failing rule,
// and the rest are what an author would otherwise have found one re-run at a time.
import { describe, it, expect } from "vitest";
import { validateSpec } from "../src/spec/validate";

const LINE = { chartType: "line", title: "T", xAxisType: "temporal", data: "d.csv" };

describe("validateSpec collects every cross-field rule's errors", () => {
  it("reports two independent rule failures, the earlier rule's first", () => {
    // pointChartAxisError (scatter needs numeric x) runs before colorErrors.
    const r = validateSpec({ ...LINE, chartType: "scatter", series_colors: { a: "not a colour" } });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toBe('chartType "scatter" requires xAxisType "numeric" (got "temporal")');
    expect(r.errors[1]).toMatch(/^series_colors\["a"\]/);
  });

  it("keeps each rule's own errors together and in order", () => {
    // Two overlay errors (one rule), then a shading error (a later rule).
    const r = validateSpec({
      ...LINE,
      chartType: "area",
      overlays: [{ method: "lm", degree: 2 }, { slope: 1 }],
      shading: [{ from: "2001", to: "2002" }],
    });
    expect(r.errors).toEqual([
      "overlays[0]: `degree` applies to `method: poly`",
      "overlays[1]: `slope` and `intercept` must be given together",
      'shading is supported on chartType "line" only (got "area")',
    ]);
  });

  it("reports a malformed rug-flagged band bound once, as a date coordinate", () => {
    const r = validateSpec({
      ...LINE,
      annotations: { bands: [{ start: "not a date", end: "2001-06-01", label: "Recession", rug: true }] },
      rug: { tracks: [{ label: "Empty", intervals: [] }] },
    });
    expect(r.valid).toBe(false);
    // The bound is the date-coordinate rule's error; the rug rule still reports its own (the empty
    // track) but not a second copy of the bound.
    expect(r.errors.filter((e) => e.includes("not a date"))).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^annotations\.bands\[0\]\.start: /);
    expect(r.errors).toContain("rug.tracks[0]: `intervals` must not be empty");
  });

  it("a chart type's rejected field ends validation: no later rule re-describes it", () => {
    const r = validateSpec({
      chartType: "timeline", title: "T", xAxisType: "temporal", data: "d.csv",
      bar_color: "not a colour",
    });
    expect(r.errors).toEqual(['bar_color is not supported on chartType "timeline"']);
  });
});
