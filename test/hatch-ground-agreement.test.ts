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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isHatchGroundable, isColorRef, isReadableColor } from "../src/spec/color-ref";
import { d3 } from "../src/engine/vendor";
import { resolveHatch } from "../src/engine/hatch";
import { resolveColor } from "../src/engine/palette";

const VALUES = [
  // palette names and tiers
  "blue", "amber", "violet-700", "sky", "navy", "grey", "black",
  // hex, in every length Plot accepts
  "#1A1A2E", "#fff", "#ffffffcc",
  // function forms d3 parses, and ones it does not
  "rgb(0,114,178)", "rgb(0 114 178)", "rgba(0,114,178,0.5)", "hsl(200 50% 40%)", "hsla(200,50%,40%,0.4)",
  "rgb(0.5,114,178)", "rgb(0%,45%,70%)", "hsl(200deg,50%,40%)", "rgb(0 114 178 / 0.5)", "#12345", "#1234567", "rgb(foo, bar)",
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

// ---------------------------------------------------------------------------------------------
// The validator's parse rule IS d3-color's (T3.2). `src/spec` may not import the vendored d3 (the
// module graph, and a 46 KB spec entry that would grow to ~700 KB), so `isReadableColor` is a
// transcription of d3-color's `color()` grammar. This holds the transcription to the real parser,
// string by string, over every form the grammar distinguishes — so the two cannot drift apart, and
// a d3 upgrade that changes the grammar fails here first.
// ---------------------------------------------------------------------------------------------
describe("isReadableColor is d3.color's parser, transcribed", () => {
  /** d3's named-colour table, read out of the vendored bundle rather than restated. */
  const D3_NAMES: string[] = (() => {
    const src = readFileSync(fileURLToPath(new URL("../src/engine/vendor/d3-7.9.0.esm.min.js", import.meta.url)), "utf8");
    const table = /\{aliceblue:\d+(?:,[a-z]+:\d+)*\}/.exec(src);
    if (!table) throw new Error("d3's named-colour table not found in the vendored bundle");
    return table[0].slice(1, -1).split(",").map((pair) => pair.split(":")[0] as string);
  })();

  /** A deterministic spread over the function grammar: names x argument counts x separators x tokens. */
  const FUNCTION_CORPUS: string[] = (() => {
    const names = ["rgb", "rgba", "hsl", "hsla", "RGB", "hwb", "oklch"];
    const tokens = ["0", "114", "255", "0.5", ".5", "-1", "+2", "50%", "0.5%", "+5%", "1e2", "1E-1%", "200deg", "none", "foo", "", " 7 "];
    const seps = [",", ", ", " ", " , ", " / "];
    const out: string[] = [];
    let seed = 12345;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 4000; i++) {
      const count = 2 + next(4);
      const sep = seps[next(seps.length)] as string;
      const args = Array.from({ length: count }, () => tokens[next(tokens.length)] as string);
      out.push(`${names[next(names.length)]}(${args.join(sep)})`);
    }
    // A structured sweep, so the readable side is as well covered as the unreadable one: every
    // function x arity x separator x channel type, where the random draw above is mostly unreadable.
    const channels = [["0", "114", "178"], ["0%", "45%", "70%"], ["0.5", "1", "2"], ["0", "50%", "0"], ["200", "50%", "40%"], ["200deg", "50%", "40%"], ["-1", "+2", "1e2"]];
    for (const name of ["rgb", "rgba", "hsl", "hsla"]) {
      for (const sep of [",", " , ", " "]) {
        for (const ch of channels) {
          for (const alpha of [null, "0.5", "50%", ".5"]) out.push(`${name}(${[...ch, ...(alpha ? [alpha] : [])].join(sep)})`);
        }
      }
    }
    // The shapes that matter most, spelled out rather than left to the draw.
    out.push("rgb(0,114,178)", "rgb( 0 , 114 , 178 )", "rgba(0,114,178,0.5)", "rgb(0%,45%,70%)", "rgba(0%,45%,70%,50%)",
      "rgb(0.5,1,2)", "rgb(0,50%,0)", "rgb(0 114 178)", "hsl(200,50%,40%)", "hsl(200.5,50%,40%)", "hsla(200,50%,40%,0.4)",
      "hsl(200deg,50%,40%)", "hsl(200,50,40)", " rgb(0,114,178) ", "rgb(0,114,178", "rgb(1e2,0,0)");
    return out;
  })();

  const HEX_CORPUS = Array.from({ length: 10 }, (_, n) => "#" + "a1".repeat(5).slice(0, n))
    .concat(["#ABC", "#ggg", "#12345g", "abc", "##abc"]);

  const NAME_CORPUS = [...D3_NAMES, "none", "currentcolor", "currentColor", "transparent", "SteelBlue", " navy ", "blu", "constructor", "toString", ""];

  for (const [label, corpus] of [["hex", HEX_CORPUS], ["named", NAME_CORPUS], ["function", FUNCTION_CORPUS]] as const) {
    it(`agrees with d3.color on every ${label} case`, () => {
      const disagree = corpus.filter((v) => isReadableColor(v) !== (d3.color(v) != null));
      expect(disagree).toEqual([]);
    });
  }

  it("the function corpus exercises both answers", () => {
    const readable = FUNCTION_CORPUS.filter((v) => d3.color(v) != null).length;
    expect(readable).toBeGreaterThan(20);
    expect(FUNCTION_CORPUS.length - readable).toBeGreaterThan(50);
  });
});
