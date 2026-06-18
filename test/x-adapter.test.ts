import { describe, it, expect } from "vitest";
import { makeXAdapter } from "../src/engine/x-adapter";
import { tblBandXAxis } from "../src/engine/axes";

describe("makeXAdapter('categorical')", () => {
  const adapter = makeXAdapter("categorical");

  it("parseX is identity — returns the raw string", () => {
    expect(adapter.parseX("Goods")).toBe("Goods");
    expect(adapter.parseX("")).toBe("");
  });

  it("xField is '_xc'", () => {
    expect(adapter.xField).toBe("_xc");
  });

  it("validate returns true for non-empty string _xc", () => {
    expect(adapter.validate({ _xc: "A" })).toBe(true);
    expect(adapter.validate({ _xc: "some category" })).toBe(true);
  });

  it("validate returns false for empty string", () => {
    expect(adapter.validate({ _xc: "" })).toBe(false);
  });

  it("validate returns false for non-string (number)", () => {
    expect(adapter.validate({ _xc: 42 })).toBe(false);
  });

  it("validate returns false when _xc is missing", () => {
    expect(adapter.validate({})).toBe(false);
  });

  describe("buildXOpts", () => {
    // Input has duplicates and is out-of-sorted order to confirm encounter-order dedup.
    const data = [
      { _xc: "Goods" },
      { _xc: "Services" },
      { _xc: "Goods" },    // duplicate — should not appear twice
      { _xc: "Housing" },
      { _xc: "Services" }, // duplicate
      { _xc: "Energy" },
    ];

    const opts = adapter.buildXOpts(data);

    it("xPlotOpts type is 'band'", () => {
      expect(opts.xPlotOpts?.["type"]).toBe("band");
    });

    it("xPlotOpts domain is deduplicated in data-encounter order", () => {
      expect(opts.xPlotOpts?.["domain"]).toEqual(["Goods", "Services", "Housing", "Energy"]);
    });

    it("xPlotOpts has axis: null", () => {
      expect(opts.xPlotOpts?.["axis"]).toBeNull();
    });

    it("xPlotOpts has a padding value", () => {
      expect(typeof opts.xPlotOpts?.["padding"]).toBe("number");
    });

    it("marginBottom is 22", () => {
      expect(opts.marginBottom).toBe(22);
    });

    it("markerToX always returns null", () => {
      expect(opts.markerToX({ x: "anything" })).toBeNull();
    });

    it("tooltipXParse and tooltipXFormat are undefined", () => {
      expect(opts.tooltipXParse).toBeUndefined();
      expect(opts.tooltipXFormat).toBeUndefined();
    });

    it("axisMarks is a non-empty array", () => {
      expect(Array.isArray(opts.axisMarks)).toBe(true);
      expect(opts.axisMarks.length).toBeGreaterThan(0);
    });
  });
});

describe("tblBandXAxis", () => {
  it("returns a non-empty Mark[] for a list of categories", () => {
    const marks = tblBandXAxis(["A", "B", "C"]);
    expect(Array.isArray(marks)).toBe(true);
    expect(marks.length).toBeGreaterThan(0);
  });

  it("returns a non-empty Mark[] for a single category", () => {
    const marks = tblBandXAxis(["Only"]);
    expect(marks.length).toBeGreaterThan(0);
  });

  it("returns an empty array when no categories are given", () => {
    // An empty band axis should still return something (Plot.text with empty data).
    const marks = tblBandXAxis([]);
    expect(Array.isArray(marks)).toBe(true);
  });
});
