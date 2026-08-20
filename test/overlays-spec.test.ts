// Validation coverage for the `overlays` block. Rendering is test/overlays-render.test.ts; this file
// is about which specs are ACCEPTED and what the rejections say.
import { describe, it, expect } from "vitest";
import { validateSpec, validateChartData } from "../src/spec/validate";
import { overlayDashed } from "../src/spec/overlays";
import { EXPR_CONSTANTS, EXPR_FUNCTION_NAMES } from "../src/spec/expr";
import type { TidyRow } from "../src/data/index";

// `data` is required by CHART_SPEC_SCHEMA — omitting it fails every case on the wrong error.
const BASE = {
  chartType: "scatter",
  title: "t",
  xAxisType: "numeric",
  data: "data.csv",
  columns: { x: "time", value: "value", series: "series" },
};

function check(overlays: unknown[], patch: Record<string, unknown> = {}) {
  return validateSpec({ ...BASE, ...patch, overlays });
}

/** The first error, for readable assertions. */
const err = (r: { errors: string[] }) => r.errors[0] ?? "";

describe("overlays — accepted forms", () => {
  it("accepts a bare lm fit", () => {
    expect(check([{ method: "lm" }]).valid).toBe(true);
  });

  it("accepts a quadratic with a degree", () => {
    expect(check([{ method: "poly", degree: 2 }]).valid).toBe(true);
  });

  it("accepts a function with named params", () => {
    expect(check([{ fun: "b0 + b1*x", params: { b0: 1, b1: 2 } }]).valid).toBe(true);
  });

  it("accepts a slope and intercept", () => {
    expect(check([{ slope: 1, intercept: 0 }]).valid).toBe(true);
  });

  it("accepts a precomputed column", () => {
    expect(check([{ column: "yhat" }]).valid).toBe(true);
  });

  it("accepts the shared styling and keying fields", () => {
    expect(
      check([
        {
          method: "lm",
          by: "none",
          ci: 0.95,
          domain: "axis",
          label: "Fit",
          legend: true,
          color: "blue",
          style: "solid",
          strokeWidth: 2,
          labelSide: "top",
          labelPosition: "right",
          labelDx: 4,
          labelDy: -2,
        },
      ]).valid,
    ).toBe(true);
  });

  it("accepts several overlays at once", () => {
    expect(check([{ method: "lm" }, { fun: "x" }, { slope: 1, intercept: 0 }]).valid).toBe(true);
  });

  it("accepts a fit on a temporal axis", () => {
    expect(check([{ method: "lm" }], { xAxisType: "temporal", chartType: "line" }).valid).toBe(true);
  });
});

describe("overlays — exactly one kind per entry", () => {
  it("rejects an entry naming no kind", () => {
    const r = check([{ label: "nothing" }]);
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/exactly one of/);
  });

  it("rejects an entry naming two kinds", () => {
    const r = check([{ method: "lm", fun: "x" }]);
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/exactly one of/);
  });

  it("rejects a slope with no intercept", () => {
    const r = check([{ slope: 1 }]);
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/`slope` and `intercept` must be given together/);
  });
});

describe("overlays — field applicability", () => {
  it("rejects degree without poly", () => {
    expect(err(check([{ method: "lm", degree: 2 }]))).toMatch(/`degree` applies to `method: poly`/);
  });

  it("rejects a degree outside 2-5", () => {
    expect(check([{ method: "poly", degree: 1 }]).valid).toBe(false);
    expect(check([{ method: "poly", degree: 6 }]).valid).toBe(false);
  });

  it("rejects params without fun", () => {
    expect(err(check([{ method: "lm", params: { a: 1 } }]))).toMatch(/`params` applies to `fun`/);
  });

  it("rejects ci on anything but a fit", () => {
    expect(err(check([{ fun: "x", ci: 0.95 }]))).toMatch(/`ci` applies to `method`/);
  });

  it("rejects n on anything but a fun", () => {
    expect(err(check([{ column: "yhat", n: 50 }]))).toMatch(/`n` applies to `fun`/);
  });

  it("rejects by on a kind that does not read the data", () => {
    expect(err(check([{ fun: "x", by: "none" }]))).toMatch(/`by` applies to/);
  });

  it("rejects a dangling slope beside another kind, rather than silently ignoring it", () => {
    const r = check([{ method: "lm", slope: 0.5 }]);
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/`slope` applies to `slope`\+`intercept`/);
  });

  it("rejects a dangling intercept beside another kind", () => {
    expect(err(check([{ column: "yhat", intercept: 2 }]))).toMatch(/`intercept` applies to `slope`\+`intercept`/);
  });

  it("rejects legend: true with no label", () => {
    expect(err(check([{ method: "lm", legend: true }]))).toMatch(/needs a `label`/);
  });

  it("rejects loess, which is not implemented", () => {
    expect(check([{ method: "loess" }]).valid).toBe(false);
  });
});

