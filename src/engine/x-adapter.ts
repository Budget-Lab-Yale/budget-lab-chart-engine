// X-axis adapters: one per xAxisType. Each knows how to parse the raw CSV time
// string, which in-memory field holds the parsed x, how to validate a row, and how
// to build the per-chart x options (domain, axis marks, bottom margin, tooltip
// formatters). Generic across chart types — the line builder consumes `xField`.
import { d3 } from "./vendor";
import {
  tblXAxis, tblTemporalXAxis, temporalXTicks, thinTemporalTicks, everyKthThatFits, labelsClear, maxClearLabels, measuredLabelWidth,
  tblBandXAxis, bandLabelMarginBottom, type BandLabelMode,
} from "./axes";
import { parseXValue, parseDate, parseQuarter, formatQuarter } from "../spec/parse-time";
import { formatNumericX, formatNumericTick, isAnnualSeries } from "./util";
import type { XAxisType, XAxisPolicy } from "../spec/types";

type Mark = unknown;

export interface XOpts {
  marginBottom: number;
  axisMarks: Mark[];
  /** Maps a marker spec's `x` string onto the adapter's x value (for reference lines / point
   *  callouts). Categorical: returns the category string itself (Plot's band scale places it at the
   *  band center) when it's a real category, else null. */
  markerToX: (m: { x: string }) => number | Date | string | null;
  /** Plot `x` scale options (numeric supplies an explicit domain). */
  xPlotOpts?: Record<string, unknown>;
  /** Crosshair x parse/format. Every continuous adapter (numeric, temporal, quarterly) sets both;
   *  only the categorical adapter leaves them undefined, and a categorical chart never reaches
   *  attachCrosshair (it is dispatched to the catline or band crosshair first). */
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
}

/** Per-chart options for `buildXOpts`. Named rather than positional: the axis has accumulated
 *  several independent switches, and the positional form left adapters declaring placeholder
 *  params they never read just to reach the last one. */
export interface BuildXOptsOptions {
  /** Categorical axis: horizontal / wrapped / rotated category labels. */
  labelMode?: BandLabelMode;
  /** Categorical axis: stamp the hover-accent hook class on the category labels — passed true for
   *  bar/stacked charts only (see pane.ts), so other categorical chart types (categorical-x line,
   *  dot plot) stay byte-identical. */
  tagCategoryLabels?: boolean;
  /** Reserved px between the plot frame's bottom edge and the tick labels — the x-axis rug's strip
   *  lives here (see spec/rug.ts `rugAllowance`). The adapter adds it to BOTH its `marginBottom`
   *  and its label `dy`, in one place, so the two can never drift: room is always made for exactly
   *  the offset the labels took. Default 0. Ignored on the categorical axis, where the rug is not
   *  supported. */
  bottomGutter?: number;
  /** The plot's data width (px). A temporal/quarterly axis thins its ticks to fit it. */
  dataWidth?: number;
  /** Small multiples on a date axis: the narrowest pane's data width (px), which every pane fits its
   *  ticks to, so unequal `pane_widths` still give every pane the same ticks and bottom margin.
   *  Absent → `dataWidth`. */
  tickWidth?: number;
  /** Small multiples on a continuous axis: the range every pane shares (see `SharedXDomain`); a
   *  single date-axis chart: its own drawn range (`drawnDateDomain`). Absent → the axis fits this
   *  pane's own rows. Ignored on the categorical axis. */
  sharedX?: SharedXDomain;
  /** `x_ticks`: the candidate tick positions in the axis' units (epoch ms on a date axis) — the
   *  data's x values or the listed ones. Values outside the drawn range are dropped and the rest
   *  thinned to every k-th until the labels clear. Absent → the axis picks its own ticks. */
  tickValues?: number[];
}

/** One x range for every pane of a small-multiples figure, or a single date-axis chart's own
 *  (`drawnDateDomain`), in the axis' own units (epoch ms on a date axis). Two spans because a
 *  temporal axis takes them from different places: its ticks come from the DATA, while Plot fits
 *  its scale over every mark, so a marker or band past the data widens the scale but not the
 *  ticks. A numeric axis has one span and both fields hold it. */
export interface SharedXDomain {
  /** The data extent: in a figure, the union of every pane's; on a single chart, its own. */
  data: [number, number];
  /** The drawn x-scale domain: in a figure, the union of every pane's; on a single chart, its data
   *  widened to its annotations and connectors (`drawnDateDomain`). */
  scale: [number, number];
}

