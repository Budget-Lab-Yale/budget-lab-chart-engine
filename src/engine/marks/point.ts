// Point mark builder, shared by the `scatter` (numeric x) and `dotplot` (categorical x) chart
// types. Each datum is a marker at (x, y); COLOR encodes the `series` field and marker SHAPE
// encodes the independent `_shape` field (from columns.shape). The two channels are independent
// — point both at the same column for redundant color+shape encoding (the dot-plot default).
// The generic chrome (gridlines, axes, zero baseline) is added by assemblePlot.
import { Plot } from "../vendor";
import { markerSymbolForIndex, MARK_POINT_R, MARK_POINT_PANE_R } from "../theme";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

/** Per-series horizontal dodge offset (px) for a categorical dot plot, centered on the band.
 *  Shared by the mark builder (to offset the markers) and the coordinated cursor (to place its
 *  dots/labels over the actual dodged points). Panes dodge slightly tighter than single charts. */
export function pointDodgeOffsets(seriesNames: string[], pane: boolean): Map<string, number> {
  const gap = pane ? 14 : 18;
  const mid = (seriesNames.length - 1) / 2;
  return new Map(seriesNames.map((s, i) => [s, (i - mid) * gap]));
}

export function buildPointMarks(
  data: PreparedRow[],
  _spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, fxField, fyField, shapeField, shapeNames, shapeIsSeries } = ctx;

  // Shared-mode small multiples: bind fx/fy so each mark faces into the grid. Absent → single frame.
  const facetChannels = fxField && fyField ? { fx: fxField, fy: fyField } : {};

  // A shape channel is active when columns.shape resolved to a field. Without it, every point is
  // a single shape (Plot's default circle) and no symbol scale / shape legend is emitted.
  const hasShape = !!shapeField;

  // Symbol scale: distinct marker per shape value, in MARKER_SYMBOLS order. When shape encodes
  // the same field as color (redundant), key the domain off series identity so the chart symbols
  // line up with the combined legend's per-series symbols.
  let symbolScaleOpts: { domain: string[]; range: string[] } | undefined;
  if (hasShape) {
    const domain = (shapeIsSeries ? ctx.seriesNames : shapeNames) ?? shapeNames ?? [];
    symbolScaleOpts = {
      domain,
      range: domain.map((_, i) => markerSymbolForIndex(i)),
    };
  }

  // ONE list feeds the mark, the `data-series`/`data-shape` tagging and the hover point array, so
  // they cannot disagree about which row is the i-th marker. They used to be built from the
  // unfiltered rows while Plot rendered fewer markers than that, which silently shifted every
  // marker after a gap onto the wrong row — wrong legend dimming, wrong texture, wrong tooltip.
  // Two things drop a row, and both are legal author input, not errors:
  //   - a blank value (mirrored by `defined` in dotOpts below, kept there for Plot's own filtering)
  //   - a shape value the author left out of `shape_order`, hence out of the symbol domain
  // Both are mirrored by validateChartData's keyed-callout "drawn nowhere" rules
  // (src/spec/validate.ts), which refuse a `point:` callout keyed to a row this filter drops —
  // change both.
  const symbolDomain = symbolScaleOpts ? new Set(symbolScaleOpts.domain) : null;
  const rendered = data.filter(
    (d) => Number.isFinite(d._y) && (!symbolDomain || symbolDomain.has(d._shape ?? "")),
  );

  // Marker radius. Dot plots (and other faceted point panes) use a larger marker so the data
  // dots read close to the ~11px legend symbols; single-frame scatters stay a touch smaller.
  const r = ctx.pane ? MARK_POINT_PANE_R : MARK_POINT_R;

  // Categorical x (dotplot) with multiple series: dodge each series horizontally within its
  // category so markers sit side by side instead of stacking at the band center. Plot's `dx` is a
  // CONSTANT pixel offset per mark (not a per-datum channel), so we emit one dot mark PER SERIES,
  // each with its own constant `dx` centered on the category. Numeric scatter never dodges.
  const categorical = xField === "_xc";
  const seriesNames = ctx.seriesNames ?? [];
  const dodge = categorical && seriesNames.length > 1;

  const dotOpts = (extra: Record<string, unknown>): Record<string, unknown> => ({
    x: xField,
    y: "_y",
    fill: "series",
    ...(hasShape ? { symbol: shapeField } : {}),
    r,
    stroke: "#ffffff",
    strokeWidth: 1,
    defined: (d: PreparedRow) => Number.isFinite(d._y),
    ...facetChannels,
    // Truncated value axis (see assemblePaneResult's clip gate): an out-of-range point would
    // otherwise land outside the frame, or off the canvas entirely.
    ...(ctx.clipMarks ? { clip: true as const } : {}),
    ...extra,
  });

  // `taggedData` is the marker DOM order (data order, or per-series-concatenated when dodging) so
  // the post-render data-series tagging maps each <path>/<circle> to its color series correctly.
  const overlay: unknown[] = [];
  let taggedData: PreparedRow[];
  if (dodge) {
    const offsets = pointDodgeOffsets(seriesNames, !!ctx.pane);
    taggedData = [];
    seriesNames.forEach((s) => {
      const seriesData = rendered.filter((d) => d.series === s);
      if (!seriesData.length) return;
      overlay.push(Plot.dot(seriesData, dotOpts({ dx: offsets.get(s) ?? 0 })));
      taggedData.push(...seriesData);
    });
  } else {
    overlay.push(Plot.dot(rendered, dotOpts({})));
    taggedData = rendered;
  }

  // Categorical x (dotplot): DON'T override the x scale — use the adapter's BAND scale (the same
  // one bars use). A band scale divides the plot into equal, non-overlapping bands and Plot
  // centers each category's dot in its band, so the dodge center line sits at the band center and
  // the hover highlight (a uniform per-band region) lines up with the data. (A point scale, used
  // for connecting LINES, only insets the end categories slightly and would leave the end dots
  // off-center within equal bands.) Numeric scatter likewise uses the adapter's linear domain.

  // (Symbol scale is built above, before the data is filtered — the domain decides what renders.)

  // Tag each rendered marker with its COLOR series (DOM order == data order) so the color legend's
  // hover-dim / pin works exactly as it does for the other chart types. With a symbol channel Plot
  // renders the dots as <path>; without one, as <circle>.
  const selector = hasShape ? 'g[aria-label="dot"] path' : 'g[aria-label="dot"] circle';
  // Also tag data-shape so the shape legend can dim by shape value (only when shape ≠ color: a
  // distinct shape channel; for the redundant case data-series alone suffices).
  const tagShape = hasShape && !shapeIsSeries;
  const tagging = [
    {
      selector,
      seriesOrder: taggedData.map((d) => d.series),
      ...(tagShape ? { shapeOrder: taggedData.map((d) => d._shape ?? "") } : {}),
      // Categorical (dot plot): tag the category so the coordinated cursor can read the true
      // category centers from the markers (rotation-independent, unlike the axis labels).
      ...(categorical ? { categoryOrder: taggedData.map((d) => d._xc ?? "") } : {}),
    },
  ];

  return {
    underlay: [],
    overlay,
    tagging,
    dashedNames: new Set<string>(),
    ...(symbolScaleOpts ? { symbolScaleOpts } : {}),
    ...(hasShape && shapeNames ? { shapeNames } : {}),
    ...(shapeIsSeries ? { shapeIsSeries: true } : {}),
    pointOrder: taggedData,
  };
}
