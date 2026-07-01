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
/** How categorical band labels are laid out to avoid collision, in escalating order:
 *  - "single": one horizontal line (default);
 *  - "wrap":   multi-WORD labels break onto two lines (single-word labels stay one line);
 *  - "rotate": labels turn 45° (last resort, when even wrapped labels would overlap). */
export type BandLabelMode = "single" | "wrap" | "rotate";

export function tblBandXAxis(
  categories: string[],
  scaleField: "x" | "fx" = "x",
  className?: string,
  mode: BandLabelMode = "single",
): Mark[] {
  const cls = className ? { className } : {};
  const textOf = (s: string): string => (mode === "wrap" ? wrapBandLabel(s) : s);
  // Per-mode layout props. Rotated labels are CENTER-anchored and turned 45° (counter-clockwise,
  // reading bottom-left → top-right): center-anchoring keeps each label's bounding-box center on
  // its tick — so the categorical-line crosshair, which reads label centers, stays accurate —
  // while the turn shrinks the horizontal footprint to avoid collisions. Wrapped labels stack
  // two lines downward from the axis (lineAnchor "top"). `dy` clears the axis in each case.
  const modeProps =
    mode === "rotate"
      ? { rotate: -45, textAnchor: "middle" as const, dy: rotatedLabelDy(categories) }
      : mode === "wrap"
        ? { textAnchor: "middle" as const, lineAnchor: "top" as const, dy: 9 }
        : { textAnchor: "middle" as const, dy: 12 };

  if (scaleField === "fx") {
    // GROUPED: each category is its own FACET frame. Facet the text mark on `fx` (one label
    // per facet) and anchor it to the facet frame's BOTTOM CENTER, so the label centers under
    // the cluster. `frameAnchor:"bottom"` resolves per-facet.
    const rows = categories.map((c) => ({ c }));
    return [
      Plot.text(rows, {
        fx: (d: { c: string }) => d.c,
        text: (d: { c: string }) => textOf(d.c),
        frameAnchor: "bottom",
        fill: TBL.color.axis,
        fontSize: TBL.size.axis,
        fontWeight: 500,
        ...modeProps,
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
      text: (d: string) => textOf(d),
      frameAnchor: "bottom",
      fill: TBL.color.axis,
      fontSize: TBL.size.axis,
      fontWeight: 500,
      ...modeProps,
      ...cls,
    }),
  ];
}

/** Longest estimated category-label width (axis font), used for the layout decision. */
function maxBandLabelWidth(categories: string[]): number {
  return categories.reduce((w, c) => Math.max(w, estimateLabelWidth(c)), 0);
}

/** Width of a label after an optional two-line wrap: for a multi-WORD label, the narrower of the
 *  balanced two-line splits (max of the two line widths); single-word labels (no spaces — hyphens
 *  do NOT count) keep their full width. */
function wrappedLabelWidth(label: string): number {
  const words = label.split(/\s+/);
  if (words.length < 2) return estimateLabelWidth(label);
  let best = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = estimateLabelWidth(words.slice(0, i).join(" "));
    const b = estimateLabelWidth(words.slice(i).join(" "));
    best = Math.min(best, Math.max(a, b));
  }
  return best;
}

/** Insert a single newline at the balanced split point of a multi-word label (so it renders on
 *  two lines). Single-word labels are returned unchanged. Hyphens are never broken. */
export function wrapBandLabel(label: string): string {
  const words = label.split(/\s+/);
  if (words.length < 2) return label;
  let best = Infinity;
  let bestI = 1;
  for (let i = 1; i < words.length; i++) {
    const w = Math.max(
      estimateLabelWidth(words.slice(0, i).join(" ")),
      estimateLabelWidth(words.slice(i).join(" ")),
    );
    if (w < best) { best = w; bestI = i; }
  }
  return `${words.slice(0, bestI).join(" ")}\n${words.slice(bestI).join(" ")}`;
}

/** Choose the band-label layout for the available width. Labels are centered on their ticks, so
 *  adjacent labels collide when a label is wider than its per-category slot (`plotWidth / n`).
 *  When that happens, prefer wrapping multi-word labels to two lines; only rotate if even the
 *  wrapped labels would overlap. <2 categories or non-positive width → "single". */
