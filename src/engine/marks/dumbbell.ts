// Dumbbell (connected dot plot) mark builder. Each category gets one dot per series joined by a
// connector "stem", so the GAP between series is the visual subject — for values that don't sum
// (e.g. current-law vs. static vs. collected effective rates), which a bar/stacked bar can't show.
//
// Structurally this is "point dots + one connector rule per category": it reuses the categorical
// band topology from bar.ts (orientation switch, horizontal left-gutter) and the dot rendering +
// per-series tagging idiom from point.ts. The generic chrome (value gridlines/axis, category
// labels for the vertical path) is added by assemblePlot; horizontal supplies its own y band +
// left-gutter category labels (signaled by yScaleOpts, exactly like horizontal bars).
import { Plot } from "../vendor";
import { TBL } from "../theme";
import { resolveColor } from "../palette";
import { ownValue } from "../../spec/own-key";
import { isHorizontalDumbbell } from "../../spec/dumbbell-orientation";
import {
  tblBandYAxis,
  tblFacetGroupYAxis,
  tblSectionTopHeader,
  SECTION_LABEL_INDENT,
  FACETED_CAT_LABEL_PX,
  CAT_LABEL_CLASS,
  sectionGapPx,
  sectionHeaderLift,
  horizontalValueAxisMargins,
} from "../axes";
import { markerInk, type MarkerInk, type MarkerStyle } from "../marker-ink";
import { bandGutter, HBAND_PADDING_INNER, HBAND_PADDING_OUTER, HDUMBBELL_BAND_PADDING, HDUMBBELL_MARGIN_BOTTOM } from "./category-band";
import type { ChartSpec, ValueFormat } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

const DEFAULT_CONNECTOR = TBL.color.annotationDim; // subtle stem behind the dots
const DEFAULT_DOT_R = 5;
// classNames so a post-render pass / test can find the connector and gap-label marks precisely
// (the connector is a rule like a gridline; the gap label is text like the axis ticks).
const CONNECTOR_CLASS = "tbl-dumbbell-connector";
const GAP_LABEL_CLASS = "tbl-dumbbell-gap";
/** A dot's outline: a hollow end's ring is drawn heavier than a filled dot's edge. */
const HOLLOW_STROKE_W = 1.5;
const FILLED_STROKE_W = 1;
const DEFAULT_CONNECTOR_W = 1.5;
/** The gap label sits this far beyond the dot radius from its stem (horizontal: above it). */
const GAP_LABEL_LIFT = 5;
const GAP_LABEL_PX = TBL.size.annotation - 0.5;
/** Plot's text mark centres a line on its y with dy 0.32em (lineAnchor "middle"). A line's glyphs
 *  are taken to span 0.8em above the baseline to 0.2em below, the em box. */
const PLOT_MIDDLE_DY_EM = 0.32;
const EM_ABOVE_BASELINE = 0.8;
const EM_BELOW_BASELINE = 0.2;

/** How far a HORIZONTAL dumbbell row's own marks reach above and below the row's centre line (px),
 *  from the placement below: the dots (radius `dot_radius`, plus half the widest outline), the
 *  connector (half its width), and with `gap_annotation` the gap label, lifted `r + GAP_LABEL_LIFT`
 *  above the stem. The height model (figure.ts) floors a fitted row pitch on it, so neighbouring
 *  rows' dots and labels cannot meet. */
export function dumbbellRowExtent(spec: ChartSpec): { above: number; below: number } {
  const r = spec.dot_radius ?? DEFAULT_DOT_R;
  const anyHollow = Object.values(spec.series_marker ?? {}).includes("hollow");
  const dot = r + (anyHollow ? HOLLOW_STROKE_W : FILLED_STROKE_W) / 2;
  const half = Math.max(dot, (spec.connector?.width ?? DEFAULT_CONNECTOR_W) / 2);
  if (!spec.gap_annotation) return { above: half, below: half };
  const baseline = -(r + GAP_LABEL_LIFT) + PLOT_MIDDLE_DY_EM * GAP_LABEL_PX;
  return {
    above: Math.max(half, -(baseline - EM_ABOVE_BASELINE * GAP_LABEL_PX)),
    below: Math.max(half, baseline + EM_BELOW_BASELINE * GAP_LABEL_PX),
  };
}

/** `{value}`-style number formatter for gap labels (pure — no locale, so goldens stay byte-stable). */
function fmtValue(v: number, f: ValueFormat | undefined): string {
  const decimals = f?.decimals ?? 1;
  return `${f?.prefix ?? ""}${v.toFixed(decimals)}${f?.suffix ?? ""}`;
}

