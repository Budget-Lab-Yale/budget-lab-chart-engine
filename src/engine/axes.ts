// Axis + gridline marks and Plot defaults. These encode the Style-Guide chart
// conventions (y-labels above each gridline at the left edge; no spines/ticks;
// two-line temporal x-axis). Marks are returned as opaque Plot mark objects.
import { Plot, d3 } from "./vendor";
import { TBL, TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT } from "./theme";

type Mark = unknown;

export interface TblPlotDefaultsOptions {
  height?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
}

export function tblPlotDefaults({
  height = 320,
  marginLeft = TBL_MARGIN_LEFT,
  marginRight = TBL_MARGIN_RIGHT,
  marginTop = 18,
  // marginBottom only needs to fit the tick labels (caller overrides per chart type:
  // ~22 for single-line ticks, ~38 for two-line month/year).
  marginBottom = 24,
}: TblPlotDefaultsOptions = {}) {
  return {
    height,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    style: {
      background: "transparent",
      color: TBL.color.text,
      fontFamily: TBL.font,
      fontSize: `${TBL.size.axis}px`,
      overflow: "visible",
    },
    x: { label: null, axis: null },
    y: { label: null, axis: null, grid: false },
  };
}

// Gridlines (Plot.ruleY) + y-tick labels positioned in the left margin at svg x=0,
// above each gridline (FT/Economist convention). `insetLeft: -marginLeft` +
// `clip: false` extends gridlines through the label margin to the SVG's left edge.
export function gridAndYLabels(
  yTicks: number[],
  {
    yTickFormat = (d: number) => String(d),
    marginLeft = TBL_MARGIN_LEFT,
    marginRight = TBL_MARGIN_RIGHT,
    gridlineClassName,
  }: {
    yTickFormat?: (d: number) => string;
    marginLeft?: number;
    marginRight?: number;
    /** When set (faceted charts only), tags the gridline <g> so the facet-chrome collapse
     *  pass can find the per-facet copies. Left undefined for non-faceted charts so their
     *  output stays byte-identical (Plot omits the class attribute entirely). */
    gridlineClassName?: string;
  } = {},
): Mark[] {
  // Skip y=0 from the light gridlines — the zero baseline is painted darker on top,
  // and stacking two 1px rules at the same y looks fuzzy. The "0" label still renders.
  const gridlineTicks = yTicks.filter((t) => t !== 0);
  return [
    Plot.ruleY(gridlineTicks, {
      stroke: TBL.color.gridline,
      strokeWidth: 1,
      insetLeft: -marginLeft,
      insetRight: -marginRight,
      clip: false,
      ...(gridlineClassName ? { className: gridlineClassName } : {}),
    }),
    // className tags the wrapping <g> so the live renderer can find these labels
    // post-render and replace them with a sticky overlay during horizontal scroll.
    Plot.text(yTicks, {
      y: (d: number) => d,
      text: yTickFormat,
      frameAnchor: "left",
      dx: -marginLeft,
      dy: -6,
      textAnchor: "start",
      fill: TBL.color.axis,
      fontSize: TBL.size.axis,
      fontWeight: 500,
      className: "tbl-y-tick-label",
    }),
  ];
}

// X-axis tick labels (numeric): left-anchored at each tick, just below the bottom
// gridline.
export function tblXAxis({ xTickFormat }: { xTickFormat?: (d: unknown) => string } = {}): Mark[] {
  return [
    Plot.axisX({
      anchor: "bottom",
      textAnchor: "middle",
      tickSize: 0,
      dy: 4,
      fontSize: TBL.size.axis,
      fill: TBL.color.axis,
      fontWeight: 500,
      tickFormat: xTickFormat,
    }),
  ];
}

// Tick cadence for a temporal axis, aiming for ~8-12 ticks across the span.
export function pickTemporalCadence(xDomain: [Date, Date]): number {
  const months = (+xDomain[1] - +xDomain[0]) / (30.44 * 24 * 3600 * 1000);
  if (months <= 36) return 3; // quarterly
  if (months <= 72) return 6; // semi-annual
  if (months <= 144) return 12; // yearly
  if (months <= 288) return 24; // every 2 years
  if (months <= 600) return 60; // every 5 years
  return 120; // every 10 years
}

export function temporalXTicks(xDomain: [Date, Date]): Date[] {
  const cadence = pickTemporalCadence(xDomain);
  const [start, end] = xDomain;

  if (cadence < 12) {
    // Sub-yearly cadence: snap ticks to month boundaries aligned to January.
    let t = d3.timeMonth.floor(start) as Date;
    const ticks: Date[] = [];
    const monthOffset = t.getMonth() % cadence;
    if (monthOffset !== 0) t = d3.timeMonth.offset(t, cadence - monthOffset) as Date;
    while (t <= end) {
      if (t >= start) ticks.push(new Date(t));
      t = d3.timeMonth.offset(t, cadence) as Date;
    }
    return ticks;
  }

  // Yearly+ cadence: ticks at January of each Nth year.
  const years = cadence / 12;
  const startYear = Math.ceil(start.getFullYear() / years) * years;
  const ticks: Date[] = [];
  for (let y = startYear; new Date(y, 0, 1) <= end; y += years) {
    const t = new Date(y, 0, 1);
    if (t >= start) ticks.push(t);
  }
  return ticks;
}

