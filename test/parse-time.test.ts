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

  it("parses a bare YYYY to LOCAL January 1st, not UTC midnight", () => {
    // The bug this closes, and the reason it was invisible: `new Date("1952")` reads the string as
    // an ISO year and anchors it at UTC midnight, so in any negative-offset zone it lands on 31
    // December 1951 and `getFullYear()` returns 1951 — every point and every tick of an annual
    // series one year adrift. The harness pins TZ=UTC (vitest.config.ts), where the two agree, so
    // this test moves the zone itself; without that it would pass against the unfixed code.
    const saved = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      expect(new Date("1952").getFullYear(), "precondition: the zone really is negative-offset").toBe(1951);
      const d = parseDate("1952");
      expect(d.getFullYear()).toBe(1952);
      expect(d.getMonth()).toBe(0);
      expect(d.getDate()).toBe(1);
      // The two spellings of the same instant must agree, or a mixed-format column would split.
      expect(d.getTime()).toBe(parseDate("1952-01-01").getTime());
      expect(parseXValue("temporal", "1952")).toEqual(d);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("keeps a low four-digit year in its own century, not the Date constructor's 1900 window", () => {
    // `new Date(50, 0, 1)` is 1950: the multi-argument constructor maps years 0-99 into 1900-1999.
    // Reading "0050" as 1950 would be a worse bug than the UTC shift the bare-year branch fixes,
    // because it is silently the wrong century rather than one year out.
    expect(new Date(50, 0, 1).getFullYear(), "precondition: the legacy offset is real").toBe(1950);
    expect(parseDate("0050").getFullYear()).toBe(50);
    expect(parseDate("0099").getFullYear()).toBe(99);
    expect(parseDate("0000").getFullYear()).toBe(0);
    expect(parseDate("1952").getFullYear()).toBe(1952);
    // The FULL-DATE spelling had the same trap, and fixing only the bare year would have put the
    // two spellings of one instant 1900 years apart. Month and day must survive the correction.
    const full = parseDate("0050-06-15");
    expect([full.getFullYear(), full.getMonth(), full.getDate()]).toEqual([50, 5, 15]);
    expect(parseDate("0050").getTime()).toBe(parseDate("0050-01-01").getTime());
    // parseQuarter shares the constructor for the same reason.
    expect((parseQuarter("0050Q3") as Date).getFullYear()).toBe(50);
    expect((parseQuarter("0050Q3") as Date).getMonth()).toBe(6);
    // Unchanged for every ordinary year.
    const ord = parseDate("2021-01-02");
    expect([ord.getFullYear(), ord.getMonth(), ord.getDate()]).toEqual([2021, 0, 2]);
    expect((parseQuarter("2022Q3") as Date).getMonth()).toBe(6);
  });

  it("leaves a non-year, non-ISO string on the Date() fallback", () => {
    // Four digits is the whole gate: five must not be read as a year.
    expect(parseDate("12345").getTime()).toBe(new Date("12345").getTime());
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
