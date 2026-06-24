// X-axis adapters: one per xAxisType. Each knows how to parse the raw CSV time
// string, which in-memory field holds the parsed x, how to validate a row, and how
// to build the per-chart x options (domain, axis marks, bottom margin, tooltip
// formatters). Generic across chart types — the line builder consumes `xField`.
import { d3 } from "./vendor";
import { tblXAxis, tblTemporalXAxis, temporalXTicks, tblBandXAxis, bandLabelMarginBottom, type BandLabelMode } from "./axes";
import { X_AXIS_LABEL_CLASS } from "./facet-chrome";
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
  parseX: (v: string) => number | Date | string | null;
  xField: string;
  validate: (r: Record<string, unknown>) => boolean;
  /** Build the per-chart x options. `faceted` (shared-mode small multiples) tags the x-axis
   *  label marks with `X_AXIS_LABEL_CLASS` so the grid chrome collapse can keep the bottom-row
   *  copies and drop the duplicate rows. Default (false) → no class → output byte-identical. */
  buildXOpts: (data: Array<Record<string, any>>, faceted?: boolean, labelMode?: BandLabelMode) => XOpts;
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
      buildXOpts(data, faceted = false) {
        const xMax = d3.max(data, (d: any) => d._xn) as number;
        const anchorAtZero = xAxisPolicy?.anchorAtZero !== false;
        const xMin = anchorAtZero
          ? Math.min(0, d3.min(data, (d: any) => d._xn) as number)
          : (d3.min(data, (d: any) => d._xn) as number);
        return {
          marginBottom: 22,
          xPlotOpts: { label: null, axis: null, domain: [xMin, xMax] },
          axisMarks: tblXAxis({}, faceted ? X_AXIS_LABEL_CLASS : undefined),
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
      buildXOpts(data, faceted = false) {
        const xs = data.map((r) => +r._xd);
        const xDomain: [Date, Date] = [new Date(d3.min(xs) as number), new Date(d3.max(xs) as number)];
        return {
          marginBottom: temporalMarginBottom(xDomain),
          axisMarks: tblTemporalXAxis(xDomain, 1, faceted ? X_AXIS_LABEL_CLASS : undefined),
          markerToX: (m) => parseDate(m.x),
          // Use the SAME local-midnight parse as the chart's line points (parseDate), not the
          // crosshair's `new Date(string)` auto-detect — that parses YYYY-MM-DD as UTC and then
          // formats in local time, shifting "2022-01-01" to "Dec 2021" in negative-offset zones
          // (and mis-snapping the guide). Format a single-line "%b %Y" to match the axis.
          tooltipXParse: (v) => +parseDate(v),
          tooltipXFormat: (v) => d3.timeFormat("%b %Y")(new Date(v)),
        };
      },
    };
  }
  if (xType === "quarterly") {
    return {
      parseX: (v) => parseQuarter(v),
      xField: "_xd",
      validate: (r) => !!r._xd && !Number.isNaN(+(r._xd as Date)),
      buildXOpts(data, faceted = false) {
        const xs = data.map((r) => +r._xd);
        const xDomain: [Date, Date] = [new Date(d3.min(xs) as number), new Date(d3.max(xs) as number)];
        return {
          marginBottom: temporalMarginBottom(xDomain),
          axisMarks: tblTemporalXAxis(xDomain, 1, faceted ? X_AXIS_LABEL_CLASS : undefined),
          markerToX: (m) => parseQuarter(m.x),
          tooltipXParse: (v) => +(parseQuarter(v) as Date),
          tooltipXFormat: (v) => formatQuarter(new Date(v)),
        };
      },
    };
  }
  if (xType === "categorical") {
    return {
      // Identity: the raw string IS the category key.
      parseX: (v) => v,
      xField: "_xc",
      validate: (r) => typeof r._xc === "string" && r._xc !== "",
      buildXOpts(data, faceted = false, labelMode: BandLabelMode = "single") {
        // Category domain in data-encounter order (Style-Guide: declaration order is
        // authoritative; never auto-sort by magnitude).
        const seen = new Set<string>();
        for (const row of data) {
          const cat = row._xc as string | undefined;
          if (typeof cat === "string" && cat !== "") seen.add(cat);
        }
        const categories = Array.from(seen);

        // padding: 0.2 (inner gap between bands). paddingOuter leaves a small inset so
        // groups sit inside the frame. Grouped/stacked builders may override band padding
        // via mark-layer scale opts in a later task (A6/A7). The bottom margin grows to fit
        // wrapped (two-line) or rotated (45°) labels.
        return {
          marginBottom: bandLabelMarginBottom(categories, labelMode),
          xPlotOpts: {
            type: "band",
            domain: categories,
            axis: null,
            padding: 0.2,
          },
          axisMarks: tblBandXAxis(categories, "x", faceted ? X_AXIS_LABEL_CLASS : undefined, labelMode),
          // Vertical reference markers are meaningless on a band scale.
          markerToX: () => null,
          tooltipXParse: undefined,
          tooltipXFormat: undefined,
        };
      },
    };
  }
  throw new Error(`Unknown xAxisType: ${xType}`);
}
