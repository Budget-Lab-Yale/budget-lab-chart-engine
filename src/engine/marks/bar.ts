// Bar chart mark builder. Produces single-series and grouped (multi-series) bars,
// vertical (default) or horizontal, with optional highlight/dim. (In-bar value labels were
// removed — their style no longer fit the design.) The generic chrome (gridlines, y-labels,
// zero baseline) is added by assemblePlot.
//
// Grouped HORIZONTAL bars mirror the vertical grouped idiom with the axes swapped: `fy` =
// group (category, row facets), `y` = series within group (band), `x` = value, via barX.
// assemblePlot collapses the per-facet chrome (continuous vertical gridlines + one
// value-axis label row) for the fy case (signaled by fyScaleOpts).
//
// Category-label homing (see task A6 sec A/B): single-series VERTICAL bars put categories
// on the `x` band scale, so the adapter's `tblBandXAxis(.., "x")` labels them and this
// builder leaves `xAxisMarks` undefined. Grouped bars use Plot's faceting idiom (`fx` =
// group, `x` = series within group), so categories live on `fx`; this builder supplies its
// own `xAxisMarks` (group labels on `fx`) which assemblePlot uses INSTEAD of the adapter's.
// Horizontal single-series puts categories on a band `y` (the value axis moves to `x`).
import { Plot } from "../vendor";
import { TBL } from "../theme";
import { resolveColor } from "../palette";
import { ownValue } from "../../spec/own-key";
import { categoryText } from "../../spec/section-key";
import {
  tblBandXAxis,
  tblBandYAxis,
  horizontalLeftGutter,
  horizontalValueAxisMargins,
  FACETED_CAT_LABEL_PX,
  CAT_LABEL_CLASS,
} from "../axes";
import { categoryBand, fyCategoryBandLayer as composeFyCategoryBand, HBAND_PADDING_OUTER } from "./category-band";
import { SHARED_LABELLESS_MARGIN_LEFT } from "../theme";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

// Below this, bars are so dense the chart is out of spec for grouped bars; warn (no throw).
const TOO_DENSE_PX = 10;

/** The series, in the order Plot emits faceted grouped-bar <rect>s: by facet (the category
 *  band, in `categories` = fx/fy-domain render order), and WITHIN each facet by DATA-ROW order
 *  (Plot renders one rect per datum in input order, not inner-band order). Used to map each rect
 *  to its `data-series` so legend hover/pin dims the correct bars. */
function rectTagOrder(
  data: PreparedRow[],
  catField: string,
  categories: string[],
): string[] {
  const order: string[] = [];
  for (const cat of categories) {
    for (const r of data) {
      if ((r as unknown as Record<string, unknown>)[catField] === cat) order.push(r.series);
    }
  }
  return order;
}

