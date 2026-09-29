import { describe, it, expect } from "vitest";
import {
  resolveTimelineConfig, parseEndCell, deriveDateFormat, timelineColumns, timelineDataErrors,
} from "../src/spec/timeline";
import { validateChartData } from "../src/spec/validate";
import { parseDate } from "../src/spec/parse-time";
import type { ChartSpec } from "../src/spec/types";

const TL = { chartType: "timeline", title: "T", xAxisType: "temporal", data: "d.csv" } as ChartSpec;

describe("resolveTimelineConfig", () => {
  it("applies every default", () => {
    expect(resolveTimelineConfig(TL)).toEqual({
      spacing: "proportional", lanes: false, axis: false, dateFormat: null,
      labelWidth: 150, maxRows: 2, autoVertical: true, verticalLanes: "columns",
    });
  });
  it("keeps authored values", () => {
    const c = resolveTimelineConfig({ ...TL, timeline: { spacing: "even", max_rows: 3, auto_vertical: false, date_format: "%b %Y", vertical_lanes: "single" } });
    expect(c).toMatchObject({ spacing: "even", maxRows: 3, autoVertical: false, dateFormat: "%b %Y", verticalLanes: "single" });
  });
});

describe("parseEndCell", () => {
  it.each([
    ["", { kind: "none" }],
    ["   ", { kind: "none" }],
    ["ongoing", { kind: "ongoing" }],
    [" Ongoing ", { kind: "ongoing" }],
    ["ONGOING", { kind: "ongoing" }],
    ["2030", { kind: "date", value: "2030" }],
    ["2030-06-01", { kind: "date", value: "2030-06-01" }],
    ["soon", { kind: "invalid", raw: "soon" }],
    ["2030-6-1", { kind: "invalid", raw: "2030-6-1" }],
    ["2026-13-01", { kind: "invalid", raw: "2026-13-01" }],
    ["2026-02-30", { kind: "invalid", raw: "2026-02-30" }],
    ["2024-02-29", { kind: "date", value: "2024-02-29" }],
  ])("%j", (raw, expected) => {
    expect(parseEndCell(raw)).toEqual(expected);
  });
});

describe("deriveDateFormat", () => {
  it("is %Y when every date is 1 January", () => {
    expect(deriveDateFormat(["2026", "2030", "2095"].map(parseDate))).toBe("%Y");
  });
  it("is %b %Y when every date is the 1st of a month", () => {
    expect(deriveDateFormat(["2026", "2026-07-01"].map(parseDate))).toBe("%b %Y");
  });
  it("is %b %-d, %Y otherwise", () => {
    expect(deriveDateFormat(["2026", "2026-07-04"].map(parseDate))).toBe("%b %-d, %Y");
  });
});

describe("timelineColumns", () => {
  it("defaults x to time and label to label, infers series", () => {
    expect(timelineColumns(TL, [{ time: "2026", label: "a", series: "s" }])).toEqual({
      x: "time", end: null, label: "label", description: null, date_label: null, series: "series",
    });
  });
});

describe("timelineDataErrors", () => {
  const spec = { ...TL, columns: { x: "date", end: "end", label: "title" } } as ChartSpec;
  const ok = { date: "2026", end: "", title: "Policy begins" };

  it("accepts points, spans and ongoing spans", () => {
    expect(timelineDataErrors(spec, [ok, { ...ok, end: "2030" }, { ...ok, end: "ongoing" }])).toEqual([]);
  });
  it("reports a missing mapped column", () => {
    expect(timelineDataErrors(spec, [{ date: "2026", title: "x" }]).join("\n")).toMatch(/columns\.end is "end" but no such column exists/);
  });
  it("reports an unparseable start date with its row", () => {
    expect(timelineDataErrors(spec, [ok, { ...ok, date: "26" }]).join("\n")).toMatch(/row 2: .*expected YYYY-MM-DD or YYYY/);
  });
  it("reports an unparseable end cell", () => {
    expect(timelineDataErrors(spec, [{ ...ok, end: "soon" }]).join("\n")).toMatch(/row 1: columns\.end .*"soon".*blank, a date, or "ongoing"/);
  });
  it("reports an end before its start", () => {
    expect(timelineDataErrors(spec, [{ ...ok, date: "2030", end: "2026" }]).join("\n")).toMatch(/row 1: end 2026 is before start 2030/);
  });
  it("reports a blank label", () => {
    expect(timelineDataErrors(spec, [{ ...ok, title: "  " }]).join("\n")).toMatch(/row 1: columns\.label .*is blank/);
  });
  it("reports an impossible month as a start date", () => {
    expect(timelineDataErrors(spec, [{ ...ok, date: "2026-13-01" }]).join("\n")).toMatch(/row 1: columns\.x .*invalid date "2026-13-01"/);
  });
  it("reports an impossible day as a start date", () => {
    expect(timelineDataErrors(spec, [{ ...ok, date: "2026-02-30" }]).join("\n")).toMatch(/row 1: columns\.x .*invalid date "2026-02-30"/);
  });
  it("reports an impossible calendar date as an end", () => {
    expect(timelineDataErrors(spec, [{ ...ok, end: "2026-13-01" }]).join("\n")).toMatch(/row 1: columns\.end .*"2026-13-01".*blank, a date, or "ongoing"/);
  });
  it("accepts a valid leap day", () => {
    expect(timelineDataErrors(spec, [{ ...ok, date: "2024-02-29" }])).toEqual([]);
  });
  it("is what validateChartData returns for a timeline", () => {
    expect(validateChartData(spec, [{ ...ok, title: "" }]).valid).toBe(false);
    expect(validateChartData(spec, [ok])).toEqual({ valid: true, errors: [] });
  });
  it("still checks series_colors keys against the data", () => {
    const s = { ...spec, columns: { ...spec.columns, series: "k" }, series_colors: { nope: "navy" } } as ChartSpec;
    expect(validateChartData(s, [{ ...ok, k: "a" }]).valid).toBe(false);
  });
});
