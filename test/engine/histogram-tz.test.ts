// A11: temporal histogram calendar bins in the same time basis as `parseDate` (local midnight).
//
// vitest.config.ts pins TZ=UTC, where local and UTC agree, so the rest of the suite structurally
// cannot see this. This file moves the zone itself (Node re-reads process.env.TZ on assignment,
// as test/parse-time.test.ts relies on too) and restores it afterwards. Before the fix, the edges
// were floored with Date.UTC and the labels read getUTC*: east of UTC, parseDate("2020-01-01") is
// 2019-12-31T15:00Z in Tokyo, so it was binned into, and labelled, 2019.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { calendarEdges, histogramThresholds, binValues } from "../../src/engine/histogram-bin";
import { formatBinLabel } from "../../src/engine/histogram-label";
import { parseDate } from "../../src/spec/parse-time";

const local = (s: string) => parseDate(s).getTime();

function inZone(tz: string, precondition: () => void) {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.TZ;
    process.env.TZ = tz;
    precondition();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

describe("east of UTC (Asia/Tokyo): calendar bins follow the local parse", () => {
  inZone("Asia/Tokyo", () => {
    expect(new Date(local("2020-01-01")).getUTCFullYear(), "precondition: the zone is east of UTC").toBe(2019);
  });

  it("year edges are local January 1sts", () => {
    expect(calendarEdges(local("2020-01-01"), local("2021-06-01"), "year")).toEqual([
      local("2020-01-01"),
      local("2021-01-01"),
      local("2022-01-01"),
    ]);
  });

  it("month and quarter edges are local firsts", () => {
    expect(calendarEdges(local("2020-03-01"), local("2020-04-15"), "month")).toEqual([
      local("2020-03-01"),
      local("2020-04-01"),
      local("2020-05-01"),
    ]);
    expect(calendarEdges(local("2020-04-01"), local("2020-06-30"), "quarter")).toEqual([
      local("2020-04-01"),
      local("2020-07-01"),
    ]);
  });

  it("a boundary-day observation counts in its own year, through the shared threshold rule", () => {
    const xs = ["2020-01-01", "2020-06-01", "2021-01-01"].map(local);
    const t = histogramThresholds(xs, { binWidth: "year" } as never, true);
    const out = binValues(xs.map((x) => ({ series: "", x })), { thresholds: t });
    expect(out.map((b) => [new Date(b._x0).getFullYear(), b._y])).toEqual([
      [2020, 2],
      [2021, 1],
    ]);
  });

  it("labels a calendar bin by its local period", () => {
    const y = { xType: "temporal" as const, interval: "year" as const };
    expect(formatBinLabel(local("2020-01-01"), local("2021-01-01"), y)).toBe("2020");
    expect(formatBinLabel(local("2020-01-01"), local("2020-02-01"), { ...y, interval: "month" })).toBe(
      "January 2020",
    );
    expect(formatBinLabel(local("2020-04-01"), local("2020-07-01"), { ...y, interval: "quarter" })).toBe(
      "Q2 2020",
    );
    expect(formatBinLabel(local("2020-03-01"), local("2020-03-02"), { ...y, interval: "day" })).toBe(
      "March 1, 2020",
    );
  });

  it("labels a non-calendar bin's range from local parts", () => {
    expect(
      formatBinLabel(local("2020-01-01"), local("2020-04-01"), { xType: "temporal", interval: null }),
    ).toBe("January – March 2020");
  });
});

describe("a DST zone (America/New_York): day and week edges stay on local midnight", () => {
  inZone("America/New_York", () => {
    // 2020-03-08 is 23 hours long there, so a fixed 86,400,000 ms step leaves local midnight.
    expect(local("2020-03-09") - local("2020-03-08"), "precondition: a short DST day").toBe(23 * 3600000);
  });

  it("day edges are consecutive local midnights across the spring-forward day", () => {
    const e = calendarEdges(local("2020-03-06"), local("2020-03-10"), "day");
    expect(e).toEqual(
      ["2020-03-06", "2020-03-07", "2020-03-08", "2020-03-09", "2020-03-10", "2020-03-11"].map(local),
    );
  });

  it("week edges are local-midnight Sundays across the spring-forward day", () => {
    // 2020-03-04 is a Wednesday; its week starts Sunday 2020-03-01.
    const e = calendarEdges(local("2020-03-04"), local("2020-03-16"), "week");
    expect(e).toEqual(["2020-03-01", "2020-03-08", "2020-03-15", "2020-03-22"].map(local));
  });
});

describe("an EU DST zone (Europe/Berlin): day and month edges stay on local midnight", () => {
  inZone("Europe/Berlin", () => {
    // 2020-03-29 is 23 hours long there and 2020-10-25 is 25.
    expect(local("2020-03-30") - local("2020-03-29"), "precondition: spring-forward day").toBe(23 * 3600000);
    expect(local("2020-10-26") - local("2020-10-25"), "precondition: fall-back day").toBe(25 * 3600000);
  });

  it("day edges are consecutive local midnights across both changes", () => {
    expect(calendarEdges(local("2020-03-28"), local("2020-03-30"), "day")).toEqual(
      ["2020-03-28", "2020-03-29", "2020-03-30", "2020-03-31"].map(local),
    );
    expect(calendarEdges(local("2020-10-24"), local("2020-10-26"), "day")).toEqual(
      ["2020-10-24", "2020-10-25", "2020-10-26", "2020-10-27"].map(local),
    );
  });

  it("month edges and labels are local across the spring change", () => {
    const e = calendarEdges(local("2020-03-15"), local("2020-04-15"), "month");
    expect(e).toEqual(["2020-03-01", "2020-04-01", "2020-05-01"].map(local));
    expect(formatBinLabel(e[1]!, e[2]!, { xType: "temporal", interval: "month" })).toBe("April 2020");
  });
});