export function buildDumbbellMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, colors } = ctx;
  const catField = xField; // "_xc" for the categorical axis
  const seriesNames = ctx.seriesNames ?? [];
  // Orientation defaults to horizontal (categories on screen-y) — long income-group labels read
  // best down the left gutter.
  const horizontal = isHorizontalDumbbell(spec);
  const catFont = horizontal ? FACETED_CAT_LABEL_PX : TBL.size.axis;
  const r = spec.dot_radius ?? DEFAULT_DOT_R;

  // Category (band) domain in data-encounter order — declaration/`category_order` is authoritative
  // (the pane already sorted dataInScope by category order upstream).
  const categories: string[] = [];
  {
    const seen = new Set<string>();
    for (const row of data) {
      const c = (row as unknown as Record<string, unknown>)[catField] as string | undefined;
      if (typeof c === "string" && c !== "" && !seen.has(c)) {
        seen.add(c);
        categories.push(c);
      }
    }
  }

  // --- Sections (horizontal only) — fy-facet topology + placement identical to horizontal bars
  // (tblSectionTopHeader: first header in the top margin, the rest lifted above their first row,
  // with balanced whitespace). The gap-mask + header halo (below) keep the gridlines from crossing
  // the headers. ---
  const sectioned = horizontal && data.some((r) => r._section != null);
  let bandDomain: string[] = categories;
  const sectionHeaders: { category: string; label: string }[] = [];
  let topSectionHeader: { category: string; label: string } | null = null;
  if (sectioned) {
    const sectionOf = new Map<string, string>();
    for (const row of data) {
      const cat = (row as unknown as Record<string, unknown>)[catField] as string | undefined;
      if (cat && row._section != null && !sectionOf.has(cat)) sectionOf.set(cat, row._section);
    }
    const seenSec = new Set<string>();
    const encountered: string[] = [];
    for (const cat of categories) {
      const s = sectionOf.get(cat) ?? "";
      if (!seenSec.has(s)) { seenSec.add(s); encountered.push(s); }
    }
    const order = spec.section_order?.length ? spec.section_order.filter((s) => seenSec.has(s)) : encountered;
    const labelOf = (s: string): string => ownValue(spec.section_labels, s) ?? s;
    const domain: string[] = [];
    for (const s of order) {
      const cats = categories.filter((cat) => (sectionOf.get(cat) ?? "") === s);
      if (!cats.length) continue;
      if (domain.length === 0) {
        topSectionHeader = { category: cats[0] as string, label: labelOf(s) };
      } else {
        sectionHeaders.push({ category: cats[0] as string, label: labelOf(s) });
      }
      for (const cat of cats) domain.push(cat);
    }
    bandDomain = domain;
  }

  // --- Marker styling, per series. The INK comes from marker-ink.ts, which the legend/tooltip/export
  // icons read too, so a key cannot describe a different middle from the dot it names — a hollow end
  // is a HOLE (the stem shows through) and only the shared description says so. The WIDTH stays here:
  // it belongs to this chart's geometry, not to the ink.
  const markerOf = (s: string): MarkerStyle => ownValue(spec.series_marker, s) ?? "filled";
  const seriesColor = (s: string): string => colors.get(s) || TBL.color.blue;
  const inkFor = (s: string): MarkerInk => markerInk(markerOf(s), seriesColor(s));
  const fillFor = (s: string): string => inkFor(s).fill;
  const strokeFor = (s: string): string => inkFor(s).stroke;
  const strokeWidthFor = (s: string): number => (markerOf(s) === "hollow" ? HOLLOW_STROKE_W : FILLED_STROKE_W);

  // --- Connector stems: per category, span min→max of that category's present dots ---
  // A single dot (or exactly-coincident dots) has no gap to span, so no stem is drawn there.
  const conn = categories
    .map((cat) => {
      const vals = data
        .filter(
          (d) =>
            (d as unknown as Record<string, unknown>)[catField] === cat &&
            Number.isFinite(d._y as number),
        )
        .map((d) => d._y as number);
      return { cat, lo: vals.length ? Math.min(...vals) : 0, hi: vals.length ? Math.max(...vals) : 0, n: vals.length };
    })
    .filter((c) => c.n >= 2 && c.lo !== c.hi);

  const connCfg = spec.connector ?? {};
  const connColor = connCfg.color ? resolveColor(connCfg.color) ?? DEFAULT_CONNECTOR : DEFAULT_CONNECTOR;
  const connWidth = connCfg.width ?? DEFAULT_CONNECTOR_W;
  const connDash =
    connCfg.style === "dashed" ? "5 3" : connCfg.style === "dotted" ? "1 3" : undefined;
  // Category-axis binding. Sectioned horizontal puts each category on an `fy` facet row with a
  // single inner-y slot — the bar section topology, section gaps included.
  // Otherwise the category is the plain band (y for horizontal, x for vertical). Sections and
  // small-multiples panes both want `fy`, so they are mutually exclusive (sectioned → no panes).
  const SINGLE_SLOT = "_v";
  const bandBind = (field: string): Record<string, unknown> =>
    sectioned ? { fy: field, y: () => SINGLE_SLOT } : horizontal ? { y: field } : { x: field };

  // Truncated value axis (see assemblePaneResult's clip gate): clip the dots + stems to the frame.
  // Reachable here more easily than on other types, because a dumbbell fits its data instead of
  // forcing a zero baseline, so an author-set yAxisPolicy min/max is ordinary. Gap labels stay
  // unclipped — a half-cut number is worse than one sitting past the axis.
  const clipOpt = ctx.clipMarks ? { clip: true as const } : {};

  const connOpts = {
    stroke: connColor,
    strokeWidth: connWidth,
    className: CONNECTOR_CLASS,
    ...(connDash ? { strokeDasharray: connDash } : {}),
    ...clipOpt,
  };

  const underlay: unknown[] = [];
  if (conn.length) {
    underlay.push(
      horizontal
        ? Plot.ruleY(conn, { ...bandBind("cat"), x1: "lo", x2: "hi", ...connOpts })
        : Plot.ruleX(conn, { x: "cat", y1: "lo", y2: "hi", ...connOpts }),
    );
  }

  // --- Dots: one mark, all series; per-datum fill/stroke keyed off each series' marker style. ---
  // Filter to finite values, then draw in SERIES order (series-major, category order within) so the
  // z-order is consistent everywhere: the first series is drawn first (bottom), the last on top —
  // regardless of the incoming row grouping. Keeps overlapping dots stacked the same in every
  // category. The tagging DOM order reads `dotData`, so it stays aligned.
  const seriesRank = new Map(seriesNames.map((s, i) => [s, i]));
  const catRank = new Map(categories.map((c, i) => [c, i]));
  const dotData = data
    .filter((d) => Number.isFinite(d._y as number))
    .slice()
    .sort((a, b) => {
      const sr = (seriesRank.get(a.series) ?? 0) - (seriesRank.get(b.series) ?? 0);
      if (sr !== 0) return sr;
      const ac = (a as unknown as Record<string, string>)[catField] ?? "";
      const bc = (b as unknown as Record<string, string>)[catField] ?? "";
      return (catRank.get(ac) ?? 0) - (catRank.get(bc) ?? 0);
    });
  const dotOpts = {
    ...bandBind(catField),
    ...(horizontal ? { x: "_y" } : { y: "_y" }),
    fill: (d: PreparedRow) => fillFor(d.series),
    stroke: (d: PreparedRow) => strokeFor(d.series),
    strokeWidth: (d: PreparedRow) => strokeWidthFor(d.series),
    r,
    ...clipOpt,
  };
  const overlay: unknown[] = [Plot.dot(dotData, dotOpts)];

  // --- Optional gap annotation: label |value(a) − value(b)| on each stem. ---
  const gap = spec.gap_annotation;
  if (gap) {
    const seriesA = gap === true ? seriesNames[0] : gap.series_a;
    const seriesB = gap === true ? seriesNames[1] : gap.series_b;
    const gapFmt = (gap === true ? undefined : gap.format) ?? spec.value_format;
    if (seriesA && seriesB) {
      const valueAt = (cat: string, s: string): number | undefined => {
        const row = data.find(
          (d) => (d as unknown as Record<string, unknown>)[catField] === cat && d.series === s,
        );
        return Number.isFinite(row?._y as number) ? (row!._y as number) : undefined;
      };
      // Place the label at the connector MIDPOINT (between the two dots), offset perpendicular to
      // the stem, so it reads as a span annotation of the GAP — not as a point value competing with
      // the value axis. Prefixed with a Δ so a small delta (e.g. "Δ1.7pp") isn't mistaken for a rate.
      const gapRows = categories
        .map((cat) => {
          const a = valueAt(cat, seriesA);
          const b = valueAt(cat, seriesB);
          if (a == null || b == null || a === b) return null;
          return { cat, mid: (a + b) / 2, text: `Δ${fmtValue(Math.abs(a - b), gapFmt)}` };
        })
        .filter((g): g is { cat: string; mid: number; text: string } => g != null);
      if (gapRows.length) {
        const common = {
          text: (d: { text: string }) => d.text,
          fill: TBL.color.muted,
          fontSize: GAP_LABEL_PX,
          fontWeight: 600,
          className: GAP_LABEL_CLASS,
        };
        overlay.push(
          horizontal
            ? Plot.text(gapRows, { ...bandBind("cat"), ...common, x: "mid", textAnchor: "middle", dy: -(r + GAP_LABEL_LIFT) })
            : Plot.text(gapRows, { ...common, x: "cat", y: "mid", textAnchor: "start", dx: r + GAP_LABEL_LIFT }),
        );
      }
    }
  }

  // Resolved series → legend swatch color (ink dots read as ink; hollow/filled read as the series
  // color — the hollow ring is rendered by the legend, task 5). Source of truth for the legend.
  const seriesColors = new Map<string, string>();
  // An ink dot keys as ink; a hollow one keys as its series colour, which is what its RING is painted.
  for (const s of seriesNames) seriesColors.set(s, markerOf(s) === "ink" ? markerInk("ink", "").fill : seriesColor(s));

  // Tag each dot with BOTH its series (legend hover/pin) and its category (so the live hover /
  // coordinated cursor can resolve which category band the pointer is over, from the dots).
  const dotTagging = {
    selector: 'g[aria-label="dot"] circle',
    seriesOrder: dotData.map((d) => d.series),
    categoryOrder: dotData.map((d) => (d as unknown as Record<string, string>)[catField] ?? ""),
  };

  if (horizontal) {
    const gutter = bandGutter(categories, catFont, sectioned);

    if (sectioned) {
      // fy-facet topology (identical to horizontal bars): category band on `fy`, a single inner-y
      // slot for the dots, value on `x`. Headers + labels, the header lift, the section gap and the
      // top margin come from the same shared helpers the bar builders use (category-band.ts).
      const topHeaderLift = sectionHeaderLift(catFont);
      const hMarginTop = horizontalValueAxisMargins(undefined, {
        sectioned: true,
        ...(topSectionHeader ? { topHeaderLift } : {}),
      }).marginTop;
      // With fy faceting Plot emits dots facet-by-facet (category order), series within — so tag in
      // that order, not the series-major draw order used for the flat band.
      const tagOrder = categories.flatMap((cat) =>
        dotData.filter((d) => (d as unknown as Record<string, string>)[catField] === cat),
      );
      // The section gap is cleared by BREAKING the continuous value gridlines/baseline across it
      // (assemble-plot's collapseFacetChromeY, from the gaps spreadSections opens) — so no mask is
      // needed and the header sits in genuinely empty space.
      return {
        underlay,
        overlay,
        tagging: [
          { selector: 'g[aria-label="dot"] circle', seriesOrder: tagOrder.map((d) => d.series), categoryOrder: tagOrder.map((d) => (d as unknown as Record<string, string>)[catField] ?? "") },
          { selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [] as string[], categoryOrder: categories },
        ],
        dashedNames: new Set<string>(),
        yScaleOpts: { type: "band", domain: [SINGLE_SLOT], padding: 0, axis: null },
        fyScaleOpts: { domain: bandDomain, paddingInner: HBAND_PADDING_INNER, paddingOuter: HBAND_PADDING_OUTER, align: 0, axis: null },
        ...(sectionHeaders.length
          ? { sectionGaps: { before: sectionHeaders.map((h) => h.category), px: sectionGapPx(catFont) } }
          : {}),
        xAxisMarks: [
          ...tblFacetGroupYAxis(categories, gutter, catFont, SECTION_LABEL_INDENT),
          ...sectionHeaders.flatMap((h) => tblSectionTopHeader(h, gutter, topHeaderLift, catFont)),
          ...(topSectionHeader ? tblSectionTopHeader(topSectionHeader, gutter, topHeaderLift, catFont) : []),
        ],
        marginLeft: gutter,
        marginTop: hMarginTop,
        marginBottom: 26,
        seriesColors,
      };
    }

    // Non-sectioned horizontal: plain category band on `y`, value on `x`.
    return {
      underlay,
      overlay,
      tagging: [
        dotTagging,
        { selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [] as string[], categoryOrder: categories },
      ],
      dashedNames: new Set<string>(),
      yScaleOpts: { type: "band", domain: bandDomain, padding: HDUMBBELL_BAND_PADDING, axis: null },
      xAxisMarks: tblBandYAxis(categories, gutter, catFont),
      marginLeft: gutter,
      // One value-tick row. Left to the categorical x adapter, this was the VERTICAL category-label
      // margin, which grows to fit wrapped or rotated labels the horizontal chart never draws there.
      marginBottom: HDUMBBELL_MARGIN_BOTTOM,
      seriesColors,
    };
  }

  return {
    underlay,
    overlay,
    tagging: [
      dotTagging,
      { selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [], categoryOrder: categories },
    ],
    dashedNames: new Set<string>(),
    // Category band on `x`; adapter labels the categories (xAxisMarks left undefined). Slightly
    // larger outer pad so end dots don't kiss the frame.
    xScaleOpts: { paddingInner: 0.2, paddingOuter: 0.3 },
    seriesColors,
  };
}