export function bandLabelMode(categories: string[], plotWidth: number): BandLabelMode {
  if (categories.length < 2 || !(plotWidth > 0)) return "single";
  const step = plotWidth / categories.length;
  if (maxBandLabelWidth(categories) <= step) return "single";
  const wrappedMax = Math.max(...categories.map(wrappedLabelWidth));
  return wrappedMax <= step ? "wrap" : "rotate";
}

/** Center y-offset (dy) for a rotated band label so the whole 45° label clears the axis. */
function rotatedLabelDy(categories: string[]): number {
  return Math.round(maxBandLabelWidth(categories) * 0.355 + 12);
}

/** Bottom margin to fit each band-label layout (vs the ~22px single-line default). */
export function bandLabelMarginBottom(categories: string[], mode: BandLabelMode): number {
  // A 45° label drops by ~sin(45)·width below the axis; reserve that (plus a little padding) so it
  // isn't clipped by the frame. Cap high enough for realistic long labels (~24 chars) — beyond that
  // the author should shorten the category or rely on pane titles rather than have a giant margin.
  if (mode === "rotate") return Math.round(Math.min(120, 18 + maxBandLabelWidth(categories) * 0.71));
  if (mode === "wrap") return 36; // room for a second line
  return 22;
}

// Approximate the rendered px width of a string at the axis font size. No canvas/DOM
// measurement (jsdom has none, and we need byte-stable headless output), so we use a
// per-character average-advance heuristic for Figtree: ~0.55em per character is a good
// fit for mixed-case label text at this size. Deterministic by construction.
const AVG_CHAR_EM = 0.55;
export function estimateLabelWidth(text: string, fontSize: number = TBL.size.axis): number {
  return text.length * fontSize * AVG_CHAR_EM;
}

/** Greedily word-wrap a label into as many lines as needed so each line's estimated width is
 *  ≤ `maxPx` (a single over-long word still gets its own line). Returns the lines joined by "\n"
 *  (Plot renders that as multi-line text). A label that already fits returns unchanged (no "\n"),
 *  so callers that only sometimes wrap stay byte-identical for the labels that don't. */
