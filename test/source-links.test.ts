// @vitest-environment jsdom
//
// Inline links in note/source text: `[text](url)`.
//
// The governing constraint is the byte-identical invariant. Turning a parser on over a field that
// has always been literal text can only be safe if a string WITHOUT a complete, allowed-scheme link
// comes back exactly as it went in — which is the rule `table/richtext.ts` already adopted for its
// math markers, and the reason there is no backslash escape here (`\[` is display-math syntax in
// table text, so an escape would have collided with it AND re-interpreted existing strings).
//
// Security follows from the same rule rather than from a second check: a link is only ever FORMED
// for an allowlisted scheme, so there is no disallowed-scheme anchor to defend against later.
import { describe, it, expect } from "vitest";
import { parseInlineLinks, isAllowedHref } from "../src/spec/rich-text";
import { wrapRuns, wrapText } from "../src/embed/figure-chrome";

/** For a string with NO link, the runs must concatenate back to it exactly — that is the
 *  byte-identical guarantee. (With a link the runs carry the DISPLAY text, so the source form is
 *  deliberately not recoverable.) */
const roundTrips = (s: string): boolean => parseInlineLinks(s).map((r) => r.text).join("") === s;

describe("parseInlineLinks", () => {
  it("forms a link from a complete, allowed-scheme construct", () => {
    expect(parseInlineLinks("BLS, [CES](https://www.bls.gov/ces/).")).toEqual([
      { text: "BLS, " },
      { text: "CES", href: "https://www.bls.gov/ces/" },
      { text: "." },
    ]);
  });

  it("returns exactly one verbatim run when there is no link (the fast-path trigger)", () => {
    const s = "U.S. Bureau of Labor Statistics, Current Employment Statistics.";
    expect(parseInlineLinks(s)).toEqual([{ text: s }]);
  });

  it("yields a single run for a whole-string link, not an empty one either side", () => {
    expect(parseInlineLinks("[CES](https://x.org)")).toEqual([
      { text: "CES", href: "https://x.org" },
    ]);
  });

  it("introduces no whitespace at run boundaries", () => {
    const s = "A[x](https://y.org)B";
    expect(parseInlineLinks(s)).toEqual([
      { text: "A" }, { text: "x", href: "https://y.org" }, { text: "B" },
    ]);
  });

  it("leaves backslash-bracket alone — there is no escape, so table math syntax is untouched", () => {
    for (const s of ["\\[x^2\\]", "\\(\\theta\\)", "$$a$$", "\\$5"]) {
      expect(parseInlineLinks(s)).toEqual([{ text: s }]);
    }
  });

  it("treats every malformed construct as literal text", () => {
    for (const s of ["[a](", "](x)", "[a]", "[a] (https://x.org)", "[](https://x.org)", "[["]) {
      expect(parseInlineLinks(s)).toEqual([{ text: s }]);
      expect(roundTrips(s)).toBe(true);
    }
  });

  it("forms no link for a scheme outside the allowlist, and does not error", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "relative/path", "ftp://h/x"]) {
      const s = `see [here](${url})`;
      expect(parseInlineLinks(s)).toEqual([{ text: s }]);
    }
  });

  it("accepts http, https and mailto, case-insensitively", () => {
    expect(isAllowedHref("http://x.org")).toBe(true);
    expect(isAllowedHref("HTTPS://x.org")).toBe(true);
    expect(isAllowedHref("mailto:a@b.org")).toBe(true);
    expect(isAllowedHref("JavaScript:alert(1)")).toBe(false);
  });

  it("requires the slashes on http(s), which new URL would otherwise invent", () => {
    // `new URL("http:example.com")` succeeds and normalizes to `http://example.com/`, so a bare
    // `http:` prefix would form a link CONFIG-SPEC does not promise and the author did not write.
    for (const url of ["http:example.com", "https:/example.com", "https:example.com"]) {
      expect(isAllowedHref(url)).toBe(false);
      expect(parseInlineLinks(`[x](${url})`)).toEqual([{ text: `[x](${url})` }]);
    }
  });

  it("closes the URL on the first UNBALANCED paren", () => {
    expect(parseInlineLinks("[w](https://e.org/A_(b))!")).toEqual([
      { text: "w", href: "https://e.org/A_(b)" },
      { text: "!" },
    ]);
  });

  it("parses across a newline, which is how table notes[] arrive once joined", () => {
    const runs = parseInlineLinks("one\n[two](https://x.org)");
    expect(runs).toHaveLength(2);
    expect(runs[1]).toEqual({ text: "two", href: "https://x.org" });
  });



  it("refuses a URL longer than the scan bound, rather than walking the whole string", () => {
    const huge = `[x](https://e.org/${"a".repeat(3000)})`;
    expect(parseInlineLinks(huge)).toEqual([{ text: huge }]);
    // Just inside the bound still links, so the cap is a cap and not an off-by-everything.
    const ok = `[x](https://e.org/${"a".repeat(1000)})`;
    expect(parseInlineLinks(ok)[0]!.href).toContain("e.org");
  });




  it("loses nothing when it gives up on finding a closing bracket", () => {
    // The early exit fires when no `]` remains. It must append the WHOLE untouched tail: any
    // construct opening later would still need a `]` after it, so there is nothing left to find —
    // but a mistake here silently truncates a source line rather than failing loudly.
    for (const s of ["a[b[c", "[", "text [ more [ text", "trailing["]) {
      expect(parseInlineLinks(s)).toEqual([{ text: s }]);
    }
  });

  it("still finds a link that appears BEFORE the unmatched bracket", () => {
    const s = "see [CES](https://www.bls.gov/ces/) and [more";
    expect(parseInlineLinks(s)).toEqual([
      { text: "see " },
      { text: "CES", href: "https://www.bls.gov/ces/" },
      { text: " and [more" },
    ]);
  });

  it("never emits an empty run", () => {
    for (const s of ["", "[a](https://x.org)", "a[b](https://x.org)c", "[a](bad)"]) {
      expect(parseInlineLinks(s).some((r) => r.text === "")).toBe(false);
    }
  });
});

