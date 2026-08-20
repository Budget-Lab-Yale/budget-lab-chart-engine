import { describe, it, expect } from "vitest";
import { parseDate, parseQuarter, formatQuarter } from "../src/spec/parse-time";
import { parseXValue } from "../src/spec/parse-time";
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

// One x parse, one opinion about where a row sits. `x-adapter`'s per-type `parseX` delegates to
// `parseXValue` rather than parsing again, and this pins that it still does — a second, lookalike
// parser anywhere in the tree is a second answer to "which x is this row at", and the axis, the
// marks and the hover would each be free to pick a different one.
describe("parseXValue — the ONE x parse the renderer positions rows by", () => {
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
});
