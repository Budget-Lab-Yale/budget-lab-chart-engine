import { describe, it, expect } from "vitest";
import { parseDate, parseQuarter, formatQuarter } from "../src/spec/parse-time";
import { parseXValue, xPositionKey } from "../src/spec/parse-time";
import { pickTemporalCadence, temporalXTicks } from "../src/engine/axes";
import { makeXAdapter } from "../src/engine/x-adapter";
import type { XAxisType } from "../src/spec/types";

describe("parse-time", () => {
  it("parses YYYY-MM-DD to a local-midnight Date", () => {
    const d = parseDate("2021-01-02");
    expect(d.getFullYear()).toBe(2021);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(2);
  });

  it("parses YYYYQ# to the first day of the quarter", () => {
    const d = parseQuarter("2022Q3") as Date;
    expect(d.getFullYear()).toBe(2022);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(1);
  });

  it("returns null for a non-quarter string", () => {
    expect(parseQuarter("2022-01-01")).toBeNull();
  });

  it("round-trips a quarter through formatQuarter", () => {
    expect(formatQuarter(parseQuarter("2024Q2") as Date)).toBe("2024Q2");
  });
});

describe("temporal cadence", () => {
  it("picks quarterly for short spans and yearly+ for long ones", () => {
    const twoYears: [Date, Date] = [new Date(2022, 0, 1), new Date(2024, 0, 1)];
    expect(pickTemporalCadence(twoYears)).toBe(3); // quarterly
    const tenYears: [Date, Date] = [new Date(2014, 0, 1), new Date(2024, 0, 1)];
    expect(pickTemporalCadence(tenYears)).toBe(12); // yearly
  });

  it("places ticks on January boundaries for a multi-year yearly cadence", () => {
    const ticks = temporalXTicks([new Date(2014, 0, 1), new Date(2024, 0, 1)]);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((d) => d.getMonth() === 0)).toBe(true);
  });
});

// spec/validate.ts's pooled-overlay guard buckets rows by x, and it must bucket them exactly where
// the renderer DRAWS them: a guard with its own lookalike x parser is a guard that can disagree
// with the figure it protects (the raw-spelling version of it let a "1" / "1.0" disagreement
// through while the pooled polyline got two vertices at x = 1). `x-adapter`'s `parseX` therefore
// delegates here rather than parsing again, and this pins that it still does.
describe("parseXValue — the ONE x parse, shared by the renderer and validation", () => {
  const CASES: Array<[XAxisType, string[]]> = [
    ["numeric", ["1", "1.0", "1e0", "+.50", "0.5", "-3", "", "oops"]],
    ["temporal", ["2020-01-01", "2020-02-01", "not-a-date"]],
    ["quarterly", ["2020Q1", "2020Q2", "2020-01-01"]],
    ["categorical", ["Alaska", "", "1"]],
  ];

  it("is what engine/x-adapter.ts's parseX returns, for every axis type", () => {
    for (const [type, raws] of CASES) {
      const { parseX } = makeXAdapter(type);
      for (const raw of raws) {
        const viaAdapter = parseX(raw);
        const direct = parseXValue(type, raw);
        // Dates compare by instant; NaN (a bad numeric cell) compares by NaN-ness.
        const norm = (v: unknown): unknown =>
          v instanceof Date ? (Number.isNaN(+v) ? "Invalid Date" : +v) : typeof v === "number" && Number.isNaN(v) ? "NaN" : v;
        expect([type, raw, norm(viaAdapter)]).toEqual([type, raw, norm(direct)]);
      }
    }
  });

  it("gives one key to numeric spellings of one x, and distinct keys to distinct dates", () => {
    expect(xPositionKey("numeric", "1")).toBe(xPositionKey("numeric", "1.0"));
    expect(xPositionKey("numeric", "1000")).toBe(xPositionKey("numeric", "1e3"));
    expect(xPositionKey("temporal", "2020-01-01")).not.toBe(xPositionKey("temporal", "2020-02-01"));
    expect(xPositionKey("quarterly", "2020Q1")).not.toBe(xPositionKey("quarterly", "2020Q2"));
    expect(xPositionKey("categorical", "Alaska")).toBe("Alaska");
  });

  it("returns null for a cell that resolves to NO position — validate reports those separately", () => {
    expect(xPositionKey("numeric", "oops")).toBeNull();
    expect(xPositionKey("numeric", "")).toBeNull();
    expect(xPositionKey("temporal", "not-a-date")).toBeNull();
    expect(xPositionKey("quarterly", "2020-01-01")).toBeNull();
    expect(xPositionKey("categorical", "")).toBeNull();
  });
});