// A run boundary is not a word boundary — the failure this guards is a space appearing between a
// link and the punctuation that follows it.
describe("wrapRuns", () => {
  const FONT = "400 11px sans-serif";
  const visible = (lines: ReturnType<typeof wrapRuns>): string[] =>
    lines.map((l) => l.map((r) => r.text).join(""));

  it("keeps a link and its trailing punctuation in one word", () => {
    const lines = wrapRuns(parseInlineLinks("BLS, [CES](https://x.org)."), FONT, 9999);
    expect(visible(lines)).toEqual(["BLS, CES."]);
  });

  it("introduces no space where runs abut on either side", () => {
    expect(visible(wrapRuns(parseInlineLinks("A[x](https://y.org)B"), FONT, 9999))).toEqual(["AxB"]);
  });

  it("collapses runs of whitespace exactly as wrapText does", () => {
    const s = "a   b\nc";
    expect(visible(wrapRuns(parseInlineLinks(s), FONT, 9999))).toEqual(wrapText(s, FONT, 9999));
  });

  it("drops leading and trailing whitespace like wrapText", () => {
    const s = "  padded  ";
    expect(visible(wrapRuns(parseInlineLinks(s), FONT, 9999))).toEqual(wrapText(s, FONT, 9999));
  });

  it("wraps a link-free string to exactly the lines wrapText produces", () => {
    const s = "U.S. Bureau of Labor Statistics, Current Employment Statistics, seasonally adjusted.";
    for (const w of [60, 120, 240]) {
      expect(visible(wrapRuns(parseInlineLinks(s), FONT, w))).toEqual(wrapText(s, FONT, w));
    }
  });

  it("carries the href onto every segment of a link split across lines", () => {
    const s = "[one two three four](https://x.org)";
    const lines = wrapRuns(parseInlineLinks(s), FONT, 30);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.flat().every((r) => r.href === "https://x.org")).toBe(true);
  });
});

// Complexity. Each shape below defeated an earlier fix to this parser, so each is pinned.
//
// The assertion is an ABSOLUTE bound at a large n, not a growth ratio. A ratio looks more rigorous
// and is not: measured in isolation these shapes double cleanly (~2.1x), but inside a full test run
// GC and JIT noise pushed a genuinely linear parser to 3.1-3.4x, which is indistinguishable from
// quadratic at any threshold worth setting. The absolute gap, by contrast, is not close — at
// n = 80000 the linear parser takes single-digit milliseconds, while any of the quadratic versions
// this replaced would do ~10^9 character-steps. A one-second bound cannot be reached by the former
// or met by the latter, so it is a real regression gate rather than a knife edge.
describe("parseInlineLinks complexity", () => {
  const N = 80000;

  const SHAPES: Array<[string, string]> = [
    ["openers sharing one close, rejected on scheme",
      "[".repeat(N) + "x](javascript:" + "a".repeat(N) + ")"],
    ["openers sharing one close, allowed scheme rejected LATER on a forbidden char",
      "[".repeat(N) + "x](https://" + "a".repeat(N) + " bad)"],
    ["openers sharing one close, no closing paren at all",
      "[".repeat(N) + "x](https://" + "a".repeat(N)],
    ["many distinct closes whose paren never closes",
      "x](https://a".repeat(N) + ")"],
    ["nested unbalanced parens in the URL tail",
      "[".repeat(N) + "x](https://a" + "(".repeat(100) + ")".repeat(50) + "a".repeat(N)],
    // Sized larger than the rest on purpose: this shape's quadratic is a raw `indexOf` scan over a
    // single repeated character, which V8 runs fast enough that the pre-fix parser cleared the
    // bound at 160k. Verified to blow it at this size.
    ["openers with NO closing bracket anywhere", "[".repeat(N * 8)],
    ["plain text with no construct at all", "a".repeat(N * 2)],
  ];

  for (const [name, input] of SHAPES) {
    it(`parses in bounded time: ${name}`, () => {
      const t0 = performance.now();
      const runs = parseInlineLinks(input);
      const ms = performance.now() - t0;
      expect(runs.length).toBeGreaterThan(0);
      expect(ms).toBeLessThan(1000);
    });
  }

  /** A link whose URL is exactly `len` characters. */
  const linkOfUrlLength = (len: number): string => {
    const head = "https://e.org/";
    return `[x](${head}${"a".repeat(len - head.length)})`;
  };

  it("accepts a URL of exactly the documented maximum, and refuses one character more", () => {
    // The boundary itself, because CONFIG-SPEC promises "longer than 2048" is refused — so 2048
    // must LINK. An exclusive loop bound made the closing paren of a 2048-char URL unreachable.
    expect(parseInlineLinks(linkOfUrlLength(2047))[0]!.href).toHaveLength(2047);
    expect(parseInlineLinks(linkOfUrlLength(2048))[0]!.href).toHaveLength(2048);
    const over = linkOfUrlLength(2049);
    expect(parseInlineLinks(over)).toEqual([{ text: over }]);
  });

  it("refuses an over-long URL outright rather than truncating it", () => {
    // Refusing is the safe failure; a truncated href would point somewhere the author never wrote.
    const huge = `[x](https://e.org/${"a".repeat(3000)})`;
    const runs = parseInlineLinks(huge);
    expect(runs).toEqual([{ text: huge }]);
    expect(runs.some((r) => r.href)).toBe(false);
  });
});
