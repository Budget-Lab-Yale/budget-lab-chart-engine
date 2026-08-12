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

describe("tonal tier names", () => {
  const TIERS = ["50", "100", "200", "300", "400", "500", "600", "700"];
  const scales = tokens.scales as Record<string, Record<string, string>>;

  it("resolves every tier of every hue", () => {
    for (const [family, scale] of Object.entries(scales)) {
      for (const tier of TIERS) {
        expect(resolveColor(`${family}-${tier}`), `${family}-${tier}`).toBe(scale[tier]);
      }
    }
  });

  it("resolves the Style-Guide aliases' tiers too", () => {
    expect(resolveColor("purple-600")).toBe(scales.violet!["600"]);
    expect(resolveColor("yellow-100")).toBe(scales.amber!["100"]);
    expect(resolveColor("pink-300")).toBe(scales.rose!["300"]);
    expect(resolveColor("brown-500")).toBe(scales.russet!["500"]);
  });

  it("resolves `sky`, the brand blue that had no name", () => {
    expect(resolveColor("sky")).toBe(tokens.brand.sky);
  });

  it("leaves the existing names exactly as they were", () => {
    expect(resolveColor("blue")).toBe(tokens.categorical[0]!.base);
    expect(resolveColor("blue-light")).toBe(tokens.categorical[0]!.light);
    expect(resolveColor("navy")).toBe(tokens.brand.navy);
    expect(resolveColor("black")).toBe(tokens.structural.mark_black);
    expect(resolveColor("grey")).toBe(tokens.structural.text_muted);
    expect(resolveColor("gray")).toBe(tokens.structural.text_muted);
  });

  it("still passes a non-tier through unchanged, so a raw hex keeps working", () => {
    // 250 is not a tier, and 'teal' is not a hue — both must fall through, not resolve to something.
    expect(resolveColor("blue-250")).toBe("blue-250");
    expect(resolveColor("teal-200")).toBe("teal-200");
    expect(resolveColor("#1A1A2E")).toBe("#1A1A2E");
  });
});
