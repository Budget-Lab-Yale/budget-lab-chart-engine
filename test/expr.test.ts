// Pure tests for the `overlays[].fun` expression language (src/spec/expr.ts). No DOM.
//
// The precedence cases are the point of this file: the grammar follows R, not JavaScript, so `^` is
// right-associative AND binds tighter than unary minus. Getting either wrong silently draws a
// plausible curve reflected through the x-axis — the kind of error nobody catches by looking.
import { describe, it, expect } from "vitest";
import { parseExpression, evalExpression, exprVariables } from "../src/spec/expr";

/** Parse and evaluate in one step; throws if the source does not parse, so a syntax slip in a test
 *  fails loudly instead of silently comparing NaN. */
function ev(src: string, vars: Record<string, number> = {}): number {
  const r = parseExpression(src);
  if (!r.ok) throw new Error(`did not parse: ${src} — ${r.error}`);
  return evalExpression(r.ast, vars);
}

describe("expr — R precedence", () => {
  it("binds ^ tighter than unary minus, so -2^2 is -4", () => {
    expect(ev("-2^2")).toBe(-4);
  });

  it("makes ^ right-associative, so 2^3^2 is 512", () => {
    expect(ev("2^3^2")).toBe(512);
  });

  it("parses a negative exponent", () => {
    expect(ev("2^-1")).toBe(0.5);
  });

  it("gives * and / precedence over + and -", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("8 - 6 / 2")).toBe(5);
  });

  it("honours parentheses", () => {
    expect(ev("(1 + 2) * 3")).toBe(9);
  });

  it("associates - to the left", () => {
    expect(ev("10 - 3 - 2")).toBe(5);
  });
});

describe("expr — variables and constants", () => {
  it("evaluates x", () => {
    expect(ev("2*x + 1", { x: 3 })).toBe(7);
  });

  it("evaluates named params, the coefficient idiom", () => {
    expect(ev("b0 + b1*x", { x: 100, b0: 673.4, b1: -0.5 })).toBeCloseTo(623.4, 10);
  });

  it("knows pi and e", () => {
    expect(ev("pi")).toBeCloseTo(Math.PI, 12);
    expect(ev("e")).toBeCloseTo(Math.E, 12);
  });

  it("returns NaN for an unbound variable rather than throwing", () => {
    expect(ev("q + 1")).toBeNaN();
  });

  it("reports the variables an expression uses, deduped and sorted", () => {
    const r = parseExpression("b1*x + b0 + b1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(exprVariables(r.ast)).toEqual(["b0", "b1", "x"]);
  });

  it("does not report function names as variables", () => {
    const r = parseExpression("log(x)");
    expect(r.ok).toBe(true);
    if (r.ok) expect(exprVariables(r.ast)).toEqual(["x"]);
  });
});

describe("expr — function table", () => {
  it("takes log as natural, matching both R and Stata", () => {
    expect(ev("log(e)")).toBeCloseTo(1, 12);
  });

  it("takes a second argument to log as the base, matching R", () => {
    expect(ev("log(8, 2)")).toBeCloseTo(3, 12);
  });

  it("accepts ln as the Stata alias for natural log", () => {
    expect(ev("ln(e)")).toBeCloseTo(1, 12);
  });

  it("accepts ceil as the Stata alias for R's ceiling", () => {
    expect(ev("ceiling(1.2)")).toBe(2);
    expect(ev("ceil(1.2)")).toBe(2);
  });

  it("evaluates the standard normal density with R's argument order", () => {
    expect(ev("dnorm(0)")).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 12);
    expect(ev("dnorm(1, 1, 2)")).toBeCloseTo(1 / (2 * Math.sqrt(2 * Math.PI)), 12);
  });

  it("accepts normalden as the Stata alias for dnorm", () => {
    expect(ev("normalden(0)")).toBeCloseTo(ev("dnorm(0)"), 12);
  });

  it("evaluates the remaining functions", () => {
    expect(ev("sqrt(9)")).toBe(3);
    expect(ev("abs(-3)")).toBe(3);
    expect(ev("exp(0)")).toBe(1);
    expect(ev("floor(1.8)")).toBe(1);
    expect(ev("log10(1000)")).toBeCloseTo(3, 12);
    expect(ev("log2(8)")).toBeCloseTo(3, 12);
    expect(ev("round(1.26, 1)")).toBeCloseTo(1.3, 12);
    expect(ev("min(2, 5)")).toBe(2);
    expect(ev("max(2, 5)")).toBe(5);
    expect(ev("sin(0)")).toBe(0);
    expect(ev("cos(0)")).toBe(1);
    expect(ev("tan(0)")).toBe(0);
  });
});

describe("expr — rejection", () => {
  it("rejects an unknown function name at parse time", () => {
    const r = parseExpression("frobnicate(x)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/frobnicate/);
  });

  it("rejects the wrong argument count", () => {
    const r = parseExpression("sqrt(1, 2)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sqrt/);
  });

  it("rejects unbalanced parentheses", () => {
    expect(parseExpression("(1 + 2").ok).toBe(false);
  });

  it("rejects a trailing operator", () => {
    expect(parseExpression("1 +").ok).toBe(false);
  });

  it("rejects an empty expression", () => {
    expect(parseExpression("   ").ok).toBe(false);
  });

  it("rejects a stray character", () => {
    expect(parseExpression("1 @ 2").ok).toBe(false);
  });

  it("rejects trailing junk after a complete expression", () => {
    expect(parseExpression("1 + 2)").ok).toBe(false);
  });
});

describe("expr — non-finite results are values, not errors", () => {
  it("returns NaN for log of a negative", () => {
    expect(ev("log(x)", { x: -1 })).toBeNaN();
  });

  it("returns Infinity for a division by zero", () => {
    expect(ev("1/x", { x: 0 })).toBe(Infinity);
  });
});
