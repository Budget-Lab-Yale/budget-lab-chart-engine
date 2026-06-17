// X-axis adapters: one per xAxisType. Each knows how to parse the raw CSV time
// string, which in-memory field holds the parsed x, how to validate a row, and how
// to build the per-chart x options (domain, axis marks, bottom margin, tooltip
// formatters). Generic across chart types — the line builder consumes `xField`.
import { d3 } from "./vendor";
import { tblXAxis, tblTemporalXAxis, temporalXTicks } from "./axes";
import { parseDate, parseQuarter, formatQuarter } from "./parse-time";
import type { XAxisType, XAxisPolicy } from "../spec/types";

type Mark = unknown;

export interface XOpts {
  marginBottom: number;
  axisMarks: Mark[];
  /** Maps a marker spec's `x` string onto the adapter's x value (for reference lines). */
  markerToX: (m: { x: string }) => number | Date | null;
  /** Plot `x` scale options (numeric supplies an explicit domain). */
  xPlotOpts?: Record<string, unknown>;
  /** Crosshair x parse/format overrides; undefined = crosshair auto-detects. */
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
}

export interface XAdapter {
  parseX: (v: string) => number | Date | null;
  xField: string;
  validate: (r: Record<string, unknown>) => boolean;
  buildXOpts: (data: Array<Record<string, any>>) => XOpts;
}

// Margin for the two-line month/year axis vs the collapsed year-only axis.
const temporalMarginBottom = (xDomain: [Date, Date]): number => {
  const ticks = temporalXTicks(xDomain);
  const allJanuary = ticks.length > 0 && ticks.every((d) => d.getMonth() === 0);
  return allJanuary ? 22 : 38;
};

export function makeXAdapter(xType: XAxisType, xAxisPolicy?: XAxisPolicy): XAdapter {
  if (xType === "numeric") {
    return {
      parseX: (v) => +v,
      xField: "_xn",
      validate: (r) => Number.isFinite(r._xn),
      buildXOpts(data) {
        const xMax = d3.max(data, (d: any) => d._xn) as number;
        const anchorAtZero = xAxisPolicy?.anchorAtZero !== false;
        const xMin = anchorAtZero
          ? Math.min(0, d3.min(data, (d: any) => d._xn) as number)
          : (d3.min(data, (d: any) => d._xn) as number);
        return {
          marginBottom: 22,
          xPlotOpts: { label: null, axis: null, domain: [xMin, xMax] },
          axisMarks: tblXAxis(),
          markerToX: (m) => +m.x,
          tooltipXParse: (v) => +v,
          tooltipXFormat: (v) => `Month ${v}`,
        };
      },
    };
  }
  if (xType === "temporal") {
    return {
      parseX: (v) => parseDate(v),
      xField: "_xd",
      validate: (r) => !!r._xd && !Number.isNaN(+(r._xd as Date)),
      buildXOpts(data) {
        const xs = data.map((r) => +r._xd);
        const xDomain: [Date, Date] = [new Date(d3.min(xs) as number), new Date(d3.max(xs) as number)];
        return {
          marginBottom: temporalMarginBottom(xDomain),
          axisMarks: tblTemporalXAxis(xDomain),
          markerToX: (m) => parseDate(m.x),
          tooltipXParse: undefined, // crosshair auto-detects YYYY-MM-DD
          tooltipXFormat: undefined,
        };
      },
    };
  }
  if (xType === "quarterly") {
    return {
      parseX: (v) => parseQuarter(v),
      xField: "_xd",
      validate: (r) => !!r._xd && !Number.isNaN(+(r._xd as Date)),
      buildXOpts(data) {
        const xs = data.map((r) => +r._xd);
        const xDomain: [Date, Date] = [new Date(d3.min(xs) as number), new Date(d3.max(xs) as number)];
        return {
          marginBottom: temporalMarginBottom(xDomain),
          axisMarks: tblTemporalXAxis(xDomain),
          markerToX: (m) => parseQuarter(m.x),
          tooltipXParse: (v) => +(parseQuarter(v) as Date),
          tooltipXFormat: (v) => formatQuarter(new Date(v)),
        };
      },
    };
  }
  throw new Error(`Unknown xAxisType: ${xType}`);
}
