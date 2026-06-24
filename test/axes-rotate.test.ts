// Unit tests for the categorical x-axis label rotation decision (collision avoidance).
import { describe, it, expect } from "vitest";
import { shouldRotateBandLabels, rotatedBandMarginBottom } from "../src/engine/axes";

describe("shouldRotateBandLabels", () => {
  it("does not rotate when labels comfortably fit their slots (wide plot, few short labels)", () => {
    expect(shouldRotateBandLabels(["2019", "2022", "2025"], 660)).toBe(false);
  });

  it("rotates when many labels are crammed into a narrow plot", () => {
    const cats = Array.from({ length: 8 }, (_, i) => `${18 + i * 4}-${21 + i * 4}`);
    expect(shouldRotateBandLabels(cats, 220)).toBe(true);
  });

  it("rotates only once a wide label overlaps its slot (not merely close)", () => {
    // ~80px-wide "Physical care" in 80px slots (240/3) is close but not overlapping → no rotate.
    expect(shouldRotateBandLabels(["Total", "Physical care", "Reading"], 240)).toBe(false);
    // Narrower: the slots shrink below the label width → overlap → rotate.
    expect(shouldRotateBandLabels(["Total", "Physical care", "Reading"], 195)).toBe(true);
  });

  it("never rotates for fewer than two categories or non-positive width", () => {
    expect(shouldRotateBandLabels(["only"], 100)).toBe(false);
    expect(shouldRotateBandLabels(["a", "b"], 0)).toBe(false);
  });

  it("rotated bottom margin grows with label length and is capped", () => {
    const small = rotatedBandMarginBottom(["0-1", "6-12"]);
    const big = rotatedBandMarginBottom(["Activities related to children's education"]);
    expect(small).toBeGreaterThan(22); // larger than the horizontal default
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(74); // capped
  });
});
