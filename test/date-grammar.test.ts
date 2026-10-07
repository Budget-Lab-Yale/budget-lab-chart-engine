// @vitest-environment jsdom
//
// ONE date grammar for validation and every parser. Before this, validation was strict and the
// parsers lax: `parseQuarter("2024Q5")` rolled into 2025Q1, `parseDate("2024-13-01")` into January
// 2025, `parseDate("March 1, 2024")` went through `new Date(s)`, and validation itself passed
// `2024-02-30` because V8's `new Date` rolls it into March. `renderChart` does not validate, so an
// embedder got a silently wrong x. Each test here fails against that code.
import { describe, it, expect } from "vitest";
import { parseDate, parseQuarter } from "../src/spec/parse-time";
import { validateChartData, validateSpec } from "../src/spec/validate";
import { parseEndCell, timelineDataErrors } from "../src/spec/timeline";
import { rugBoundPosition } from "../src/spec/rug";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const REJECTED_TEMPORAL = [
  "March 1, 2024", // the old `new Date(s)` fallback
  "2024-13-01", // month 13 used to roll into the next year
  "2024-02-30", // a day February does not have — validation used to pass this one too
  "2023-02-29", // not a leap year
  "2024-04-31",
  "2024-00-10",
  "2024-01-00",
  "2024-1-01",
  "2024-1-1",
  "2024/01/01",
  "2024-01-01T00:00",
  "12345",
  "195",
  " 2024",
  "",
];
const ACCEPTED_TEMPORAL = ["2024", "0000", "2024-01-01", "2024-02-29", "2000-02-29", "2024-12-31", "1952-07-04"];
const REJECTED_QUARTER = ["2024Q5", "2024Q0", "2024q1", "24Q1", "2024-01-01", "2024", ""];
const ACCEPTED_QUARTER = ["2024Q1", "2024Q4", "0050Q3"];

const LINE = {
  chartType: "line",
  title: "t",
  data: "data.csv",
  columns: { x: "time", value: "value" },
} as unknown as ChartSpec;
const temporal = { ...LINE, xAxisType: "temporal" } as ChartSpec;
const quarterly = { ...LINE, xAxisType: "quarterly" } as ChartSpec;
const rowsAt = (...xs: string[]): TidyRow[] => xs.map((time, i) => ({ time, value: String(i + 1) })) as TidyRow[];

describe("parseDate / parseQuarter reject what validation rejects", () => {
  it.each(REJECTED_TEMPORAL)("parseDate(%j) throws, naming the value and the grammar", (s) => {
    expect(() => parseDate(s)).toThrow(JSON.stringify(s));
    expect(() => parseDate(s)).toThrow(/^temporal x value: (expected YYYY-MM-DD or YYYY|invalid date)/);
  });

  it.each(REJECTED_QUARTER)("parseQuarter(%j) throws, naming the value and the grammar", (s) => {
    expect(() => parseQuarter(s)).toThrow(`quarterly x value: expected YYYYQ#, got ${JSON.stringify(s)}`);
  });

  it.each(ACCEPTED_TEMPORAL)("parseDate(%j) still parses to its own local calendar day", (s) => {
    const d = parseDate(s);
    const [y, m, day] = s.length === 4 ? [+s, 1, 1] : s.split("-").map(Number);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([y, m, day, 0]);
  });

  it.each(ACCEPTED_QUARTER)("parseQuarter(%j) still parses to the quarter's first day", (s) => {
    const d = parseQuarter(s);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([+s.slice(0, 4), (+s[5]! - 1) * 3, 1]);
  });

  it("agrees with validateChartData on every string, both ways", () => {
    for (const s of [...REJECTED_TEMPORAL, ...ACCEPTED_TEMPORAL]) {
      let parses = true;
      try { parseDate(s); } catch { parses = false; }
      expect([s, validateChartData(temporal, rowsAt(s)).valid]).toEqual([s, parses]);
    }
    for (const s of [...REJECTED_QUARTER, ...ACCEPTED_QUARTER]) {
      let parses = true;
      try { parseQuarter(s); } catch { parses = false; }
      expect([s, validateChartData(quarterly, rowsAt(s)).valid]).toEqual([s, parses]);
    }
  });

  it("validation names a calendar-impossible day as an invalid date", () => {
    const r = validateChartData(temporal, rowsAt("2024-02-30"));
    expect(r.errors).toEqual(['row 2: time: invalid date "2024-02-30"']);
  });

  it("the timeline's start and end cells read the same grammar", () => {
    const tl = { chartType: "timeline", title: "t", columns: { x: "date", label: "label", end: "end" } } as unknown as ChartSpec;
    for (const s of [...REJECTED_TEMPORAL, ...ACCEPTED_TEMPORAL]) {
      if (s.trim() === "") continue; // a blank end cell means "no end", a blank start is its own error
      // The timeline trims a cell before parsing it (spec/timeline.ts, marks/timeline.ts).
      let parses = true;
      try { parseDate(s.trim()); } catch { parses = false; }
      expect([s, parseEndCell(s).kind === "date"]).toEqual([s, parses]);
      expect([s, timelineDataErrors(tl, [{ date: s, label: "a", end: "" }]).length === 0]).toEqual([s, parses]);
    }
  });

  it("rug interval math reads the same grammar (a malformed bound has no position)", () => {
    expect(rugBoundPosition("temporal", "March 1, 2024")).toBeNaN();
    expect(rugBoundPosition("temporal", "2024-02-30")).toBeNaN();
    expect(rugBoundPosition("quarterly", "2024Q5")).toBeNaN();
    expect(rugBoundPosition("temporal", "2024")).toBe(rugBoundPosition("temporal", "2024-01-01"));
    expect(rugBoundPosition("temporal", "2024-03-01")).toBeGreaterThan(rugBoundPosition("temporal", "2024-02-29"));
    expect(rugBoundPosition("quarterly", "2024Q4")).toBeGreaterThan(rugBoundPosition("quarterly", "2024Q3"));
  });
});

