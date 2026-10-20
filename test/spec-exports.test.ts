// The `./spec` subpath exports the inline-link parser so a consumer can link exactly what the
// engine links. budget-lab-charts uses it for the static (no-JS) fallback on every chart page; a
// second copy of the rule there could disagree with the chart about what is a link.
import { describe, it, expect } from "vitest";
import * as spec from "../src/spec";
import { parseInlineLinks, isAllowedHref } from "../src/spec/rich-text";

describe("spec subpath exports", () => {
  it("re-exports the rich-text link parser itself, not a copy", () => {
    expect(spec.parseInlineLinks).toBe(parseInlineLinks);
    expect(spec.isAllowedHref).toBe(isAllowedHref);
  });

  it("parses a source line through the public export", () => {
    expect(spec.parseInlineLinks("See [BLS](https://www.bls.gov/ces/).")).toEqual([
      { text: "See " },
      { text: "BLS", href: "https://www.bls.gov/ces/" },
      { text: "." },
    ]);
  });
});