describe("overlays — expression checking at build time", () => {
  it("rejects an expression that does not parse", () => {
    expect(err(check([{ fun: "2 * (x" }]))).toMatch(/does not parse/);
  });

  it("rejects an unknown function", () => {
    expect(err(check([{ fun: "wibble(x)" }]))).toMatch(/wibble/);
  });

  it("rejects a variable that is neither x, a constant, nor a declared param", () => {
    const r = check([{ fun: "b0 + b1*x", params: { b0: 1 } }]);
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/b1/);
  });

  it("accepts pi and e without declaring them", () => {
    expect(check([{ fun: "pi * x + e" }]).valid).toBe(true);
  });
});

describe("overlays — axis restrictions", () => {
  it("rejects overlays on a categorical x-axis", () => {
    const r = check([{ method: "lm" }], { chartType: "line", xAxisType: "categorical" });
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/categorical/);
  });

  it("rejects fun on a temporal axis", () => {
    const r = check([{ fun: "x" }], { chartType: "line", xAxisType: "temporal" });
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/temporal/);
  });

  it("rejects slope+intercept on a temporal axis", () => {
    expect(
      check([{ slope: 1, intercept: 0 }], { chartType: "line", xAxisType: "temporal" }).valid,
    ).toBe(false);
  });

  it("rejects an explicit numeric domain on a temporal axis but allows domain: axis", () => {
    expect(
      check([{ method: "lm", domain: [0, 1] }], { chartType: "line", xAxisType: "temporal" }).valid,
    ).toBe(false);
    expect(
      check([{ method: "lm", domain: "axis" }], { chartType: "line", xAxisType: "temporal" }).valid,
    ).toBe(true);
  });

  it("rejects a backwards or empty numeric domain", () => {
    expect(check([{ fun: "x", domain: [10, 1] }]).valid).toBe(false);
    expect(check([{ fun: "x", domain: [3, 3] }]).valid).toBe(false);
  });
});

describe("overlays — histograms take `fun` only", () => {
  const HIST = { chartType: "histogram", columns: { x: "time", value: "value" } };

  it("accepts fun — the density-curve case", () => {
    expect(check([{ fun: "dnorm(x, 0, 1)" }], HIST).valid).toBe(true);
  });

  it("accepts slope+intercept, which also does not read the rows", () => {
    expect(check([{ slope: 1, intercept: 0 }], HIST).valid).toBe(true);
  });

  it("rejects method, naming the chart type and the alternative", () => {
    const r = check([{ method: "lm" }], HIST);
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/histogram/);
    expect(err(r)).toMatch(/`fun`/);
  });

  it("rejects column", () => {
    const r = check([{ column: "yhat" }], HIST);
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/histogram/);
  });

  it("still accepts method on a non-histogram numeric chart", () => {
    expect(check([{ method: "lm" }]).valid).toBe(true);
  });
});

describe("overlays — color checking", () => {
  it("rejects an unresolvable overlay color, naming the entry", () => {
    const r = check([{ slope: 1, intercept: 0, color: "blu" }]);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toContain("overlays[0]");
    expect(r.errors.join("\n")).toContain('"blu"');
  });
});