describe("spec-side x coordinates on a date axis are validated by the same grammar", () => {
  // The engine parses each of these through the x adapter (`markerToX`), which now throws on a
  // malformed date. The publish CLI validates and then ships HTML that renders in the browser, so a
  // coordinate validation passed and the parser rejected would publish a figure that throws on load.
  it.each([
    ["annotations.xAxis[0].x", { annotations: { xAxis: [{ x: "March 2020" }] } }],
    ["xAxisPolicy.markers[0].x", { xAxisPolicy: { markers: [{ x: "2020-02-30" }] } }],
    ["annotations.bands[0].start", { annotations: { bands: [{ start: "2020-1-1", end: "2021-01-01" }] } }],
    ["annotations.bands[0].end", { annotations: { bands: [{ start: "2020-01-01", end: "2021-13-01" }] } }],
    ["xAxisPolicy.bands[0].start", { xAxisPolicy: { bands: [{ start: "Jan 2020", end: "2021" }] } }],
    ["annotations.points[0].x", { annotations: { points: [{ x: "2020/06/01", y: 1, label: "c" }] } }],
    ["shading[0].from", { shading: [{ from: "2020-06", to: "2021" }] }],
    ["shading[0].to", { shading: [{ from: "2020", to: "21" }] }],
  ])("%s", (where, extra) => {
    const r = validateSpec({ ...temporal, ...extra });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(new RegExp(`^${where.replace(/[.[\]]/g, "\\$&")}: (expected YYYY-MM-DD or YYYY|invalid date)`, "m"));
  });

  it("rug.tracks intervals (checked with the rest of the rug)", () => {
    const r = validateSpec({ ...temporal, rug: { tracks: [{ label: "R", intervals: [{ from: "2020-02-30", to: "2021" }] }] } } as ChartSpec);
    expect(r.errors).toEqual(['rug.tracks[0].intervals[0]: rug bound `from`: invalid date "2020-02-30"']);
  });

  it("on a quarterly axis, against YYYYQ#", () => {
    const r = validateSpec({ ...quarterly, annotations: { xAxis: [{ x: "2020Q5" }] } });
    expect(r.errors).toEqual(['annotations.xAxis[0].x: expected YYYYQ#, got "2020Q5"']);
  });

  it("accepts every well-formed coordinate, and leaves numeric and categorical axes alone", () => {
    const ann = {
      annotations: {
        xAxis: [{ x: "2020" }],
        bands: [{ start: "2020-03-01", end: "2021-02-28" }],
        points: [{ x: "2020-06-01", y: 1, label: "c" }],
      },
      shading: [{ from: "2020", to: "2021-01-01" }],
    };
    expect(validateSpec({ ...temporal, ...ann })).toEqual({ valid: true, errors: [] });
    expect(validateSpec({ ...LINE, xAxisType: "numeric", annotations: { xAxis: [{ x: "1.5" }] } } as ChartSpec).valid).toBe(true);
  });
});