// Two-line temporal x-axis: month name on top, year below (January only). When every
// tick lands on January (yearly+ cadence) the "Jan" line is redundant, so just the
// year renders at the top-line position.
export function tblTemporalXAxis(xDomain: [Date, Date]): Mark[] {
  const ticks = temporalXTicks(xDomain);
  const yearTicks = ticks.filter((d) => d.getMonth() === 0);
  const allJanuary = ticks.length > 0 && yearTicks.length === ticks.length;

  if (allJanuary) {
    return [
      Plot.text(ticks, {
        x: (d: Date) => d,
        text: (d: Date) => d3.timeFormat("%Y")(d),
        frameAnchor: "bottom",
        dy: 12,
        textAnchor: "middle",
        dx: 0,
        fill: TBL.color.axis,
        fontSize: TBL.size.axis,
        fontWeight: 500,
      }),
    ];
  }

  return [
    // Month name (top line)
    Plot.text(ticks, {
      x: (d: Date) => d,
      text: (d: Date) => d3.timeFormat("%b")(d),
      frameAnchor: "bottom",
      dy: 12,
      textAnchor: "middle",
      dx: 0,
      fill: TBL.color.axis,
      fontSize: TBL.size.axis,
      fontWeight: 500,
    }),
    // Year (bottom line, January only)
    Plot.text(yearTicks, {
      x: (d: Date) => d,
      text: (d: Date) => d3.timeFormat("%Y")(d),
      frameAnchor: "bottom",
      dy: 24,
      textAnchor: "middle",
      dx: 0,
      fill: TBL.color.axis,
      fontSize: TBL.size.axis,
      fontWeight: 500,
    }),
  ];
}

// Band (categorical) x-axis: one label per category, anchored at the band's left edge,
// per the bar-grouped spec. No tick marks.
//
// Plot 0.6.16 auto-adds bandwidth/2 to any text mark on a band scale (via its internal
// `ot` helper), which would center the text anchor. We counter that with an initializer
// that sets `this.dx = -bandwidth/2` after Plot has computed the scale — the net offset
// is zero, landing the textAnchor:"start" origin at the band's left edge.
//
// `scaleField` selects which band scale the labels sit on: "x" for single-series bars
// (categories ARE the x band) and "fx" for grouped bars (categories are the facet groups;
// `x` carries the inner series). The initializer reads bandwidth from that same scale.
export function tblBandXAxis(
  categories: string[],
  scaleField: "x" | "fx" = "x",
): Mark[] {
  const channel = scaleField === "fx" ? { fx: (d: string) => d } : { x: (d: string) => d };
  return [
    Plot.text(
      categories,
      Plot.initializer(
        {
          ...channel,
          text: (d: string) => d,
          frameAnchor: "bottom",
          dy: 12,
          textAnchor: "start",
          dx: 0,
          fill: TBL.color.axis,
          fontSize: TBL.size.axis,
          fontWeight: 500,
        },
        function (
          this: { dx: number },
          _data: unknown,
          _facets: unknown,
          _channels: unknown,
          scales: Record<string, { bandwidth?: () => number }>,
        ) {
          const bw = scales?.[scaleField]?.bandwidth?.();
          if (bw != null) this.dx = -bw / 2;
          return {};
        },
      ),
    ),
  ];
}

// Band (categorical) y-axis for HORIZONTAL bars: one label per category at the band's
// left edge in the label margin (svg x=0), vertically centered on its band. No ticks.
export function tblBandYAxis(categories: string[]): Mark[] {
  return [
    Plot.text(categories, {
      y: (d: string) => d,
      text: (d: string) => d,
      frameAnchor: "left",
      dx: -TBL_MARGIN_LEFT,
      textAnchor: "start",
      fill: TBL.color.axis,
      fontSize: TBL.size.axis,
      fontWeight: 500,
    }),
  ];
}

/** Make a Plot-produced SVG responsive: swap fixed width/height for a viewBox so it
 * scales to its container. (Used by the live, non-overflowing render path.) */
export function makeResponsive(svg: SVGSVGElement): SVGSVGElement {
  const w = +(svg.getAttribute("width") ?? "") || 720;
  const h = +(svg.getAttribute("height") ?? "") || 320;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("width", "100%");
  svg.removeAttribute("height");
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  return svg;
}
