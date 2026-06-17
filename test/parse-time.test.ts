import { describe, it, expect } from "vitest";
import { parseDate, parseQuarter, formatQuarter } from "../src/engine/parse-time";
import { pickTemporalCadence, temporalXTicks } from "../src/engine/axes";

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