export interface XAdapter {
  parseX: (v: string) => number | Date | string;
  xField: string;
  validate: (r: Record<string, unknown>) => boolean;
  /** Build the per-chart x options. See BuildXOptsOptions. */
  buildXOpts: (data: Array<Record<string, any>>, opts?: BuildXOptsOptions) => XOpts;
}

// Margin for the two-line month/year axis vs the collapsed year-only axis.
const temporalMarginBottom = (ticks: Date[]): number => {
  const allJanuary = ticks.length > 0 && ticks.every((d) => d.getMonth() === 0);
  return allJanuary ? 22 : 38;
};

/** A date axis' ticks: `x_ticks` candidates inside the drawn range, thinned to fit, else the axis' own
 *  cadence. Computed once per axis so the drawn labels and the margin reserved for them agree. */
function dateAxisTicks(
  xDomain: [Date, Date],
  tickWidth: number | undefined,
  scale: [number, number] | undefined,
  tickValues: number[] | undefined,
): Date[] {
  if (!tickValues) return temporalXTicks(xDomain, tickWidth, scale);
  const [lo, hi] = scale ?? [+xDomain[0], +xDomain[1]];
  const inRange = sortedInRange(tickValues, lo, hi).map((v) => new Date(v));
  return thinTemporalTicks(inRange, tickWidth, hi - lo);
}

function sortedInRange(values: number[], lo: number, hi: number): number[] {
  return [...new Set(values)].filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
}

/** A point-callout connector whose label end sits `dxPx` px along x from its point at `x` (epoch ms):
 *  assemblePlot draws that end at `x + dxPx * span / plotWidth`, a data coordinate. */
export interface SidewaysLeader {
  x: number;
  dxPx: number;
}

/** The range a single (non-small-multiples) date-axis chart is DRAWN over: its data extent widened
 *  to every x its annotations draw at (`annotationXs`, epoch ms), then to the label end of every
 *  sideways connector (`leaders`), so that everything that maps px <-> data before the render
 *  (overlay `domain: "axis"`, label stagger, callout geometry) reads the scale actually drawn. The
 *  axis is handed this span explicitly, as a figure pane's `sharedX` is.
 *
 *  A connector's end depends on the span it widens (its px offset is converted at span / plotWidth
 *  data units per px), so the span is the least one that holds every end: for the binding right end
 *  `x_r + b_r*s` and left end `x_l + b_l*s` (b = dxPx / plotWidth), s = (x_r - x_l) / (1 - b_r + b_l),
 *  maximised over the candidate pairs (the annotation-widened edges count, with b = 0). Exact, so
 *  the binding end lands ON the frame edge rather than past it. A connector reaching a full plot
 *  width or more (1 - b_r + b_l <= 0) has no such span and is left to overhang. */
export function drawnDateDomain(
  dataExtent: [number, number],
  annotationXs: number[],
  leaders: SidewaysLeader[] = [],
  plotWidth?: number,
): SharedXDomain {
  let [lo, hi] = dataExtent;
  for (const x of annotationXs) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (leaders.length && plotWidth! > 0) {
    const w = plotWidth!;
    const right: Array<[number, number]> = [[hi, 0], ...leaders.filter((l) => l.dxPx > 0).map((l): [number, number] => [l.x, l.dxPx / w])];
    const left: Array<[number, number]> = [[lo, 0], ...leaders.filter((l) => l.dxPx < 0).map((l): [number, number] => [l.x, l.dxPx / w])];
    let span = hi - lo;
    for (const [xr, br] of right) {
      for (const [xl, bl] of left) {
        const den = 1 - br + bl;
        if (den > 0) span = Math.max(span, (xr - xl) / den);
      }
    }
    for (const [x, b] of right) hi = Math.max(hi, x + b * span);
    for (const [x, b] of left) lo = Math.min(lo, x + b * span);
  }
  return { data: dataExtent, scale: [lo, hi] };
}

/** Reads an `XOpts.xPlotOpts.domain` as a numeric span, for callers that map px <-> data against
 *  the DRAWN axis. Numbers pass through; Dates (a temporal histogram's bin-edge span) become epoch
 *  ms; anything else is not a span — notably the categorical adapter's `domain`, which is the list
 *  of category strings — and returns undefined so the caller falls back to the data extent. */
export function numericAxisDomain(domain: unknown): [number, number] | undefined {
  if (!Array.isArray(domain) || domain.length !== 2) return undefined;
  const lo = domain[0] instanceof Date ? domain[0].getTime() : domain[0];
  const hi = domain[1] instanceof Date ? domain[1].getTime() : domain[1];
  // Number.isFinite does NOT coerce, so a category string fails here rather than becoming NaN.
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo as number, hi as number] : undefined;
}