export function wrapToWidth(
  label: string,
  maxPx: number,
  fontSize: number = TBL.size.axis,
): string {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return label;
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (!cur || estimateLabelWidth(trial, fontSize) <= maxPx) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

/** Number of lines `label` wraps to at `maxPx` (≥ 1). */
export function labelLineCount(label: string, maxPx: number, fontSize: number = TBL.size.axis): number {
  return wrapToWidth(label, maxPx, fontSize).split("\n").length;
}

/** Padding (px) reserved between the wrapped category label and the bars in the left gutter. */
export const GUTTER_TEXT_PAD = 8;

// Responsive LEFT GUTTER for horizontal bars: the y-axis category labels live in the left
// margin (left-justified at svg x=0), so the margin must be wide enough for the LONGEST
// label or it clips into the plot. Derived from the longest category at the axis font size
// (not a fixed constant), clamped to a sensible range so a single very long label doesn't
// swallow the whole canvas. `pad` reserves a small gap between the label and the bars.
export function horizontalLeftGutter(
  categories: string[],
  {
    pad = 10,
    min = TBL_MARGIN_LEFT,
    max = 240,
    fontSize = TBL.size.axis,
  }: { pad?: number; min?: number; max?: number; fontSize?: number } = {},
): number {
  const longest = categories.reduce((w, c) => Math.max(w, estimateLabelWidth(c, fontSize)), 0);
  return Math.round(Math.max(min, Math.min(max, longest + pad)));
}

/** Category-label font size (px) for FACETED horizontal bars. Larger than the single-chart axis
 *  size so the labels read at the same prominence they would in a standalone chart (the faceted
 *  figure is much taller, which makes the default 10.5px look small). */
export const FACETED_CAT_LABEL_PX = 13;

// Band (categorical) y-axis for HORIZONTAL bars: one label per category at the band's
// left edge in the label margin (svg x=0), vertically centered on its band. No ticks.
// `marginLeft` is the (responsive) left gutter width; the label is pushed left by that
// amount so its `textAnchor:"start"` origin lands at svg x=0, flush with the title above.
export function tblBandYAxis(
  categories: string[],
  marginLeft: number = TBL_MARGIN_LEFT,
  fontSize: number = TBL.size.axis,
): Mark[] {
  // Wrap labels that would overflow the gutter onto multiple lines (prevents collision with the
  // bars). Labels that fit return unchanged (no "\n"), so non-wrapping output stays byte-identical.
  const maxPx = marginLeft - GUTTER_TEXT_PAD;
  const anyMultiline = categories.some((c) => wrapToWidth(c, maxPx, fontSize).includes("\n"));
  return [
    Plot.text(categories, {
      y: (d: string) => d,
      text: (d: string) => wrapToWidth(d, maxPx, fontSize),
      frameAnchor: "left",
      dx: -marginLeft,
      textAnchor: "start",
      fill: TBL.color.axis,
      fontSize,
      fontWeight: 500,
      // Center the wrapped block on the band only when multi-line (keeps single-line byte-identical).
      ...(anyMultiline ? { lineAnchor: "middle" as const } : {}),
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
  fontSize: number = TBL.size.axis,
): Mark[] {
  const rows = categories.map((c) => ({ c }));
  const maxPx = marginLeft - GUTTER_TEXT_PAD;
  const anyMultiline = categories.some((c) => wrapToWidth(c, maxPx, fontSize).includes("\n"));
  return [
    Plot.text(rows, {
      fy: (d: { c: string }) => d.c,
      text: (d: { c: string }) => wrapToWidth(d.c, maxPx, fontSize),
      frameAnchor: "left",
      dx: -marginLeft,
      textAnchor: "start",
      fill: TBL.color.axis,
      fontSize,
      fontWeight: 500,
      ...(anyMultiline ? { lineAnchor: "middle" as const } : {}),
    }),
  ];
}

// --- Sectioned horizontal category axis ---------------------------------------------------
// A sectioned category axis (columns.section) groups categories into contiguous sections along the
// `fy`/`y` band. An empty SPACER band slot is inserted before each section — it carries no data
// rows (so no bars render in it) and holds the section's bold header. The sentinel prefix uses a
// leading space so it never collides with a real category value (which the engine trims/ignores).

/** Sentinel prefix marking a section's empty spacer band slot. */
export const SECTION_SPACER_PREFIX = " section:";
/** The spacer band value for a section. */
export function sectionSpacer(section: string): string {
  return SECTION_SPACER_PREFIX + section;
}
/** Whether a band value is a section spacer sentinel (not a real category). */
export function isSectionSpacer(v: string): boolean {
  return v.startsWith(SECTION_SPACER_PREFIX);
}

// Section headers for a sectioned HORIZONTAL bar axis: a bold label left-justified at svg x=0
// (pushed left by `marginLeft` so its `textAnchor:"start"` origin lands at the canvas left edge,
// flush with the title above). Each spacer-based header is faceted on its empty spacer band slot
// (which sits ABOVE its section) and anchored to the slot's BOTTOM, then lifted `gap` px — so it
// sits a FIXED distance above its section's first bar (uniform across sections; the empty space
// above it separates this section from the previous one).
export function tblSectionHeaderYAxis(
  spacers: { value: string; label: string }[],
  marginLeft: number = TBL_MARGIN_LEFT,
  fontSize: number = TBL.size.axis,
  gap = 12,
): Mark[] {
  if (!spacers.length) return [];
  return [
    Plot.text(spacers, {
      fy: (d: { value: string }) => d.value,
      text: (d: { label: string }) => d.label,
      frameAnchor: "bottom-left",
      dx: -marginLeft,
      dy: -gap,
      textAnchor: "start",
      fill: TBL.color.heading,
      fontSize,
      fontWeight: 700,
    }),
  ];
}

// The FIRST section has no leading spacer slot (so the figure doesn't open with a big empty gap);
// its header is faceted on that section's FIRST CATEGORY and lifted up into the (enlarged) top
// margin via a negative dy, so it sits just above the section's first bar at the very top.
export function tblSectionTopHeader(
  header: { category: string; label: string },
  marginLeft: number = TBL_MARGIN_LEFT,
  lift = 14,
  fontSize: number = TBL.size.axis,
): Mark[] {
  return [
    Plot.text([header], {
      fy: (d: { category: string }) => d.category,
      text: (d: { label: string }) => d.label,
      frameAnchor: "top-left",
      dx: -marginLeft,
      dy: -lift,
      textAnchor: "start",
      fill: TBL.color.heading,
      fontSize,
      fontWeight: 700,
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
