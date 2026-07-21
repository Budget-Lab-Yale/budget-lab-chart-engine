import { describe, it, expect } from "vitest";
import { makeXAdapter } from "../src/engine/x-adapter";

// Histogram needs a CONTINUOUS x scale (linear for numeric, utc for temporal) whose domain
// spans the supplied bin edges [minEdge, maxEdge] — NOT the categorical band scale bar charts
// use, and NOT a domain inferred from the (already-binned) row data. `makeXAdapter`'s real
// surface has no standalone `xScaleOpts()` accessor (as an earlier draft of this test assumed);
// the scale options live on `XOpts.xPlotOpts`, returned by `buildXOpts()` — see x-adapter.ts:37-42.
describe("histogram x adapter", () => {
  it("numeric histogram uses a continuous (non-band) linear x scale spanning the bin edges", () => {
    const a = makeXAdapter("numeric", undefined, [0, 40]);
    const opts = a.buildXOpts([]);
    expect(opts.xPlotOpts?.["type"]).not.toBe("band");
    expect(opts.xPlotOpts?.["type"]).toBe("linear");
    expect(opts.xPlotOpts?.["domain"]).toEqual([0, 40]);
  });

  it("temporal histogram uses a utc continuous x scale spanning the bin edges", () => {
    const min = Date.UTC(2020, 0, 1);
    const max = Date.UTC(2020, 11, 31);
    const a = makeXAdapter("temporal", undefined, [min, max]);
    const opts = a.buildXOpts([]);
    expect(opts.xPlotOpts?.["type"]).toBe("utc");
    expect(opts.xPlotOpts?.["domain"]).toEqual([new Date(min), new Date(max)]);
  });

  it("does not affect the existing categorical/band branch when histogramDomain is omitted", () => {
    const a = makeXAdapter("categorical");
    const opts = a.buildXOpts([{ _xc: "A" }, { _xc: "B" }]);
    expect(opts.xPlotOpts?.["type"]).toBe("band");
  });
});
