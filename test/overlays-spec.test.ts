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

// A pooled (`by: "none"`) `column` overlay concatenates every in-scope row's value into ONE
// polyline, x-sorted, with no dedupe — so a column that genuinely varies by series draws a
// sawtooth. Validation used to try to reject that shape. The attempt was WITHDRAWN in 1.12.0
// rather than patched a fourth time, and the reason is structural rather than a missing condition:
//
// "would the pooled polyline zig-zag" is a question about DRAWN GEOMETRY. What gets drawn is
// decided by six filters that all live in `src/engine`, which `src/spec/*` may not import
// (module-graph invariant, CLAUDE.md). Every version of the check therefore re-derived the scope
// from the raw table, and every version got part of it wrong:
//
//   1. compared raw cell SPELLINGS, so "1" and "1.0" counted as differing values;
//   2. keyed the bucket map on the raw X spelling, so x "1" and "1.0" were two positions and a
//      disagreement between them evaded the guard entirely while the polyline got two vertices
//      at one coordinate;
//   3. ignored `overlays[].domain`, which crops rows to the drawn extent (engine/overlays.ts
//      #columnPoints);
//   4. ignored `series_order`, which is renderPane's ROW FILTER and not merely an ordering
//      (engine/index.ts#assemblePaneResult, `dataInScope`);
//   5. ignored `small_multiples.pane_order`, and blank facet cells, which drop whole panes
//      (engine/figure.ts#renderFigure, `paneValues`);
//   6. ignored that a group with fewer than two real points — or with every row at one x, whose
//      default domain collapses — draws NO line at all.
//
// A false rejection refuses a figure that renders correctly, and because `budget-lab-charts`
// re-renders its entire archive on a repin, a false rejection here breaks already-published
// figures. A sawtooth is the opposite kind of failure: loud, on the screen the author is looking
// at, and reachable only by explicitly opting OUT of the safe default (`by` defaults to
// `"series"`, which is per-series and cannot pool). The guard's failure mode was worse than the
// defect it caught, so `overlays[].by` documents the hazard in CONFIG-SPEC.md instead.
//
// The cases below are the receipts. The first six render correctly and were each rejected by some
// version of the check; the seventh is the sawtooth, now accepted, which is the price paid.
// Re-adding a check here means making all six pass, from `src/spec`, without the engine.
describe('overlays — a pooled `by: "none"` column is NOT checked for consistency', () => {
  const pooled = (patch: Record<string, unknown>, rows: unknown[]) =>
    validateChartData(
      { ...BASE, ...patch, overlays: [{ column: "yhat", by: "none" }] } as never,
      rows as TidyRow[],
    );

  // (1) and (2): the two rounds that were fixed in place. Kept because they are the cheapest
  // statement of what "same value" and "same x" mean, and both were once wrong.
  it("(1) accepts values differing only in SPELLING — the renderer reads them with unary `+`", () => {
    expect(
      pooled({}, [
        { time: "1", value: "1", series: "A", yhat: "1000" },
        { time: "1", value: "2", series: "B", yhat: "1e3" },
        { time: "2", value: "3", series: "A", yhat: "0.5" },
        { time: "2", value: "4", series: "B", yhat: "+.50" },
      ]).errors,
    ).toEqual([]);
  });

  it("(2) accepts x cells differing only in SPELLING — those are one x position", () => {
    expect(
      pooled({}, [
        { time: "1", value: "1", series: "A", yhat: "1.1" },
        { time: "1.0", value: "2", series: "B", yhat: "1.1" },
        { time: "2", value: "3", series: "A", yhat: "2.1" },
        { time: "2", value: "4", series: "B", yhat: "2.1" },
      ]).errors,
    ).toEqual([]);
  });

  // (3) `domain: [2, 3]` crops the drawn line to x in [2, 3]. The x = 1 disagreement is outside the
  // extent the line is drawn over, so it never reaches the polyline. Verified against the render:
  // the emitted path has vertices only at the two cropped x positions.
  it("(3) accepts a disagreement OUTSIDE an explicit `domain`", () => {
    const r = validateChartData(
      { ...BASE, overlays: [{ column: "yhat", by: "none", domain: [2, 3] }] } as never,
      [
        { time: "1", value: "1", series: "A", yhat: "1.1" },
        { time: "1", value: "2", series: "B", yhat: "9.9" },
        { time: "2", value: "3", series: "A", yhat: "2.1" },
        { time: "2", value: "4", series: "B", yhat: "2.1" },
        { time: "3", value: "5", series: "A", yhat: "3.1" },
        { time: "3", value: "6", series: "B", yhat: "3.1" },
      ] as unknown as TidyRow[],
    );
    expect(r.errors).toEqual([]);
  });

  // (4) `series_order` is a filter as well as an order: renderPane pools only the rows of the
  // series it lists, so B's disagreeing value is not in the pooled set at all.
  it("(4) accepts a disagreement confined to a series `series_order` excludes", () => {
    expect(
      pooled({ series_order: ["A"] }, [
        { time: "1", value: "1", series: "A", yhat: "1.1" },
        { time: "1", value: "2", series: "B", yhat: "9.9" },
        { time: "2", value: "3", series: "A", yhat: "2.1" },
        { time: "2", value: "4", series: "B", yhat: "2.1" },
      ]).errors,
    ).toEqual([]);
  });

  // (5) `pane_order` names the panes the figure renders; an excluded pane is not drawn, so a
  // disagreement inside it reaches no polyline. (Blank facet cells drop a pane the same way.)
  it("(5) accepts a disagreement confined to a pane `pane_order` excludes", () => {
    expect(
      pooled(
        {
          columns: { x: "time", value: "value", series: "series", facet: "pane" },
          small_multiples: { columns: 2, pane_order: ["A"] },
        },
        [
          { time: "1", value: "1", series: "A", pane: "A", yhat: "1.1" },
          { time: "2", value: "3", series: "A", pane: "A", yhat: "2.1" },
          { time: "1", value: "1", series: "A", pane: "B", yhat: "5.5" },
          { time: "1", value: "2", series: "B", pane: "B", yhat: "9.9" },
          { time: "2", value: "3", series: "A", pane: "B", yhat: "6.1" },
          { time: "2", value: "4", series: "B", pane: "B", yhat: "6.1" },
        ],
      ).errors,
    ).toEqual([]);
  });

  it("(5b) accepts a disagreement confined to rows with a BLANK facet cell — no pane is drawn for them", () => {
    expect(
      pooled(
        {
          columns: { x: "time", value: "value", series: "series", facet: "pane" },
          small_multiples: { columns: 2 },
        },
        [
          { time: "1", value: "1", series: "A", pane: "", yhat: "1.1" },
          { time: "1", value: "2", series: "B", pane: "", yhat: "9.9" },
          { time: "2", value: "9", series: "A", pane: "", yhat: "7.7" },
          { time: "1", value: "1", series: "A", pane: "A", yhat: "1.1" },
          { time: "2", value: "3", series: "A", pane: "A", yhat: "2.1" },
        ],
      ).errors,
    ).toEqual([]);
  });

  // (6) Every row at ONE x: the default `column` domain is the group's x extent, which collapses,
  // so nothing is drawn — there is no line to zig-zag. Verified against the render: no path.
  it("(6) accepts a disagreement at the only x in the data — the line is not drawn at all", () => {
    expect(
      pooled({}, [
        { time: "1", value: "1", series: "A", yhat: "1.1" },
        { time: "1", value: "2", series: "B", yhat: "9.9" },
      ]).errors,
    ).toEqual([]);
  });

  // THE PRICE. This one really does draw a sawtooth, and validation lets it through. Pinned so the
  // trade-off is visible in the suite rather than implied by an absence, and so anyone re-adding
  // the guard has to change this line deliberately.
  it("(7) ALSO accepts the genuine sawtooth — the trade-off this deletion accepts", () => {
    expect(
      pooled({}, [
        { time: "1", value: "1", series: "A", yhat: "1.1" },
        { time: "1", value: "2", series: "B", yhat: "9.9" },
        { time: "2", value: "3", series: "A", yhat: "2.1" },
        { time: "2", value: "4", series: "B", yhat: "8.8" },
      ]).errors,
    ).toEqual([]);
  });

  // Unchanged and still enforced: a non-numeric cell in the column. This is a check about the
  // TABLE, not about the geometry, which is why it survives — the renderer would drop the vertex
  // and reroute the line through a segment the data never claimed.
  it("still rejects a non-numeric cell in the pooled column", () => {
    const r = pooled({}, [
      { time: "1", value: "1", series: "A", yhat: "1.1" },
      { time: "2", value: "2", series: "B", yhat: "oops" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/not numeric/);
  });
});

// `legend: true` MOVES an overlay's label out of the frame into a legend row, and that row is built
// from the SPEC alone (engine/annotation-legend.ts#buildAnnotationLegendItems, which gets no rows).
// The LINE, by contrast, is built from the data, and `resolveOverlays` drops an entry it cannot
// compute — a `method` fit with fewer points than its degree needs, a `column` with fewer than two
// finite cells. The two disagreed: a one-point `lm` with `legend: true` rendered zero paths and a
// legend row anyway, keying a line that is not on the chart. The row is the half a reader sees.
//
// Fixed HERE rather than in the legend builder because the builder has no rows and so cannot
// implement the rule at all — it could read `pane_order` but could never tell `facet: "Norteast"`
// from `"Northeast"`.
//
// DELIBERATELY GENEROUS, and that direction is the whole design. The check ignores every filter
// that NARROWS what is drawn — `domain`, `series_order`, `pane_order`, `facet`, and the
// distinct-x requirement — and asks only whether the raw table could feed a line under the most
// permissive reading. Those filters can only remove rows, so ignoring them can make this estimate
// too OPTIMISTIC (a phantom row slips through) and never too pessimistic (a drawable line
// refused). That asymmetry is why re-deriving scope is safe here and was not safe for the pooled
// consistency guard above: there, ignoring a filter invented a rejection; here it forgoes one.
describe("overlays — `legend: true` on an entry that can draw no line at all", () => {
  const one = (o: Record<string, unknown>, rows: unknown[], patch: Record<string, unknown> = {}) =>
    validateChartData({ ...BASE, ...patch, overlays: [o] } as never, rows as TidyRow[]);

  it("rejects a `column` entry with fewer than two finite cells in any series", () => {
    const r = one({ column: "yhat", label: "Upstream fit", legend: true }, [
      { time: "1", value: "1", series: "A", yhat: "5" },
      { time: "2", value: "2", series: "A", yhat: "" },
      { time: "3", value: "3", series: "A", yhat: "" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/overlays\[0\]/);
    expect(r.errors[0]).toContain("Upstream fit");
  });

  it("rejects a POOLED `column` entry with fewer than two finite cells in the whole table", () => {
    const r = one({ column: "yhat", by: "none", label: "Pooled fit", legend: true }, [
      { time: "1", value: "1", series: "A", yhat: "5" },
      { time: "2", value: "2", series: "B", yhat: "" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("Pooled fit");
  });

  it("rejects a `method: poly` entry with fewer values than its degree needs", () => {
    // degree 2 ⇒ fitPoly needs 3 finite pairs; two rows can never produce a curve.
    const r = one({ method: "poly", degree: 2, label: "Quadratic", legend: true }, [
      { time: "1", value: "1", series: "A" },
      { time: "2", value: "2", series: "A" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("Quadratic");
  });

  it("rejects an `lm` entry with one usable point", () => {
    const r = one({ method: "lm", label: "Fit", legend: true }, [
      { time: "1", value: "1", series: "A" },
      { time: "2", value: "", series: "A" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("Fit");
  });

  // The row is EARNED by any one series. A `by: "series"` entry where A can be fitted and B cannot
  // draws A's line, and one legend row keys the concept for it — exactly as CONFIG-SPEC's
  // `overlays[].legend` row promises ("ONE row for the concept, not one per series").
  it("accepts a per-series entry where only SOME series can be drawn", () => {
    expect(
      one({ column: "yhat", label: "Upstream fit", legend: true }, [
        { time: "1", value: "1", series: "A", yhat: "1" },
        { time: "2", value: "2", series: "A", yhat: "2" },
        { time: "3", value: "3", series: "B", yhat: "" },
      ]).errors,
    ).toEqual([]);
  });

  it("accepts an entry that draws normally", () => {
    expect(
      one({ method: "lm", label: "Fit", legend: true }, [
        { time: "1", value: "1", series: "A" },
        { time: "2", value: "2", series: "A" },
        { time: "3", value: "3", series: "A" },
      ]).errors,
    ).toEqual([]);
  });

  // No legend row ⇒ nothing to be phantom. The label stays in-frame, and an in-frame label is drawn
  // from the resolved line, so it disappears with it.
  it("does not fire without `legend: true`", () => {
    expect(
      one({ column: "yhat", label: "Upstream fit" }, [
        { time: "1", value: "1", series: "A", yhat: "5" },
        { time: "2", value: "2", series: "A", yhat: "" },
      ]).errors,
    ).toEqual([]);
  });

  it("does not fire on a chart with `legend: false` — there is no legend to key into", () => {
    expect(
      one(
        { column: "yhat", label: "Upstream fit", legend: true },
        [
          { time: "1", value: "1", series: "A", yhat: "5" },
          { time: "2", value: "2", series: "A", yhat: "" },
        ],
        { legend: false },
      ).errors,
    ).toEqual([]);
  });

  it("does not fire on the constructed kinds — `fun` and an abline need no data", () => {
    const rows = [{ time: "1", value: "1", series: "A" }];
    expect(one({ fun: "2*x", label: "Assumed", legend: true }, rows).errors).toEqual([]);
    expect(one({ slope: 1, intercept: 0, label: "45°", legend: true }, rows).errors).toEqual([]);
  });

  // THE GENEROUS DIRECTION, pinned. In each of these the full table has enough values, and only a
  // narrowing filter could take the count below the threshold. The check ignores the filter and
  // ACCEPTS — forgoing a rejection rather than risking a false one.
  it("accepts (rather than guesses) when only `series_order` could starve the entry", () => {
    expect(
      one(
        { column: "yhat", label: "Upstream fit", legend: true },
        [
          { time: "1", value: "1", series: "A", yhat: "1" },
          { time: "2", value: "2", series: "A", yhat: "2" },
          { time: "3", value: "3", series: "B", yhat: "3" },
        ],
        { series_order: ["B"] },
      ).errors,
    ).toEqual([]);
  });

  it("accepts (rather than guesses) when only `domain` could starve the entry", () => {
    expect(
      one({ column: "yhat", label: "Upstream fit", legend: true, domain: [90, 100] }, [
        { time: "1", value: "1", series: "A", yhat: "1" },
        { time: "2", value: "2", series: "A", yhat: "2" },
      ]).errors,
    ).toEqual([]);
  });

  it("accepts a single-x table — an explicit `domain` can still give it a line to draw", () => {
    expect(
      one({ column: "yhat", by: "none", label: "Upstream fit", legend: true, domain: [0, 2] }, [
        { time: "1", value: "1", series: "A", yhat: "1" },
        { time: "1", value: "2", series: "B", yhat: "1" },
      ]).errors,
    ).toEqual([]);
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

// A HORIZONTAL bar/stacked chart puts the category band on screen-y and the values on screen-x.
// The overlay mark writes its values to the `y` channel unconditionally (engine/marks/overlay.ts),
// so on such a chart there is no y position for them — the same "nowhere to land" reason categorical
// x is rejected, one axis over. Reachability was checked before this guard existed: `chartType: bar`
// + `xAxisType: numeric` + `orientation: horizontal` + `overlays: [{ method: "lm" }]` validated, and
// rendered ZERO overlay paths and zero overlay labels (and zero bar rects — see the note in
// validate.ts). Transposing the mark's channels would have drawn a fit over an empty frame.
describe("overlays — orientation restrictions", () => {
  const cols = { x: "time", value: "value", series: "series" };

  it("rejects overlays on a horizontal bar chart", () => {
    const r = check([{ method: "lm" }], {
      chartType: "bar",
      xAxisType: "numeric",
      orientation: "horizontal",
      columns: cols,
    });
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/horizontal/);
  });

  it("rejects overlays on a horizontal stacked chart", () => {
    const r = check([{ column: "yhat" }], {
      chartType: "stacked",
      xAxisType: "numeric",
      orientation: "horizontal",
      columns: cols,
    });
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/horizontal/);
  });

  it("keeps the categorical message when a horizontal bar also has a categorical axis", () => {
    // Both restrictions apply; the axis one is the more fundamental and reports first.
    const r = check([{ method: "lm" }], {
      chartType: "bar",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: cols,
    });
    expect(r.valid).toBe(false);
    expect(err(r)).toMatch(/categorical/);
  });

  it("still accepts overlays on a VERTICAL bar/stacked chart, explicit or defaulted", () => {
    for (const chartType of ["bar", "stacked"]) {
      expect(
        check([{ method: "lm" }], { chartType, xAxisType: "numeric", columns: cols }).valid,
      ).toBe(true);
      expect(
        check([{ method: "lm" }], {
          chartType,
          xAxisType: "numeric",
          orientation: "vertical",
          columns: cols,
        }).valid,
      ).toBe(true);
    }
  });

  it("still accepts overlays where `orientation` is dead config the renderer ignores", () => {
    // line/area/scatter never read `orientation` (only bar/stacked/dumbbell marks do), so these
    // charts draw exactly as they do without it — overlay included. Rejecting them would break
    // figures that render correctly today, which is worse than the misdraw this guard prevents.
    for (const chartType of ["line", "area", "scatter"]) {
      expect(
        check([{ method: "lm" }], {
          chartType,
          xAxisType: "numeric",
          orientation: "horizontal",
          columns: cols,
        }).valid,
      ).toBe(true);
    }
  });
});