describe("overlays — data checks", () => {
  const rows: TidyRow[] = [
    { time: "1", value: "1", series: "A", yhat: "1.1" },
    { time: "2", value: "2", series: "A", yhat: "2.1" },
  ] as unknown as TidyRow[];

  it("accepts a column the data has", () => {
    expect(validateChartData({ ...BASE, overlays: [{ column: "yhat" }] } as never, rows).valid).toBe(true);
  });

  it("rejects a column the data lacks", () => {
    const r = validateChartData({ ...BASE, overlays: [{ column: "fitted" }] } as never, rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/fitted/);
  });

  // The cells have to be numeric-or-empty, exactly like `value` and the confidence_bands
  // lower/upper columns. engine/index.ts reads an overlay column with unary `+` and drops anything
  // non-finite, so a typo does not drop a POINT — it drops the whole vertex and REROUTES the line
  // between its neighbours, byte-identically to the blank-cell case, with nothing reported.
  it("rejects a non-numeric cell in an overlay column, naming the row and the column", () => {
    const bad: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1.1" },
      { time: "2", value: "2", series: "A", yhat: "oops" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...BASE, overlays: [{ column: "yhat" }] } as never, bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/row 3/);
    expect(r.errors.join(" ")).toContain("yhat");
    expect(r.errors.join(" ")).toMatch(/not numeric/);
  });

  it("accepts a BLANK cell in an overlay column — a blank is legitimately absent, not an error", () => {
    const sparse: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1.1" },
      { time: "2", value: "2", series: "A", yhat: "" },
      { time: "3", value: "3", series: "A", yhat: "3.1" },
    ] as unknown as TidyRow[];
    expect(validateChartData({ ...BASE, overlays: [{ column: "yhat" }] } as never, sparse).valid).toBe(
      true,
    );
  });

  it("leaves columns no overlay names alone — a text column beside the data is not an error", () => {
    const withText: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1.1", note: "revised" },
      { time: "2", value: "2", series: "A", yhat: "2.1", note: "" },
    ] as unknown as TidyRow[];
    expect(validateChartData({ ...BASE, overlays: [{ column: "yhat" }] } as never, withText).valid).toBe(
      true,
    );
  });
});

// Second review wave, finding 3a: annotation-legend.ts pushes an overlay's legend row straight
// from the spec, guarding only `kind == null` — a misspelled `facet`, or a `facet` on a spec with
// no small_multiples, would otherwise key a legend row for a line that is never drawn.
describe("overlays — facet validation (3a)", () => {
  const FACETED_BASE = {
    ...BASE,
    columns: { x: "time", value: "value", series: "series", facet: "pane" },
    small_multiples: { columns: 2 },
  };
  const facetedRows: TidyRow[] = [
    { time: "1", value: "1", series: "A", pane: "P1" },
    { time: "2", value: "2", series: "A", pane: "P2" },
  ] as unknown as TidyRow[];

  it("rejects overlays[].facet on a spec with no small_multiples, naming the entry", () => {
    const r = validateChartData(
      { ...BASE, overlays: [{ slope: 1, intercept: 0, facet: "P1" }] } as never,
      [{ time: "1", value: "1", series: "A" }] as unknown as TidyRow[],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/overlays\[0\]\.facet/);
    expect(r.errors.join(" ")).toMatch(/small_multiples/);
  });

  it("rejects overlays[].facet naming a pane the data doesn't have", () => {
    const r = validateChartData(
      { ...FACETED_BASE, overlays: [{ slope: 1, intercept: 0, facet: "Nope" }] } as never,
      facetedRows,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/overlays\[0\]\.facet/);
    expect(r.errors.join(" ")).toContain("Nope");
  });

  it("accepts overlays[].facet naming a real pane", () => {
    const r = validateChartData(
      { ...FACETED_BASE, overlays: [{ slope: 1, intercept: 0, facet: "P1" }] } as never,
      facetedRows,
    );
    expect(r.valid).toBe(true);
  });

  // pane_order is an INCLUSION filter (CONFIG-SPEC.md), so "present in the facet column" is not
  // the same question as "rendered". An overlay scoped to an excluded pane draws zero paths
  // anywhere and STILL keys a legend row — annotation-legend.ts builds that row from the spec
  // alone and guards only `kind == null`, so this validator is the only thing standing between the
  // author and a legend row for a line no reader can find. Verified by probe before the fix:
  // one pane rendered, zero overlay paths, legendItems ["Fitted"].
  it("rejects a facet that pane_order EXCLUDES — the pane renders, so the line never does", () => {
    const r = validateChartData(
      {
        ...FACETED_BASE,
        small_multiples: { columns: 2, pane_order: ["P1"] },
        overlays: [{ slope: 1, intercept: 0, facet: "P2", label: "Fitted", legend: true }],
      } as never,
      facetedRows,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/overlays\[0\]\.facet/);
    expect(r.errors.join(" ")).toContain("pane_order");
    expect(r.errors.join(" ")).toContain("P2");
  });

  it("accepts a facet pane_order INCLUDES", () => {
    const r = validateChartData(
      {
        ...FACETED_BASE,
        small_multiples: { columns: 2, pane_order: ["P2", "P1"] },
        overlays: [{ slope: 1, intercept: 0, facet: "P2" }],
      } as never,
      facetedRows,
    );
    expect(r.errors).toEqual([]);
  });

  it("treats an EMPTY pane_order as no filter, exactly as figure.ts resolves panes", () => {
    const r = validateChartData(
      {
        ...FACETED_BASE,
        small_multiples: { columns: 2, pane_order: [] },
        overlays: [{ slope: 1, intercept: 0, facet: "P2" }],
      } as never,
      facetedRows,
    );
    expect(r.errors).toEqual([]);
  });
});

