// @vitest-environment jsdom
//
// What a CSS color has to look like to pass validation (T3.2, review 2026-10-15).
//
// The validator decides "paintable" with Plot's own constant-vs-column test, and that test is loose:
// `#` plus 3 to 8 hex digits, and any of thirteen function names followed by ANY parentheses. A
// browser is not. `#12345` and `rgb(foo)` reach the SVG as written, the browser drops the
// declaration, and a filled mark inherits the chart's `currentColor` while a line is not drawn. So
// the hex length and the contents of `rgb()`/`rgba()`/`hsl()`/`hsla()` are checked against CSS
// syntax. Everything a browser paints must still pass — `rgb(0 114 178)` included — which is what
// the "still passes" lists pin.
import { describe, it, expect } from "vitest";
import { validateSpec } from "../src/spec/validate";
import { isColorRef } from "../src/spec/color-ref";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BAR = { chartType: "bar", title: "t", xAxisType: "categorical", data: "d.csv" } as unknown as ChartSpec;
const ROWS = [{ time: "A", value: "6" }, { time: "B", value: "3" }] as unknown as TidyRow[];
const errorsFor = (c: string): string[] => validateSpec({ ...BAR, bar_color: c }).errors;

/** jsdom's CSS parser, standing in for a browser's: "" when the declaration is dropped. */
const cssParses = (c: string): boolean => {
  const el = document.createElement("div");
  el.style.color = c;
  return el.style.color !== "";
};

describe("hex: 3, 4, 6 or 8 digits", () => {
  it("rejects 5 and 7 digits, naming the field and the value", () => {
    for (const c of ["#12345", "#1234567"]) {
      const errs = errorsFor(c);
      expect(errs.length, c).toBe(1);
      expect(errs[0], c).toContain(`bar_color: ${JSON.stringify(c)}`);
      // The browser drops it — the reason it is rejected, measured rather than asserted.
      expect(cssParses(c), c).toBe(false);
    }
  });

  it("still passes 3, 4, 6 and 8 digits, in any case", () => {
    for (const c of ["#abc", "#ABCD", "#1A1A2E", "#1a1a2e80", " #1A1A2E "]) {
      expect(errorsFor(c), c).toEqual([]);
    }
  });
});

describe("rgb() / rgba() / hsl() / hsla(): contents checked against CSS syntax", () => {
  // Each of these a browser drops, so the mark would be painted the chart's text colour or not at all.
  const BROKEN = [
    "rgb(foo)",
    "rgb(foo, bar)",
    "rgb()",
    "rgb(0, 114)",
    "rgb(0, 114, 178, 0.5, 1)",
    "rgb(0, 50%, 178)", // legacy commas cannot mix numbers and percentages
    "rgb(0 114, 178)", // nor mix the comma and space forms
    "rgb(0, 114, 178 / 0.5)",
    "rgb(none, 0, 0)", // `none` is space-form only
    "rgba(0 114 178 0.5)", // the alpha needs its slash
    "rgb(0 114 178 /)",
    "rgb(1px 2px 3px)",
    "hsl(200, 50, 40)", // legacy hsl takes percentages for saturation and lightness
    "hsl(200, 50%)",
    "hsl(200deg 50% 40% 0.5)",
    "hsla(foo)",
  ];
  // Valid CSS Color 4, every one painted by a browser — so validation must keep passing them.
  const VALID = [
    "rgb(0,114,178)",
    "rgb( 0 , 114 , 178 )",
    "rgba(0,114,178,0.5)",
    "rgba(0, 114, 178, 50%)",
    "rgb(0,114,178,0.5)",
    "rgba(0,114,178)",
    "rgb(0%, 45%, 70%)",
    "rgb(0.5, 114.2, 178)",
    "rgb(-10, 300, 1e2)",
    "rgb(0 114 178)",
    "rgb(0 114 178 / 0.5)",
    "rgb(0 114 178/50%)",
    "rgb(0% 114 70%)",
    "rgb(none 114 178)",
    "rgb(0 114 178 / none)",
    "RGB(0, 114, 178)",
    "hsl(200,50%,40%)",
    "hsla(200, 50%, 40%, 0.4)",
    "hsl(200deg, 50%, 40%)",
    "hsl(0.5turn, 50%, 40%)",
    "hsl(200 50% 40%)",
    "hsl(200 50 40)",
    "hsl(3.4rad 50% 40% / .5)",
    "hsl(none 50% 40%)",
    "rgb(0 /* a comment */ 114 178)",
  ];

  it("rejects contents a browser drops, naming the field and the value", () => {
    for (const c of BROKEN) {
      const errs = errorsFor(c);
      expect(errs.length, c).toBe(1);
      expect(errs[0], c).toContain(`bar_color: ${JSON.stringify(c)}`);
    }
  });

  it("still passes every valid form, comma- or space-separated", () => {
    for (const c of VALID) expect(errorsFor(c), c).toEqual([]);
  });

  it("agrees with a CSS parser on both lists", () => {
    // jsdom's parser lags the spec on the space form and `none`, so only the comma forms and the
    // broken list are held to it.
    for (const c of BROKEN) expect(cssParses(c), c).toBe(false);
    for (const c of VALID.filter((v) => v.includes(",") && !/turn|rad|e2/.test(v))) {
      expect(cssParses(c), c).toBe(true);
    }
  });

  it("does not check a nested function or a relative color inside them", () => {
    for (const c of ["rgb(var(--r), 0, 0)", "rgb(calc(255 / 2) 0 0)", "rgb(from blue r g b / 50%)", "hsl(from red h s l)"]) {
      expect(isColorRef(c), c).toBe(true);
    }
  });

  it("leaves the other functions' contents unchecked", () => {
    for (const fn of ["hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix", "var", "url"]) {
      expect(isColorRef(`${fn}(anything at all)`), fn).toBe(true);
    }
  });

  it("a valid space form paints the bars with that string", () => {
    const svg = renderChart({ ...BAR, bar_color: "rgb(0 114 178)" }, ROWS, { width: 600, height: 300, document }).svg;
    expect(svg.querySelector('g[aria-label="bar"]')!.getAttribute("fill")).toBe("rgb(0 114 178)");
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(2);
  });
});