export function buildBarMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, colors } = ctx;
  const catField = xField;
  const seriesNames = ctx.seriesNames ?? [];
  const horizontal = spec.orientation === "horizontal";
  // HORIZONTAL bars (faceted AND standalone) use the larger "faceted best practice" category-label
  // font — task 17 brings standalone up to the faceted look, so this is no longer gated on
  // ctx.pane. Vertical is unchanged (no faceted/standalone gap there — both are TBL.size.axis).
  const catFont = horizontal ? FACETED_CAT_LABEL_PX : TBL.size.axis;
  // Truncated (non-zero baseline) bars are drawn from 0 and would overflow below the plot; clip
  // them to the frame. No-op (and byte-identical) for normal zero-baseline bars.
  const clipOpt = ctx.clipMarks ? { clip: true as const } : {};
  const isMulti = seriesNames.length > 1;

  // Category (group) domain in data-encounter order - declaration order is authoritative.
  const categories: string[] = [];
  {
    const seen = new Set<string>();
    for (const r of data) {
      const cat = (r as unknown as Record<string, unknown>)[catField] as string | undefined;
      if (typeof cat === "string" && cat !== "" && !seen.has(cat)) {
        seen.add(cat);
        categories.push(cat);
      }
    }
  }

  // Sectioned horizontal category axis (columns.section): categories grouped by section, with
  // spacer slots for the headers (see category-band.ts). Vertical / unsectioned: the plain band.
  const band = categoryBand(data, catField, categories, spec, horizontal);
  const { sectioned, bandDomain } = band;

  // Render-order category list for the hover-accent label hook (data-category tagging, below):
  // for the fy topology (sectioned and/or multi-series horizontal), Plot iterates the fy facet
  // DOMAIN — bandDomain, section-grouped — when placing this mark's <text> children in the DOM,
  // NOT the (encounter-order) `categories` array passed to Plot.text; the tagging pass reads DOM
  // order, so it must match. Equals `categories` when unsectioned (bandDomain has no spacers then).
  const catLabelOrder = band.drawnOrder;
  // Tagging entry for the hover-accent hook: stamps data-category on each rendered category label
  // (in render order, see catLabelOrder above) so the live layer can find + accent the hovered
  // one without matching on textContent. Empty when labels are suppressed (hideCategoryLabels —
  // non-leftmost faceted panes): no label marks are emitted there, so nothing to tag.
  const catLabelTagging = ctx.hideCategoryLabels
    ? []
    : [{ selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [] as string[], categoryOrder: catLabelOrder }];

  // Horizontal value-axis margins for the unsectioned single-series path (the fy paths take theirs
  // from fyCategoryBandLayer, which adds the section-header floor).
  const { marginTop: hMarginTop, marginBottom: hMarginBottom } = horizontalValueAxisMargins(spec.x_axis_ticks);

  // Highlight/dim: literal fill accessor (not the color scale) so non-highlighted series
  // collapse to annotationDim regardless of their palette slot. Used sparingly per spec.
  const highlightSet =
    spec.highlightSeries && spec.highlightSeries.length
      ? new Set(spec.highlightSeries)
      : null;
  const fillFor = (series: string): string => {
    if (highlightSet) {
      return highlightSet.has(series)
        ? colors.get(series) || TBL.color.blue
        : TBL.color.annotationDim;
    }
    return colors.get(series) || TBL.color.blue;
  };

  // Bar-density sanity check: estimate per-bar px width from the band axis length + bar count and
  // warn (never throw) when bars get too thin to read. Vertical: bars live along plotWidth;
  // horizontal: along plotHeight.
  const nGroups = Math.max(1, categories.length);
  const nSeries = Math.max(1, isMulti ? seriesNames.length : 1);
  const bandAxisPx = (horizontal ? ctx.plotHeight : ctx.plotWidth) ?? 0;
  const estBarPx = bandAxisPx > 0 ? (bandAxisPx / (nGroups * nSeries)) * 0.8 : Infinity;
  if (Number.isFinite(estBarPx) && estBarPx < TOO_DENSE_PX) {
    console.warn(
      `buildBarMarks: estimated bar width ~${estBarPx.toFixed(1)}px is below ${TOO_DENSE_PX}px; ` +
        `chart is too dense for grouped bars (consider a line chart or fewer series).`,
    );
  }

  // --- Shared fy-topology layer pieces (horizontal charts whose CATEGORY band lives on `fy`
  // row facets: multi-series grouped — sectioned or not — AND single-series sectioned). One
  // composition point (category-band.ts, shared with sectioned stacks) for the fy category-band
  // scale and the left-gutter axis marks, so the paths can never drift apart again — a fix landing
  // on one path while its sibling kept a hand-copied variant is exactly the shape that produced
  // the original phantom-facet defect (D1). `gutter` is the caller's resolved left-gutter width.
  const fyCategoryBandLayer = (
    gutter: number,
  ): Pick<MarkLayers, "fyScaleOpts" | "xAxisMarks" | "marginLeft" | "marginTop" | "marginBottom"> =>
    composeFyCategoryBand(band, { gutter, catFont, hideLabels: ctx.hideCategoryLabels === true, xAxisTicks: spec.x_axis_ticks });

  const overlay: unknown[] = [];

  if (!isMulti) {
    // --- Single-series: categories on a band scale, no faceting. ---
    // `bar_color` (task 7): the single-series bar fill, resolved through the palette. A
    // first-class replacement for the `series_colors: {"": color}` idiom (already folded into
    // `colors`/`fillFor` above), overriding it when set. It replaces the BASE color only —
    // highlight/dim still applies on top: a non-highlighted series dims to annotationDim
    // regardless of bar_color.
    const barColorOverride = resolveColor(spec.bar_color);
    // Inline-selector accent (ctx.accentColor): when a colored title selector is in force, the
    // active option's color becomes the bar fill, winning over bar_color/default so the bars match
    // the tinted selector label. `category_colors` still overrides per-category (applied below,
    // outside baseFill). Absent → byte-identical to before. Highlight-dim still wins on top.
    const accentFill = ctx.accentColor;
    const singleFillFor = (series: string): string => {
      if (highlightSet && !highlightSet.has(series)) return TBL.color.annotationDim;
      return accentFill ?? barColorOverride ?? fillFor(series);
    };
    // Constant vs. accessor matters at the SVG level: Plot hoists a constant fill onto the parent
    // <g aria-label="bar">, while a function channel emits a per-<rect> fill attribute. Preserve
    // the ORIGINAL decision shape (accessor iff highlightSet, else constant) so any spec that
    // doesn't use the new fields renders byte-identical SVG; bar_color slots into both arms.
    const baseFill = highlightSet
      ? (d: PreparedRow) => singleFillFor(d.series)
      : seriesNames.length === 1
        ? singleFillFor(seriesNames[0] as string)
        : accentFill ?? barColorOverride ?? TBL.color.blue;

    // `category_colors` (task 7): per-x-category fill override, resolved through the palette.
    // Single-series scope only (see ChartSpec.category_colors TSDoc) — this whole branch is the
    // single-series path, so no series-fill precedence question arises. Presence forces a
    // per-datum fill accessor; named categories get their color, all others fall through to the
    // base/highlight logic above.
    const categoryColorMap: Record<string, string> | null = spec.category_colors
      ? Object.fromEntries(
          Object.entries(spec.category_colors).map(([k, v]) => [k, resolveColor(v) as string]),
        )
      : null;

    const fill = categoryColorMap
      ? (d: PreparedRow) => {
          const cat = (d as unknown as Record<string, unknown>)[catField] as string | undefined;
          // A bare name colours that category in every section (spec/section-key.ts).
          const override = cat != null ? ownValue(categoryColorMap, categoryText(cat)) : undefined;
          if (override != null) return override;
          return typeof baseFill === "function" ? baseFill(d) : baseFill;
        }
      : baseFill;

    // Sectioned horizontal (any series count): route onto the SAME fy topology the multi-series
    // sectioned path uses (below, ~L310): fy = category band (incl. spacer slots), inner y = a
    // single-value series band, x = value. An UNfaceted single-series mark that still carries
    // fy-bound header marks (tblSectionTopHeader, pushed below) makes Plot
    // auto-facet the WHOLE plot from those header marks alone — a spurious fy domain derived from
    // the spacer sentinels + first category (2-3 phantom facets), which starves every real bar's
    // height and prints the raw " section:" sentinel as Plot's default fy-axis text (the
    // fig09/fig10 defect, D1). Keeping every sectioned horizontal chart on fy, regardless of
    // series count, means the header marks are always correct for the topology Plot actually uses.
    overlay.push(
      horizontal && sectioned
        ? Plot.barX(data, { fy: xField, y: "series", x: "_y", fill, ...clipOpt })
        : horizontal
          ? Plot.barX(data, { y: xField, x: "_y", fill, ...clipOpt })
          : Plot.barY(data, { x: xField, y: "_y", fill, ...clipOpt }),
    );

    // Rect tagging: Plot emits one <rect> per category in band-domain order (it does not
    // omit rects for null values - it renders them at zero length), so the order is simply
    // the (single) series name repeated once per category.
    const onlySeries = (seriesNames[0] as string) ?? (data[0]?.series ?? "");
    const seriesOrder: string[] = categories.map(() => onlySeries);

    if (horizontal) {
      // Categories on the band `y`; value on `x` (assemblePlot moves the value domain to
      // `x` when yScaleOpts is present). Supply the y band + its left-edge labels, and a
      // responsive left gutter wide enough for the longest category label (else it clips).
      // Faceted horizontal small multiples: the figure passes the shared gutter (categoryGutter)
      // so every pane aligns, and hideCategoryLabels suppresses the labels on non-leftmost panes
      // (the band domain is shared, so rows still line up).
      const gutter = ctx.hideCategoryLabels
        ? SHARED_LABELLESS_MARGIN_LEFT
        : ctx.categoryGutter ?? horizontalLeftGutter(categories, { fontSize: catFont });

      if (sectioned) {
        // fy = the section-grouped category band (incl. spacer slots) via the SHARED
        // fyCategoryBandLayer — the same composition the multi-series path uses below; inner
        // y = a single-value series band (padding 0, so the bar fills the whole facet —
        // geometrically equivalent to the old plain-y band's paddingInner:0.2, which now
        // lives on fy INSTEAD, between facets).
        return {
          underlay: [],
          overlay,
          tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder, fill: true }, ...catLabelTagging],
          dashedNames: new Set<string>(),
          yScaleOpts: { type: "band", domain: [onlySeries], padding: 0, axis: null },
          ...fyCategoryBandLayer(gutter),
        };
      }

      return {
        underlay: [],
        overlay,
        tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder, fill: true }, ...catLabelTagging],
        dashedNames: new Set<string>(),
        yScaleOpts: { type: "band", domain: bandDomain, paddingInner: 0.2, paddingOuter: HBAND_PADDING_OUTER, align: 0, axis: null },
        // This is the NON-sectioned single-series horizontal path (sectioned routes to fy above),
        // so there are no section headers to place here — just the plain category labels.
        xAxisMarks: ctx.hideCategoryLabels ? [] : tblBandYAxis(categories, gutter, catFont),
        marginLeft: gutter,
        marginTop: hMarginTop,
        marginBottom: hMarginBottom,
      };
    }

    return {
      underlay: [],
      overlay,
      tagging: [
        { selector: 'g[aria-label="bar"] rect', seriesOrder, fill: true },
        // Vertical single-series: the adapter (x-adapter.ts) supplies the category label marks
        // (xAxisMarks left undefined below), tagged with CAT_LABEL_CLASS there — encounter order
        // (non-faceted single band), matching `categories`.
        { selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [], categoryOrder: categories },
      ],
      dashedNames: new Set<string>(),
      // Refine the adapter's band x with a slightly larger outer pad so bars do not kiss
      // the frame. (Adapter set type:band/domain/axis already.)
      xScaleOpts: { paddingInner: 0.2, paddingOuter: 0.2 },
      // xAxisMarks/xScaleField left undefined -> adapter labels categories on `x`.
    };
  }

  // Highlight/dim overrides the fill channel with a literal accessor.
  const fillChannel = highlightSet ? (d: PreparedRow) => fillFor(d.series) : "series";

  // --- Multi-series grouped, HORIZONTAL: fy = group (category, row facets), y = series
  //     within group (band), x = value (_y), via barX. Mirrors the vertical grouped idiom
  //     (fx→fy, x-band→y-band, barY→barX). assemblePlot runs the fy facet-chrome collapse
  //     (continuous full-height vertical gridlines + one value-axis label row). ---
  if (horizontal) {
    overlay.push(Plot.barX(data, { fy: catField, y: "series", x: "_y", fill: fillChannel, ...clipOpt }));

    // --- Rect tagging order (horizontal grouped) ---
    // Plot emits one <rect> PER DATUM, partitioned by the fy facet (rendered in fy-domain =
    // `categories` order) and, WITHIN a facet, in DATA-ROW order — NOT inner-band order. So the
    // tag order must follow the data, grouped by category in facet order. (Using the series-band
    // order misaligns whenever a category's rows aren't in seriesNames order — the cause of the
    // legend→bar highlight mismatch.)
    const hRectSeriesOrder = rectTagOrder(data, catField, categories);

    // Group band on `fy` via the SHARED fyCategoryBandLayer (declaration order; never
    // auto-sort — Style-Guide §9). Inner series band on `y`: domain in series order,
    // padding 0 so bars touch within the group.
    const innerYBandOpts = { type: "band", domain: seriesNames, padding: 0, axis: null };

    // Faceted horizontal small multiples: use the shared gutter from the figure (so panes align)
    // and suppress category labels on non-leftmost panes.
    const gutter = ctx.hideCategoryLabels
      ? SHARED_LABELLESS_MARGIN_LEFT
      : ctx.categoryGutter ?? horizontalLeftGutter(categories, { fontSize: catFont });
    return {
      underlay: [],
      overlay,
      tagging: [
        { selector: 'g[aria-label="bar"] rect', seriesOrder: hRectSeriesOrder, fill: true },
        ...catLabelTagging,
      ],
      dashedNames: new Set<string>(),
      yScaleOpts: innerYBandOpts,
      ...fyCategoryBandLayer(gutter),
    };
  }

  // --- Multi-series grouped (vertical): fx = group (category), x = series within group. ---

  overlay.push(Plot.barY(data, { fx: catField, x: "series", y: "_y", fill: fillChannel, ...clipOpt }));

  // --- Rect tagging order ---
  // Plot emits one <rect> PER DATUM, partitioned by the fx facet (rendered in fx-domain =
  // `categories` order) and, WITHIN a facet, in DATA-ROW order — NOT inner x-band order. So the
  // tag order must follow the data, grouped by category in facet order. (Using the series-band
  // order misaligns whenever a category's rows aren't in seriesNames order — the cause of the
  // legend→bar highlight mismatch.)
  const rectSeriesOrder = rectTagOrder(data, catField, categories);

  // Group band (fx): explicit domain in data-declaration order (Style-Guide sec 9: never
  // auto-sort groups; Plot would otherwise sort the fx domain alphabetically). Inter-group
  // padding, equalized outer pads, no axis (groups are labeled via xAxisMarks). Inner
  // series band: domain in series order, padding 0 so bars touch within the group.
  const groupBandOpts = { domain: categories, padding: 0.2, paddingOuter: 0.2, axis: null };
  const innerBandOpts = { domain: seriesNames, padding: 0, axis: null };

  return {
    underlay: [],
    overlay,
    tagging: [
      { selector: 'g[aria-label="bar"] rect', seriesOrder: rectSeriesOrder, fill: true },
      // Vertical grouped: this builder supplies its own fx-faceted category labels below (always
      // tagged with CAT_LABEL_CLASS, the "fx" call never conflicts with a grid-collapse class —
      // see tblBandXAxis) — fx-domain order, matching `categories`.
      { selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [], categoryOrder: categories },
    ],
    dashedNames: new Set<string>(),
    fxScaleOpts: groupBandOpts,
    xScaleOpts: innerBandOpts,
    xScaleField: "fx",
    xAxisMarks: tblBandXAxis(categories, "fx", undefined, ctx.xLabelMode ?? "single", true),
  };
}

