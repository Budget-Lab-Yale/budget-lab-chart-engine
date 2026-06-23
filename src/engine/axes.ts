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
    hideYLabels = false,
  }: {
    yTickFormat?: (d: number) => string;
    marginLeft?: number;
    marginRight?: number;
    /** When set (faceted charts only), tags the gridline <g> so the facet-chrome collapse
     *  pass can find the per-facet copies. Left undefined for non-faceted charts so their
     *  output stays byte-identical (Plot omits the class attribute entirely). */
    gridlineClassName?: string;
    /** Shared-mode small multiples, non-leftmost columns: emit the gridlines (so the plot
     *  area stays aligned) but DROP the y-tick label text marks. The left margin is kept by
     *  the caller, so panes stay the same width and aligned. Default false → labels emitted. */
    hideYLabels?: boolean;
  } = {},
): Mark[] {
  // Skip y=0 from the light gridlines — the zero baseline is painted darker on top,
  // and stacking two 1px rules at the same y looks fuzzy. The "0" label still renders.
  const gridlineTicks = yTicks.filter((t) => t !== 0);
  const marks: Mark[] = [
    Plot.ruleY(gridlineTicks, {
      stroke: TBL.color.gridline,
      strokeWidth: 1,
      insetLeft: -marginLeft,
      insetRight: -marginRight,
      clip: false,
      ...(gridlineClassName ? { className: gridlineClassName } : {}),
    }),
  ];
  // className tags the wrapping <g> so the live renderer can find these labels
  // post-render and replace them with a sticky overlay during horizontal scroll.
  // Shared-mode non-leftmost panes pass hideYLabels → the label marks are skipped entirely
  // (gridlines above stay), so only the left column shows tick values.
  if (!hideYLabels) {
    marks.push(
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
    );
  }
  return marks;
}

/** One pane of a small-multiples grid: its (col,row) cell coordinate + its display title. */
export interface PaneTitleCell {
  /** Grid column index (drives the `fx` facet channel via String(col)). */
  col: number;
  /** Grid row index (drives the `fy` facet channel via String(row)). */
  row: number;
  /** Display title for the pane (falls back to the raw facet value upstream). */
  title: string;
}

// Per-facet pane title for shared-mode small-multiples grids. Renders one title at each
// pane cell's TOP-LEFT, 11pt/700 in the heading color. The text mark facets on BOTH `fx`
// (=String(col)) and `fy` (=String(row)) so Plot places exactly one title in its (col,row)
// cell. Tagged with PANE_TITLE_CLASS so the chrome pass / tests can find it (it is never
// collapsed — one per pane is correct).
export function paneTitleMark(cells: PaneTitleCell[]): Mark[] {
  return [
    Plot.text(cells, {
      fx: (d: PaneTitleCell) => String(d.col),
      fy: (d: PaneTitleCell) => String(d.row),
      text: (d: PaneTitleCell) => d.title,
      frameAnchor: "top-left",
      dy: -8,
      textAnchor: "start",
      fill: TBL.color.text,
      fontSize: 11,
      fontWeight: 700,
      className: "tbl-pane-title",
    }),
  ];
}

// X-axis tick labels (numeric): left-anchored at each tick, just below the bottom
// gridline. `className` (faceted small-multiples only): tags the axis-label group so the grid
// chrome collapse can keep the bottom-row copies. Left undefined for single-frame charts so
// their output stays byte-identical (Plot omits the class attribute entirely).
export function tblXAxis(
  { xTickFormat }: { xTickFormat?: (d: unknown) => string } = {},
  className?: string,
): Mark[] {
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
      ...(className ? { className } : {}),
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

// `densityMultiplier` thins the ticks for narrow panes (small multiples): the base cadence
// (months between ticks) is multiplied so a higher value yields FEWER ticks. It is the tick
// CADENCE divisor in reverse — 1 = every tick, 2 = every other tick, 3 = every third, etc.
// EXPECTS INTEGERS ≥ 1. Non-integer or sub-1 inputs are clamped to an integer ≥ 1 (via
// floor then max-1), so 1.9 → 1 (not 2) and 0/0.5/negatives → 1. Default 1 = unchanged. The
// multiplier is applied to the month cadence and re-bucketed so the yearly/sub-yearly snapping
// below stays consistent (e.g. yearly cadence × 2 → every 2 years).
export function temporalXTicks(xDomain: [Date, Date], densityMultiplier = 1): Date[] {
  const cadence = pickTemporalCadence(xDomain) * Math.max(1, Math.floor(densityMultiplier));
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
// `className` (faceted small-multiples only): tags the x-axis-label text group(s) so the
// grid chrome collapse can keep the bottom-row copies and drop the rest. Left undefined for
// single-frame charts so their output stays byte-identical (Plot omits the class attribute).
export function tblTemporalXAxis(
  xDomain: [Date, Date],
  densityMultiplier = 1,
  className?: string,
): Mark[] {
  const ticks = temporalXTicks(xDomain, densityMultiplier);
  const yearTicks = ticks.filter((d) => d.getMonth() === 0);
  const allJanuary = ticks.length > 0 && yearTicks.length === ticks.length;
  const cls = className ? { className } : {};

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
        ...cls,
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
      ...cls,
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
      ...cls,
    }),
  ];
}

