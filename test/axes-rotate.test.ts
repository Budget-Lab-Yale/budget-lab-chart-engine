// Unit tests for the categorical x-axis label layout decision (collision avoidance):
// single line → wrap multi-word labels to two lines → rotate 45°.
import { describe, it, expect } from "vitest";
import { bandLabelMode, bandLabelMarginBottom, wrapBandLabel } from "../src/engine/axes";

describe("bandLabelMode", () => {
  it("stays single-line when labels comfortably fit (wide plot, few short labels)", () => {
    expect(bandLabelMode(["2019", "2022", "2025"], 660)).toBe("single");
  });

  it("does not change until labels actually overlap their slot (not merely close)", () => {
    // ~80px-wide "Physical care" in 80px slots (240/3) is close but not overlapping.
    expect(bandLabelMode(["Total", "Physical care", "Reading"], 240)).toBe("single");
  });

  it("wraps multi-word labels to two lines before rotating", () => {
    // Narrower: "Physical care" no longer fits one line, but its wrapped width ("Physical")
    // still fits → wrap, not rotate.
    expect(bandLabelMode(["Total", "Physical care", "Reading"], 195)).toBe("wrap");
  });

  it("rotates when even single-word / wrapped labels overlap (hyphens do not break)", () => {
    // 8 hyphenated age bins crammed into a narrow plot: no spaces to wrap on → rotate.
    const bins = Array.from({ length: 8 }, (_, i) => `${18 + i * 4}-${21 + i * 4}`);
    expect(bandLabelMode(bins, 220)).toBe("rotate");
  });

  it("never changes for fewer than two categories or non-positive width", () => {
    expect(bandLabelMode(["only"], 100)).toBe("single");
    expect(bandLabelMode(["a", "b"], 0)).toBe("single");
  });
});

describe("wrapBandLabel", () => {
  it("breaks a multi-word label at the balanced split", () => {
    expect(wrapBandLabel("Physical care")).toBe("Physical\ncare");
  });

  it("leaves single-word and hyphenated labels unchanged", () => {
    expect(wrapBandLabel("Reading")).toBe("Reading");
    expect(wrapBandLabel("18-21")).toBe("18-21");
  });
});

describe("bandLabelMarginBottom", () => {
  it("grows for wrapped and rotated labels, capped for rotation", () => {
    const cats = ["Total", "Physical care", "Reading"];
    expect(bandLabelMarginBottom(cats, "single")).toBe(22);
    expect(bandLabelMarginBottom(cats, "wrap")).toBeGreaterThan(22);
    expect(bandLabelMarginBottom(["A very very long single category label"], "rotate")).toBeLessThanOrEqual(74);
  });
});
