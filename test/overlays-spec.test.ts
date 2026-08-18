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
