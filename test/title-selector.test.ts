// Pure helpers for the inline title selector (`title_selectors` + `{token}` in the title).
// See src/spec/title.ts. jsdom-mounted / export / validate coverage lives in their own test
// files; this file is the pure-function unit layer.
import { describe, it, expect } from "vitest";
import { parseTitleTokens, resolveTitleText, resolveSelections } from "../src/spec/title";
import type { TitleSelector } from "../src/spec/types";

const DIMENSION: TitleSelector = {
  options: [
    { id: "sector", label: "Sector" },
    { id: "country", label: "Country" },
  ],
  default: "sector",
};

describe("parseTitleTokens", () => {
  it("returns a single text segment when there are no selectors", () => {
    expect(parseTitleTokens("Plain title", undefined)).toEqual([{ kind: "text", text: "Plain title" }]);
    expect(parseTitleTokens("Plain title", {})).toEqual([{ kind: "text", text: "Plain title" }]);
  });

  it("splits a known token out of the title", () => {
    const segs = parseTitleTokens("GDP by {dimension}", { dimension: DIMENSION });
    expect(segs).toEqual([
      { kind: "text", text: "GDP by " },
      { kind: "token", key: "dimension" },
    ]);
  });

  it("handles a token in the middle with text on both sides", () => {
    const segs = parseTitleTokens("Change in {dimension} over time", { dimension: DIMENSION });
    expect(segs).toEqual([
      { kind: "text", text: "Change in " },
      { kind: "token", key: "dimension" },
      { kind: "text", text: " over time" },
    ]);
  });

  it("leaves an unmatched {token} (no corresponding selector key) as literal text", () => {
    const segs = parseTitleTokens("GDP by {region}", { dimension: DIMENSION });
    expect(segs).toEqual([{ kind: "text", text: "GDP by {region}" }]);
  });

  it("mixes a known token and an unknown brace expression", () => {
    const segs = parseTitleTokens("{dimension} vs {region}", { dimension: DIMENSION });
    expect(segs).toEqual([
      { kind: "token", key: "dimension" },
      { kind: "text", text: " vs {region}" },
    ]);
  });
});

describe("resolveSelections", () => {
  it("uses the selector default when no initial selections are given", () => {
    expect(resolveSelections({ title: "x {dimension}", title_selectors: { dimension: DIMENSION } })).toEqual({
      dimension: "sector",
    });
  });

  it("falls back to the first option when there is no default", () => {
    const noDefault: TitleSelector = { options: [{ id: "a" }, { id: "b" }] };
    expect(
      resolveSelections({ title: "x {k}", title_selectors: { k: noDefault } }),
    ).toEqual({ k: "a" });
  });

  it("initial selections win over the default", () => {
    expect(
      resolveSelections(
        { title: "x {dimension}", title_selectors: { dimension: DIMENSION } },
        { dimension: "country" },
      ),
    ).toEqual({ dimension: "country" });
  });

  it("an invalid initial id falls back to the default rather than propagating garbage", () => {
    expect(
      resolveSelections(
        { title: "x {dimension}", title_selectors: { dimension: DIMENSION } },
        { dimension: "bogus" },
      ),
    ).toEqual({ dimension: "sector" });
  });

  it("returns an empty object when the spec has no title_selectors", () => {
    expect(resolveSelections({ title: "Plain" })).toEqual({});
  });
});

describe("resolveTitleText", () => {
  it("returns the raw title unchanged when there are no selectors", () => {
    expect(resolveTitleText({ title: "Plain title" })).toBe("Plain title");
  });

  it("substitutes the active option's label", () => {
    const spec = { title: "GDP by {dimension}", title_selectors: { dimension: DIMENSION } };
    expect(resolveTitleText(spec, { dimension: "country" })).toBe("GDP by Country");
  });

  it("uses the default (sector) when no selections are passed", () => {
    const spec = { title: "GDP by {dimension}", title_selectors: { dimension: DIMENSION } };
    expect(resolveTitleText(spec)).toBe("GDP by Sector");
  });

  it("falls back to the option id when the option has no label", () => {
    const spec = {
      title: "GDP by {k}",
      title_selectors: { k: { options: [{ id: "sector" }], default: "sector" } },
    };
    expect(resolveTitleText(spec)).toBe("GDP by sector");
  });

  it("leaves an unmatched brace expression untouched", () => {
    const spec = { title: "GDP by {region}", title_selectors: { dimension: DIMENSION } };
    expect(resolveTitleText(spec)).toBe("GDP by {region}");
  });
});