/** The two date axes, temporal and quarterly: one domain / ticks / margin / scale build, differing
 *  only in how an x string parses (`parse`, for markers and the crosshair) and formats in the card,
 *  and in a temporal histogram's bin-edge span (`histogramDomain`). */
function dateAdapter(cfg: {
  xType: "temporal" | "quarterly";
  parse: (v: string) => Date;
  histogramDomain: [number, number] | undefined;
  /** The card's x format, which may read the pane's rows. */
  tooltipXFormat: (data: Array<Record<string, any>>) => (v: number) => string;
}): XAdapter {
  const { xType, parse, histogramDomain } = cfg;
  return {
    parseX: (v) => parseXValue(xType, v),
    xField: "_xd",
    validate: () => true, // parseX throws on a malformed date, so every row has a valid _xd
    buildXOpts(data, { bottomGutter = 0, dataWidth, tickWidth = dataWidth, sharedX, tickValues } = {}) {
      const tooltipXFormat = cfg.tooltipXFormat(data);
      let xDomain: [Date, Date];
      if (histogramDomain) {
        xDomain = [new Date(histogramDomain[0]), new Date(histogramDomain[1])];
      } else if (sharedX) {
        xDomain = [new Date(sharedX.data[0]), new Date(sharedX.data[1])];
      } else {
        const xs = data.map((r) => +r._xd);
        xDomain = [new Date(d3.min(xs) as number), new Date(d3.max(xs) as number)];
      }
      const ticks = dateAxisTicks(xDomain, tickWidth, sharedX?.scale, tickValues);
      // axis:null/label:null so Plot draws NO native axis — the engine's tblTemporalXAxis marks are
      // the axis. Without this, xPlotOpts replaces the whole x-scale (assemble-plot merges by
      // assignment, not over the default) and Plot's native ticks render on top → doubled labels.
      const xPlotOpts = histogramDomain
        ? { type: "utc", domain: xDomain, axis: null, label: null }
        : sharedX
          ? { domain: sharedX.scale.map((v) => new Date(v)), axis: null, label: null }
          : undefined;
      return {
        marginBottom: temporalMarginBottom(ticks) + bottomGutter,
        ...(xPlotOpts ? { xPlotOpts } : {}),
        axisMarks: tblTemporalXAxis(xDomain, tickWidth, bottomGutter, sharedX?.scale, ticks),
        // The SAME local-midnight parse as the chart's own points (parseDate / parseQuarter), not
        // `new Date(string)` — that parses YYYY-MM-DD as UTC and then formats in local time,
        // shifting "2022-01-01" to "Dec 2021" in negative-offset zones (and mis-snapping the guide).
        markerToX: (m) => parse(m.x),
        tooltipXParse: (v) => +parse(v),
        tooltipXFormat,
      };
    },
  };
}