// Second review wave, finding 3b: engine/overlays.ts's pooled branch concatenates every in-scope
// row's value for a `by: "none"` column overlay and draws ONE polyline, x-sorted, with NO dedupe
// — correct when the column is genuinely one value per x, a silent zig-zag when it varies by
// series.
describe("overlays — pooled `by: \"none\"` column consistency (3b)", () => {
  it('rejects a by:"none" column overlay whose value at one x differs across rows', () => {
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1.1" },
      { time: "1", value: "2", series: "B", yhat: "9.9" },
      { time: "2", value: "3", series: "A", yhat: "2.1" },
      { time: "2", value: "4", series: "B", yhat: "2.1" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...BASE, overlays: [{ column: "yhat", by: "none" }] } as never, rows2);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/overlays\[0\]/);
    expect(r.errors.join(" ")).toContain("yhat");
    expect(r.errors.join(" ")).toContain('"1"'); // the offending x
  });

  // The check compares NUMBERS, not spellings. The renderer converts each cell with unary `+`
  // (engine/index.ts), so "1" and "1.0" at one x are ONE value to it and the figure draws
  // correctly — rejecting it would break an already-published figure on the next re-pin, which is
  // a strictly worse failure than the misdraw this check exists to catch.
  it('accepts values that differ only in SPELLING — "1" and "1.0" are one number', () => {
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1" },
      { time: "1", value: "2", series: "B", yhat: "1.0" },
      { time: "2", value: "3", series: "A", yhat: "2" },
      { time: "2", value: "4", series: "B", yhat: "2.000" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...BASE, overlays: [{ column: "yhat", by: "none" }] } as never, rows2);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("accepts the other equal-but-differently-written forms (exponent, leading zero, plus sign)", () => {
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1000" },
      { time: "1", value: "2", series: "B", yhat: "1e3" },
      { time: "2", value: "3", series: "A", yhat: "0.5" },
      { time: "2", value: "4", series: "B", yhat: "+.50" },
    ] as unknown as TidyRow[];
    expect(
      validateChartData({ ...BASE, overlays: [{ column: "yhat", by: "none" }] } as never, rows2).valid,
    ).toBe(true);
  });

  // One bad cell must read as ONE problem. The numeric-or-empty check owns it; a non-numeric cell
  // is not also a "differing values" disagreement, which would send the author looking for a
  // second, non-existent fault.
  it("reports a non-numeric cell ONCE — as not-numeric, not also as a pooled disagreement", () => {
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1.1" },
      { time: "1", value: "2", series: "B", yhat: "oops" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...BASE, overlays: [{ column: "yhat", by: "none" }] } as never, rows2);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/not numeric/);
  });

  it("accepts a genuinely pooled column — one value per x, replicated across every series' row", () => {
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1.1" },
      { time: "1", value: "2", series: "B", yhat: "1.1" },
      { time: "2", value: "3", series: "A", yhat: "2.1" },
      { time: "2", value: "4", series: "B", yhat: "2.1" },
    ] as unknown as TidyRow[];
    expect(
      validateChartData({ ...BASE, overlays: [{ column: "yhat", by: "none" }] } as never, rows2).valid,
    ).toBe(true);
  });

  // Round 2: the y side of this comparison was made numeric, the x side was left as the raw cell
  // string — so "1" and "1.0" were two buckets and the disagreement between them evaded the guard
  // entirely, while the renderer parses both to _xn === 1 and hands the pooled polyline two
  // vertices at one coordinate. The key is the x the RENDERER positions the row at.
  it('rejects a disagreement whose x cells differ only in SPELLING — "1" and "1.0" are one x', () => {
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1.1" },
      { time: "1.0", value: "2", series: "B", yhat: "9.9" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...BASE, overlays: [{ column: "yhat", by: "none" }] } as never, rows2);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/overlays\[0\]/);
    expect(r.errors[0]).toContain("9.9");
  });

  // The message has to name an x an author can grep for in the CSV, so it quotes one of the raw
  // spellings seen at that position — never the parsed number, which for a temporal axis is an
  // epoch millisecond appearing nowhere in the file.
  it("names a RAW x spelling from the data, not the parsed key", () => {
    const rows2: TidyRow[] = [
      { time: "1.0", value: "1", series: "A", yhat: "1.1" },
      { time: "1", value: "2", series: "B", yhat: "9.9" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...BASE, overlays: [{ column: "yhat", by: "none" }] } as never, rows2);
    const quoted = /time "([^"]+)"/.exec(r.errors[0] ?? "");
    expect(quoted).not.toBeNull();
    expect(["1", "1.0"]).toContain((quoted as RegExpExecArray)[1]);
  });

  // x may be temporal, and the parse must be the renderer's own (spec/parse-time.ts, which
  // engine/x-adapter.ts's parseX calls). A numeric-only key would send `+"2020-01-01"` → NaN for
  // EVERY row, pooling four distinct dates into one bucket and falsely rejecting a figure that
  // draws correctly — the exact failure mode the y-side fix was written to avoid.
  const TEMPORAL = {
    ...BASE,
    chartType: "line",
    xAxisType: "temporal",
    columns: { x: "time", value: "value", series: "series" },
  };

  it("keeps DISTINCT temporal x values in distinct buckets", () => {
    const rows2: TidyRow[] = [
      { time: "2020-01-01", value: "1", series: "A", yhat: "1.1" },
      { time: "2020-01-01", value: "2", series: "B", yhat: "1.1" },
      { time: "2020-02-01", value: "3", series: "A", yhat: "9.9" },
      { time: "2020-02-01", value: "4", series: "B", yhat: "9.9" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...TEMPORAL, overlays: [{ column: "yhat", by: "none" }] } as never, rows2);
    expect(r.errors).toEqual([]);
  });

  it("still rejects a within-x disagreement on a temporal axis", () => {
    const rows2: TidyRow[] = [
      { time: "2020-01-01", value: "1", series: "A", yhat: "1.1" },
      { time: "2020-01-01", value: "2", series: "B", yhat: "9.9" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...TEMPORAL, overlays: [{ column: "yhat", by: "none" }] } as never, rows2);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('"2020-01-01"');
  });

  it("keeps distinct QUARTERLY x values in distinct buckets, and still catches a real one", () => {
    const QUARTERLY = { ...TEMPORAL, xAxisType: "quarterly" };
    const ok: TidyRow[] = [
      { time: "2020Q1", value: "1", series: "A", yhat: "1.1" },
      { time: "2020Q1", value: "2", series: "B", yhat: "1.1" },
      { time: "2020Q2", value: "3", series: "A", yhat: "9.9" },
      { time: "2020Q2", value: "4", series: "B", yhat: "9.9" },
    ] as unknown as TidyRow[];
    expect(
      validateChartData({ ...QUARTERLY, overlays: [{ column: "yhat", by: "none" }] } as never, ok).errors,
    ).toEqual([]);
    const bad: TidyRow[] = [
      { time: "2020Q1", value: "1", series: "A", yhat: "1.1" },
      { time: "2020Q1", value: "2", series: "B", yhat: "9.9" },
    ] as unknown as TidyRow[];
    const r = validateChartData({ ...QUARTERLY, overlays: [{ column: "yhat", by: "none" }] } as never, bad);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('"2020Q1"');
  });

  it('does not flag the same disagreeing data when `by` is left at its default ("series", not pooled)', () => {
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1.1" },
      { time: "1", value: "2", series: "B", yhat: "9.9" },
    ] as unknown as TidyRow[];
    expect(
      validateChartData({ ...BASE, overlays: [{ column: "yhat" }] } as never, rows2).valid,
    ).toBe(true);
  });

  it("on a faceted chart, scopes the check PER FACET — differing values across DIFFERENT facets at the same x is fine", () => {
    const facetedBase = {
      ...BASE,
      columns: { x: "time", value: "value", series: "series", facet: "pane" },
      small_multiples: { columns: 2 },
    };
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", pane: "P1", yhat: "1.1" },
      { time: "1", value: "2", series: "B", pane: "P1", yhat: "1.1" },
      { time: "1", value: "3", series: "A", pane: "P2", yhat: "9.9" },
      { time: "1", value: "4", series: "B", pane: "P2", yhat: "9.9" },
    ] as unknown as TidyRow[];
    expect(
      validateChartData({ ...facetedBase, overlays: [{ column: "yhat", by: "none" }] } as never, rows2)
        .valid,
    ).toBe(true);
  });

  it("still rejects a WITHIN-facet disagreement on a faceted chart", () => {
    const facetedBase = {
      ...BASE,
      columns: { x: "time", value: "value", series: "series", facet: "pane" },
      small_multiples: { columns: 2 },
    };
    const rows2: TidyRow[] = [
      { time: "1", value: "1", series: "A", pane: "P1", yhat: "1.1" },
      { time: "1", value: "2", series: "B", pane: "P1", yhat: "9.9" },
    ] as unknown as TidyRow[];
    const r = validateChartData(
      { ...facetedBase, overlays: [{ column: "yhat", by: "none" }] } as never,
      rows2,
    );
    expect(r.valid).toBe(false);
  });
});

