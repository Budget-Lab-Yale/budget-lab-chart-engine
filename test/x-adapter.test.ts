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

    it("markerToX resolves a real category to itself (band center), else null", () => {
      // A known category → the string itself (Plot's band scale places it at the bar center),
      // so point callouts land on categorical charts; an unknown category → null (dropped).
      expect(opts.markerToX({ x: "Services" })).toBe("Services");
      expect(opts.markerToX({ x: "not-a-category" })).toBeNull();
    });

    it("tooltipXParse and tooltipXFormat are undefined", () => {
      expect(opts.tooltipXParse).toBeUndefined();
      expect(opts.tooltipXFormat).toBeUndefined();
    });

    it("axisMarks is a non-empty array", () => {
      expect(Array.isArray(opts.axisMarks)).toBe(true);
      expect(opts.axisMarks.length).toBeGreaterThan(0);
    });

    it("buildXOpts([]) yields an empty band domain without throwing", () => {
      const emptyOpts = adapter.buildXOpts([]);
      expect(emptyOpts.xPlotOpts?.["domain"]).toEqual([]);
    });
  });
});

describe("makeXAdapter('numeric') anchorAtZero", () => {
  const data = [{ _xn: 2020 }, { _xn: 2021 }, { _xn: 2022 }];

  it("defaults to NOT anchoring at zero — the domain fits the data range", () => {
    const opts = makeXAdapter("numeric").buildXOpts(data);
    expect(opts.xPlotOpts?.["domain"]).toEqual([2020, 2022]);
  });

  it("extends the domain to include 0 only when anchorAtZero: true", () => {
    const opts = makeXAdapter("numeric", { anchorAtZero: true }).buildXOpts(data);
    expect(opts.xPlotOpts?.["domain"]).toEqual([0, 2022]);
  });
});

describe("makeXAdapter tooltip x-format override", () => {
  // A daily span: every point in July shares one "%b %Y" label, which is the bug.
  const dailyData = [{ _xd: new Date(2026, 0, 1) }, { _xd: new Date(2026, 11, 31) }];
  const quarterlyData = [{ _xd: new Date(2025, 0, 1) }, { _xd: new Date(2026, 9, 1) }];

  it("temporal: formats month-and-year when no pattern is given", () => {
    const opts = makeXAdapter("temporal").buildXOpts(dailyData);
    expect(opts.tooltipXFormat!(opts.tooltipXParse!("2026-07-23"))).toBe("Jul 2026");
  });

  it("temporal: a pattern names the day, so a daily series is no longer month-only", () => {
    const opts = makeXAdapter("temporal", undefined, undefined, "%b %-d, %Y").buildXOpts(dailyData);
    expect(opts.tooltipXFormat!(opts.tooltipXParse!("2026-07-23"))).toBe("Jul 23, 2026");
  });

  it("temporal: a day-precision pattern round-trips the exact date it was given", () => {
    // NB: the harness pins TZ=UTC (vitest.config.ts), where parseDate and `new Date(string)`
    // agree — so this locks the round-trip, NOT the negative-offset day shift parseDate exists
    // to prevent. That one is only observable outside UTC.
    const opts = makeXAdapter("temporal", undefined, undefined, "%Y-%m-%d").buildXOpts(dailyData);
    expect(opts.tooltipXFormat!(opts.tooltipXParse!("2022-01-01"))).toBe("2022-01-01");
  });

  it("quarterly: formats as YYYYQ# when no pattern is given", () => {
    const opts = makeXAdapter("quarterly").buildXOpts(quarterlyData);
    expect(opts.tooltipXFormat!(opts.tooltipXParse!("2026Q3"))).toBe("2026Q3");
  });

  it("quarterly: honors the same pattern key", () => {
    const opts = makeXAdapter("quarterly", undefined, undefined, "%b %Y").buildXOpts(quarterlyData);
    expect(opts.tooltipXFormat!(opts.tooltipXParse!("2026Q3"))).toBe("Jul 2026");
  });

  it("numeric: unaffected by the pattern (a time pattern is meaningless on a number)", () => {
    const opts = makeXAdapter("numeric", undefined, undefined, "%b %-d, %Y").buildXOpts([
      { _xn: 2020 },
      { _xn: 2022 },
    ]);
    // Grouped, because a numeric axis is not where a year belongs — `2,021` here is the signal to
    // move an annual series to `xAxisType: temporal`, which parses and labels a bare `YYYY`.
    expect(opts.tooltipXFormat!(opts.tooltipXParse!("2021"))).toBe("2,021");
  });
});

describe("makeXAdapter('numeric') hover formatting", () => {
  const data = [{ _xn: 0 }, { _xn: 1234567.891 }];

  it("rounds the crosshair header to two decimals, so all three hover surfaces agree", () => {
    // The defect this closes: the header printed the adapter's raw `${+v}`, so a numeric-axis line
    // chart put `x=2.285011857607663` in its card while the scatter card and the `{x}` callout
    // token — both already on `formatNumericX` — read `2.29`.
    const opts = makeXAdapter("numeric").buildXOpts(data);
    expect(opts.tooltipXFormat!(opts.tooltipXParse!("2.285011857607663"))).toBe("2.29");
    expect(opts.tooltipXFormat!(opts.tooltipXParse!("1234567.891"))).toBe("1,234,567.89");
  });

  it("rounds and groups a histogram's bin-edge header the same way", () => {
    const hist = makeXAdapter("numeric", undefined, [0, 2e6]).buildXOpts([{ _xn: 1 }]);
    expect(hist.tooltipXFormat!(hist.tooltipXParse!("1234567.891"))).toBe("1,234,567.89");
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