// Band (categorical) x-axis: one label per category, CENTERED under each bar / group, per
// the stakeholder's second visual pass. No tick marks. Centering is Plot's NATURAL band
// behavior — a band text mark is positioned at the band CENTER — so both the single-band
// (`x`) and grouped (`fx`) cases just anchor at the band/facet center via `frameAnchor`
// + `textAnchor:"middle"`. No initializer / `dx` machinery is needed.
//
// (This reverses the earlier left-edge experiment; see git history. The horizontal-bar left
// gutter, which still uses `estimateLabelWidth`, is unaffected.)
//
// `scaleField`: "x" for single-series bars (categories ARE the x band); "fx" for grouped
// bars (categories are the facet groups; `x` carries the inner series).
// `className` (faceted small-multiples only): tags the label group so the grid chrome collapse
// can keep the bottom-row copies. Left undefined for single-frame charts so their output stays
// byte-identical (Plot omits the class attribute entirely).
export function tblBandXAxis(
  categories: string[],
  scaleField: "x" | "fx" = "x",
  className?: string,
): Mark[] {
  const cls = className ? { className } : {};
  if (scaleField === "fx") {
    // GROUPED: each category is its own FACET frame. Facet the text mark on `fx` (one label
    // per facet) and anchor it to the facet frame's BOTTOM CENTER, so the label centers under
    // the cluster. `frameAnchor:"bottom"` resolves per-facet.
    const rows = categories.map((c) => ({ c }));
    return [
      Plot.text(rows, {
        fx: (d: { c: string }) => d.c,
        text: (d: { c: string }) => d.c,
        frameAnchor: "bottom",
        dy: 12,
        textAnchor: "middle",
        fill: TBL.color.axis,
        fontSize: TBL.size.axis,
        fontWeight: 500,
        ...cls,
      }),
    ];
  }

  // SINGLE BAND: categories live on the `x` band scale (no faceting). `frameAnchor:"bottom"`
  // anchors the label at the plot's bottom edge; the band `x` channel centers it under each
  // bar (Plot positions a band text mark at the band center). `textAnchor:"middle"` keeps
  // the glyphs centered on that point.
  return [
    Plot.text(categories, {
      x: (d: string) => d,
      text: (d: string) => d,
      frameAnchor: "bottom",
      dy: 12,
      textAnchor: "middle",
      fill: TBL.color.axis,
      fontSize: TBL.size.axis,
      fontWeight: 500,
      ...cls,
    }),
  ];
}

// Approximate the rendered px width of a string at the axis font size. No canvas/DOM
// measurement (jsdom has none, and we need byte-stable headless output), so we use a
// per-character average-advance heuristic for Figtree: ~0.55em per character is a good
// fit for mixed-case label text at this size. Deterministic by construction.
const AVG_CHAR_EM = 0.55;
export function estimateLabelWidth(text: string, fontSize: number = TBL.size.axis): number {
  return text.length * fontSize * AVG_CHAR_EM;
}

// Responsive LEFT GUTTER for horizontal bars: the y-axis category labels live in the left
// margin (left-justified at svg x=0), so the margin must be wide enough for the LONGEST
// label or it clips into the plot. Derived from the longest category at the axis font size
// (not a fixed constant), clamped to a sensible range so a single very long label doesn't
// swallow the whole canvas. `pad` reserves a small gap between the label and the bars.
export function horizontalLeftGutter(
  categories: string[],
  { pad = 10, min = TBL_MARGIN_LEFT, max = 240 }: { pad?: number; min?: number; max?: number } = {},
): number {
  const longest = categories.reduce((w, c) => Math.max(w, estimateLabelWidth(c)), 0);
  return Math.round(Math.max(min, Math.min(max, longest + pad)));
}

// Band (categorical) y-axis for HORIZONTAL bars: one label per category at the band's
// left edge in the label margin (svg x=0), vertically centered on its band. No ticks.
// `marginLeft` is the (responsive) left gutter width; the label is pushed left by that
// amount so its `textAnchor:"start"` origin lands at svg x=0, flush with the title above.
export function tblBandYAxis(
  categories: string[],
  marginLeft: number = TBL_MARGIN_LEFT,
): Mark[] {
  return [
    Plot.text(categories, {
      y: (d: string) => d,
      text: (d: string) => d,
      frameAnchor: "left",
      dx: -marginLeft,
      textAnchor: "start",
      fill: TBL.color.axis,
      fontSize: TBL.size.axis,
      fontWeight: 500,
    }),
  ];
}

// Group (category) labels for HORIZONTAL GROUPED bars: categories are the `fy` ROW FACETS
// (analog of tblBandXAxis(.., "fx") for vertical grouped, swapping fx→fy / bottom→left).
// Facet the text mark on `fy` (one label per row facet) and anchor it to the facet frame's
// LEFT edge, vertically CENTERED on the cluster (matches the vertical grouped convention:
// group labels are centered on their band). The label is pushed left by `marginLeft` so its
// `textAnchor:"start"` origin lands at svg x=0, flush with the title above.
export function tblFacetGroupYAxis(
  categories: string[],
  marginLeft: number = TBL_MARGIN_LEFT,
): Mark[] {
  const rows = categories.map((c) => ({ c }));
  return [
    Plot.text(rows, {
      fy: (d: { c: string }) => d.c,
      text: (d: { c: string }) => d.c,
      frameAnchor: "left",
      dx: -marginLeft,
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
