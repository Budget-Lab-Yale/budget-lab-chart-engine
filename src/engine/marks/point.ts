// Point mark builder, shared by the `scatter` (numeric x) and `dotplot` (categorical x) chart
// types. Each datum is a marker at (x, y); COLOR encodes the `series` field and marker SHAPE
// encodes the independent `_shape` field (from columns.shape). The two channels are independent
// — point both at the same column for redundant color+shape encoding (the dot-plot default).
// The generic chrome (gridlines, axes, zero baseline) is added by assemblePlot.
import { Plot } from "../vendor";
import { markerSymbolForIndex } from "../theme";
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

  // Marker radius: slightly smaller in small-multiples panes (matches the line-point markers).
  const r = ctx.pane ? 3.8 : 4.6;

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
      const seriesData = data.filter((d) => d.series === s);
      if (!seriesData.length) return;
      overlay.push(Plot.dot(seriesData, dotOpts({ dx: offsets.get(s) ?? 0 })));
      taggedData.push(...seriesData);
    });
  } else {
    overlay.push(Plot.dot(data, dotOpts({})));
    taggedData = data;
  }

  // Categorical x (dotplot): use a POINT scale so markers sit at the category centers with only
  // a small edge inset (the bar BAND scale's outer padding + half-bandwidth would push the
  // first/last category well inside the frame). Matches the categorical-line treatment. Numeric
  // x (scatter) keeps the adapter's linear domain (xScaleOpts undefined).
  const xScaleOpts = categorical ? { type: "point" as const, padding: 0.18 } : undefined;

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
    },
  ];

  return {
    underlay: [],
    overlay,
    tagging,
    dashedNames: new Set<string>(),
    ...(xScaleOpts ? { xScaleOpts } : {}),
    ...(symbolScaleOpts ? { symbolScaleOpts } : {}),
    ...(hasShape && shapeNames ? { shapeNames } : {}),
    ...(shapeIsSeries ? { shapeIsSeries: true } : {}),
  };
}
