// The validator's answer about a hatch ground must be the RENDERER's answer.
//
// They are different code with different jobs: `isColorRef` mirrors Plot's `isColor`, which decides
// whether a string is painted or read as a column name, and it admits `oklch(…)`, `lab(…)`,
// `color-mix(…)`, `currentColor` and `none`. Deriving a hatch BAND means parsing the ground to walk its
// tonal ramp, which is d3's job, and d3-color returns null for every one of those. So a spec pairing
// `series_patterns` with a modern-CSS colour validated clean and threw at render — the same
// validate-says-yes/render-says-no gap that `colorRefError` exists to close, one field over.
//
// This asserts the two agree per value rather than restating either list, so adding a syntax to Plot's
// table (or upgrading d3) cannot quietly reopen the gap.
import { describe, it, expect } from "vitest";
import { isHatchGroundable, isColorRef } from "../src/spec/color-ref";
import { resolveHatch } from "../src/engine/hatch";
import { resolveColor } from "../src/engine/palette";

const VALUES = [
  // palette names and tiers
  "blue", "amber", "violet-700", "sky", "navy", "grey", "black",
  // hex, in every length Plot accepts
  "#1A1A2E", "#fff", "#ffffffcc",
  // function forms d3 parses, and ones it does not
  "rgb(0,114,178)", "rgb(0 114 178)", "rgba(0,114,178,0.5)", "hsl(200 50% 40%)", "hsla(200,50%,40%,0.4)",
  "oklch(0.7 0.1 200)", "oklab(0.7 0.1 0.1)", "lab(50% 20 -30)", "lch(50% 30 200)", "hwb(200 30% 20%)",
  "color-mix(in srgb, blue 50%, white)", "color(display-p3 0.5 0.5 0.5)", "var(--x)", "url(#p)",
  // named colours, including the two that name no colour until something supplies one
  "steelblue", "rebeccapurple", "yellowgreen", "transparent", "currentColor", "none",
];

describe("a hatch ground the validator admits is one the renderer can read", () => {
  for (const value of VALUES) {
    it(`agrees on ${JSON.stringify(value)}`, () => {
      // Scoped to what Plot will paint: anything else is refused by `colorRefError` first, for the
      // better reason that its marks would be dropped. `yellowgreen` is the case — d3 reads it, Plot's
      // table omits it.
      if (!isColorRef(value)) return;
      // Through the real pipeline: the engine resolves a palette NAME to a hex before grounding, so
      // asking `resolveHatch` about the raw name would be asking the wrong question.
      let renders = true;
      try {
        resolveHatch("/", resolveColor(value) ?? value);
      } catch {
        renders = false;
      }
      expect(
        isHatchGroundable(value),
        renders
          ? `${value}: the renderer grounds a hatch over it, so the validator must admit it`
          : `${value}: the renderer THROWS on it, so the validator must refuse it before load`,
      ).toBe(renders);
    });
  }
});
