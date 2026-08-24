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

  it("stays linear on bracket-heavy text", () => {
    // `[[[[…]` used to re-scan for the same `]` from every opener — quadratic, on a field with no
    // length limit, run during both live render and export.
    const pathological = "[".repeat(20000) + "]";
    const t0 = Date.now();
    expect(parseInlineLinks(pathological)).toEqual([{ text: pathological }]);
    expect(Date.now() - t0).toBeLessThan(1000);
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