export function makeXAdapter(
  xType: XAxisType,
  xAxisPolicy?: XAxisPolicy,
  histogramDomain?: [number, number],
  tooltipXFormatPattern?: string,
): XAdapter {
  if (xType === "numeric") {
    return {
      parseX: (v) => parseXValue("numeric", v),
      xField: "_xn",
      validate: (r) => Number.isFinite(r._xn),
      buildXOpts(data, { bottomGutter = 0, dataWidth, tickWidth = dataWidth, sharedX, tickValues } = {}) {
        // Histogram: the domain is the caller-supplied bin-edge span, not the data range (the
        // "data" here is already-binned counts, which must NOT drive the x domain).
        if (histogramDomain) {
          return {
            marginBottom: 22 + bottomGutter,
            xPlotOpts: { type: "linear", label: null, axis: null, domain: histogramDomain },
            axisMarks: tblXAxis(
              { xTickFormat: (d: unknown) => formatNumericTick(+(d as number)) },
              bottomGutter,
            ),
            markerToX: (m) => +m.x,
            tooltipXParse: (v) => +v,
            tooltipXFormat: (v) => formatNumericX(+v),
          };
        }
        // Default OFF: a numeric axis fits its data range. Anchoring at zero is surprising for a
        // year axis (it squishes all history to the right); opt in with anchorAtZero: true. It moves
        // whichever end is short of 0: the maximum too when every x is negative.
        const anchorAtZero = xAxisPolicy?.anchorAtZero === true;
        const dataMax = d3.max(data, (d: any) => d._xn) as number;
        const xMax = sharedX ? sharedX.scale[1] : anchorAtZero && dataMax != null ? Math.max(0, dataMax) : dataMax;
        const xMin = sharedX
          ? sharedX.scale[0]
          : anchorAtZero
            ? Math.min(0, d3.min(data, (d: any) => d._xn) as number)
            : (d3.min(data, (d: any) => d._xn) as number);
        // `x_ticks`: the candidates inside the domain, every k-th until their labels clear.
        let ticks: number[] | undefined;
        if (tickValues) {
          ticks = sortedInRange(tickValues, xMin, xMax);
          if (tickWidth! > 0 && xMax > xMin) {
            ticks = everyKthThatFits(
              ticks,
              (s) =>
                labelsClear(
                  s.length,
                  (i) => ((s[i]! - xMin) / (xMax - xMin)) * tickWidth!,
                  (i) => measuredLabelWidth(formatNumericTick(s[i]!)),
                ),
              // No numeric label is narrower than one digit.
              maxClearLabels(tickWidth!, measuredLabelWidth("1")),
            );
          }
        }
        return {
          marginBottom: 22 + bottomGutter,
          xPlotOpts: { label: null, axis: null, domain: [xMin, xMax] },
          // Tick labels: grouped, full precision. `formatNumericTick` and `formatNumericX` (util.ts)
          // share one grouping rule, so a tick and any hover reading never disagree about a number;
          // they differ only in rounding, because a tick is a value d3 chose and a hover reading is
          // arbitrary data. Years are no longer a special case here — a bare `YYYY` belongs on a
          // TEMPORAL axis, which parses and labels it correctly (see `parseDate`).
          axisMarks: tblXAxis(
            { xTickFormat: (d: unknown) => formatNumericTick(+(d as number)), ...(ticks ? { ticks } : {}) },
            bottomGutter,
          ),
          markerToX: (m) => +m.x,
          tooltipXParse: (v) => +v,
          // The crosshair header rounds to two decimals, exactly as the scatter card and the `{x}`
          // token do: all three go through `formatNumericX`, so the three hover surfaces agree.
          tooltipXFormat: (v) => formatNumericX(+v),
        };
      },
    };
  }
  if (xType === "temporal") {
    return dateAdapter({
      xType,
      parse: parseDate,
      // Histogram: the domain is the caller-supplied bin-edge span, not the data range.
      histogramDomain,
      tooltipXFormat(data) {
        // An ANNUAL series — every point on 1 January — is identified by its year alone, so the
        // month in the card is noise: `Jan 1950` under an axis reading `1950`. The axis already
        // collapses a year-cadence span to a bare `%Y` (`tblTemporalXAxis`), and this stops the
        // card disagreeing with it. Tested on the DATA, deliberately NOT on the tick cadence: a
        // MONTHLY series across eighty years also gets decade ticks, and there the month is the
        // only thing that tells two adjacent points apart. An explicit `tooltip_x_format` wins.
        const annualData =
          data.every((d: any) => (d._xd as unknown) instanceof Date) &&
          isAnnualSeries(data.map((d: any) => d._xd as Date));
        // Default to a single-line "%b %Y" to match the axis — which is wrong only when the data is
        // finer than the ticks (a daily series has every point in a month sharing one label), hence
        // spec.tooltip_x_format.
        return (v) => d3.timeFormat(tooltipXFormatPattern ?? (annualData ? "%Y" : "%b %Y"))(new Date(v));
      },
    });
  }
  if (xType === "quarterly") {
    return dateAdapter({
      xType,
      parse: parseQuarter,
      // A quarterly axis takes no histogram span: a histogram's x is numeric or temporal.
      histogramDomain: undefined,
      tooltipXFormat: () =>
        tooltipXFormatPattern
          ? (v) => d3.timeFormat(tooltipXFormatPattern)(new Date(v))
          : (v) => formatQuarter(new Date(v)),
    });
  }
  if (xType === "categorical") {
    return {
      // Identity: the raw string IS the category key.
      parseX: (v) => parseXValue("categorical", v),
      xField: "_xc",
      validate: (r) => typeof r._xc === "string" && r._xc !== "",
      buildXOpts(data, { labelMode = "single", tagCategoryLabels = false }: BuildXOptsOptions = {}) {
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
          axisMarks: tblBandXAxis(
            categories,
            "x",
            labelMode,
            tagCategoryLabels,
          ),
          // Categorical: a marker/point `x` resolves to the category string itself, which Plot's
          // band scale positions at the band (bar) center; unknown categories → null (dropped).
          markerToX: (m) => (seen.has(m.x) ? m.x : null),
          tooltipXParse: undefined,
          tooltipXFormat: undefined,
        };
      },
    };
  }
  throw new Error(`Unknown xAxisType: ${xType}`);
}