describe("renderChart rejects a malformed date instead of drawing a wrong x", () => {
  const OPTS = { width: 720, height: 400, document };

  it.each([
    ["March 1, 2024", 'temporal x value: expected YYYY-MM-DD or YYYY, got "March 1, 2024"'],
    ["2024-13-01", 'temporal x value: invalid date "2024-13-01"'],
    ["2024-02-30", 'temporal x value: invalid date "2024-02-30"'],
  ])("a temporal data cell %j", (bad, message) => {
    expect(() => renderChart(temporal, rowsAt("2024-01-01", bad), OPTS)).toThrow(message);
  });

  it("a quarterly data cell \"2024Q5\"", () => {
    expect(() => renderChart(quarterly, rowsAt("2024Q4", "2024Q5"), OPTS)).toThrow(
      'quarterly x value: expected YYYYQ#, got "2024Q5"',
    );
  });

  it("a malformed annotation coordinate", () => {
    const spec = { ...temporal, annotations: { xAxis: [{ x: "March 2024", label: "m" }] } } as ChartSpec;
    expect(() => renderChart(spec, rowsAt("2024-01-01", "2024-06-01"), OPTS)).toThrow(
      'temporal x value: expected YYYY-MM-DD or YYYY, got "March 2024"',
    );
  });

  it("well-formed dates do not throw", () => {
    expect(() => renderChart(temporal, rowsAt("2024", "2024-02-29", "2024-12-31"), OPTS)).not.toThrow();
    expect(() => renderChart(quarterly, rowsAt("2024Q1", "2024Q4"), OPTS)).not.toThrow();
  });
});

describe("a timeline's start and end cells: renderChart and the PNG export throw on a malformed date", () => {
  // A malformed end cell used to become "no end" and draw the row as a point event, silently.
  const OPTS = { width: 720, document };
  const TL = {
    chartType: "timeline", title: "t", xAxisType: "temporal", data: "d.csv",
    columns: { x: "date", label: "label", end: "end" },
  } as unknown as ChartSpec;
  const rowsWith = (start: string, end: string): TidyRow[] =>
    [{ date: "2020-01-01", label: "a", end: "" }, { date: start, label: "b", end }] as TidyRow[];
  const both = (rows: TidyRow[]) => [() => renderChart(TL, rows, OPTS), () => buildExportSvg(TL, rows)];

  it.each([
    ["2024-02-30", 'timeline end value: invalid date "2024-02-30"'],
    ["March 1, 2024", 'timeline end value: expected YYYY-MM-DD or YYYY, got "March 1, 2024"'],
    ["2024-13-01", 'timeline end value: invalid date "2024-13-01"'],
  ])("an end cell %j", (bad, message) => {
    for (const f of both(rowsWith("2024-01-01", bad))) expect(f).toThrow(message);
  });

  it.each([
    ["2024-02-30", 'temporal x value: invalid date "2024-02-30"'],
    ["March 1, 2024", 'temporal x value: expected YYYY-MM-DD or YYYY, got "March 1, 2024"'],
  ])("a start cell %j", (bad, message) => {
    for (const f of both(rowsWith(bad, ""))) expect(f).toThrow(message);
  });

  it("a blank end cell is still a point event, and \"ongoing\" still an open span", () => {
    const noEnd = { ...TL, columns: { x: "date", label: "label" } } as unknown as ChartSpec;
    const html = (spec: ChartSpec, rows: TidyRow[]) => renderChart(spec, rows, OPTS).svg.outerHTML;
    const blank = rowsWith("2024-01-01", "");
    expect(html(TL, blank)).toBe(html(noEnd, blank));
    expect(buildExportSvg(TL, blank).outerHTML).toBe(buildExportSvg(noEnd, blank).outerHTML);
    for (const f of both(rowsWith("2024-01-01", "ongoing"))) expect(f).not.toThrow();
    expect(html(TL, rowsWith("2024-01-01", "ongoing"))).not.toBe(html(TL, blank));
  });
});