describe("overlayDashed — the per-kind style default, shared with the legend row", () => {
  it("defaults solid for the kinds computed FROM the data", () => {
    expect(overlayDashed({ method: "lm" })).toBe(false);
    expect(overlayDashed({ column: "yhat" })).toBe(false);
  });

  it("defaults dashed for the kinds asserted OVER the data", () => {
    expect(overlayDashed({ fun: "x" })).toBe(true);
    expect(overlayDashed({ slope: 1, intercept: 0 })).toBe(true);
  });

  it("an explicit style wins in both directions", () => {
    expect(overlayDashed({ method: "lm", style: "dashed" })).toBe(true);
    expect(overlayDashed({ fun: "x", style: "solid" })).toBe(false);
  });
});

describe("expr module — pinning the cross-task contract", () => {
  it("EXPR_CONSTANTS is exactly pi and e", () => {
    expect(EXPR_CONSTANTS).toEqual({ pi: Math.PI, e: Math.E });
  });

  it("EXPR_FUNCTION_NAMES is the sorted list of supported function names", () => {
    expect(EXPR_FUNCTION_NAMES).toEqual(
      [
        "abs",
        "ceil",
        "ceiling",
        "cos",
        "dnorm",
        "exp",
        "floor",
        "ln",
        "log",
        "log10",
        "log2",
        "max",
        "min",
        "normalden",
        "round",
        "sin",
        "sqrt",
        "tan",
      ].sort(),
    );
  });
});
