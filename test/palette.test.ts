import { describe, it, expect } from "vitest";
import { tblColorScale, resolveColor, TBL_COLORS, monoScale } from "../src/engine/palette";
import { tokens } from "../src/theme/tokens";

describe("tblColorScale", () => {
  it("returns the categorical base hues in order for n<=7", () => {
    expect(tblColorScale(3)).toEqual(["#0072B2", "#E69F00", "#8856BF"]);
  });

  it("falls back to the light tier of the same hue for slots 8+", () => {
    const scale = tblColorScale(9);
    expect(scale).toHaveLength(9);
    // Slots 1-7 are the base hues; slot 8 = blue-light, slot 9 = amber-light.
    expect(scale.slice(0, 7)).toEqual([
      "#0072B2", "#E69F00", "#8856BF", "#2A8B3A", "#B8302C", "#CC79A7", "#7A5230",
    ]);
    expect(scale[7]).toBe("#58A3E7"); // blue light
    expect(scale[8]).toBe("#FFC63D"); // amber light
  });

  it("derives the light tier from the tonal scale (matches the tracker's old hand list)", () => {
    expect(TBL_COLORS["blue-light"]).toBe("#58A3E7");
    expect(TBL_COLORS["amber-light"]).toBe("#FFC63D");
    expect(TBL_COLORS["violet-light"]).toBe("#BC85F4");
    expect(TBL_COLORS["green-light"]).toBe("#70CD76");
    expect(TBL_COLORS["red-light"]).toBe("#FF7062");
    expect(TBL_COLORS["rose-light"]).toBe("#FFBAE9");
    expect(TBL_COLORS["russet-light"]).toBe("#A77A56");
  });
});

describe("resolveColor", () => {
  it("maps known color names to their hex", () => {
    expect(resolveColor("blue")).toBe("#0072B2");
    expect(resolveColor("amber-light")).toBe("#FFC63D");
    expect(resolveColor("navy")).toBe("#101F5B");
    expect(resolveColor("black")).toBe("#000000");
    expect(resolveColor("grey")).toBe("#6D6D6D");
  });

  it("resolves Style-Guide naming aliases", () => {
    expect(resolveColor("purple")).toBe(resolveColor("violet"));
    expect(resolveColor("yellow")).toBe(resolveColor("amber"));
  });

  it("passes raw hex and unknown values through unchanged", () => {
    expect(resolveColor("#abc123")).toBe("#abc123");
    expect(resolveColor("not-a-color")).toBe("not-a-color");
  });

  it("passes undefined/empty through", () => {
    expect(resolveColor(undefined)).toBeUndefined();
    expect(resolveColor("")).toBe("");
  });
});

describe("monoScale", () => {
  it("returns all 7 tiers darkest-first for n=7, matching tokens.scales.blue", () => {
    const result = monoScale("blue", 7);
    expect(result).toHaveLength(7);
    const s = tokens.scales.blue;
    expect(result).toEqual([s["700"], s["600"], s["500"], s["400"], s["300"], s["200"], s["100"]]);
  });

  it("resolves alias purple→violet and returns the 3 darkest tiers (700,600,500)", () => {
    const result = monoScale("purple", 3);
    const s = tokens.scales.violet;
    expect(result).toEqual([s["700"], s["600"], s["500"]]);
  });

  it("returns just the 700 tier for n=1", () => {
    const result = monoScale("blue", 1);
    expect(result).toEqual([tokens.scales.blue["700"]]);
  });

  it("clamps n>7 to 7 tiers", () => {
    expect(monoScale("red", 10)).toHaveLength(7);
  });

  it("throws for a raw hex string", () => {
    expect(() => monoScale("#123456", 3)).toThrow(/not a known categorical hue/);
  });

  it("throws for an unknown name like navy", () => {
    expect(() => monoScale("navy", 3)).toThrow(/not a known categorical hue/);
  });

  it("throws for n=0, n=-1, and n=NaN", () => {
    expect(() => monoScale("blue", 0)).toThrow(RangeError);
    expect(() => monoScale("blue", -1)).toThrow(RangeError);
    expect(() => monoScale("blue", NaN)).toThrow(RangeError);
  });
});
