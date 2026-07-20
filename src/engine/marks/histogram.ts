// Histogram mark: continuous-x bars drawn from _x0 to _x1 (edge-to-edge, no band padding). Multiple
// series overlay with partial fill-opacity, z-ordered by series order. Mirrors the bar mark's
// data-series rect tagging so legend hover/pin dims the right bars.
import { Plot } from "../vendor";
import { TBL } from "../theme";
import { resolveColor } from "../palette";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

const OVERLAP_OPACITY = 0.5;

export function buildHistogramMarks(data: PreparedRow[], spec: ChartSpec, ctx: MarkContext): MarkLayers {
  const seriesNames = ctx.seriesNames ?? [""];
  const isMulti = seriesNames.length > 1;
  const { colors } = ctx;
  const barColor = resolveColor(spec.bar_color);
  const highlightSet = spec.highlightSeries && spec.highlightSeries.length ? new Set(spec.highlightSeries) : null;

  // bar_color is single-series-only (ChartSpec.bar_color TSDoc) and must win over the palette
  // default (colors.get always returns a slot), so it is checked first — mirrors bar.ts precedence.
  const fillFor = (s: string): string => {
    if (highlightSet && !highlightSet.has(s)) return TBL.color.annotationDim;
    if (!isMulti) return barColor ?? colors.get(s) ?? TBL.color.blue;
    return colors.get(s) ?? TBL.color.blue;
  };

  // One rect layer per series so z-order follows series order; overlap uses partial opacity.
  const overlay: unknown[] = [];
  for (const s of seriesNames) {
    const seriesData = data.filter((d) => d.series === s && d._y != null && d._x0 != null && d._x1 != null);
    overlay.push(
      Plot.rectY(seriesData, {
        x1: "_x0", x2: "_x1", y: "_y",
        fill: fillFor(s),
        // Function channel (not the constant OVERLAP_OPACITY) so Plot emits fill-opacity on each
        // <rect> rather than hoisting it onto the parent <g> — the per-rect attribute the overlap
        // translucency + legend dim/pin model reads. (Same constant→group vs fn→per-rect Plot
        // behavior documented in bar.ts.)
        fillOpacity: isMulti ? () => OVERLAP_OPACITY : 1,
        stroke: isMulti ? fillFor(s) : "none",
        strokeOpacity: 1,
      }),
    );
  }

  // Rect tag order: Plot emits one <rect> per datum in series-layer order, data-row order within.
  // Same triple predicate as the per-series rect filter above, so a null-edge row can't shift the tags.
  const seriesOrder: string[] = [];
  for (const s of seriesNames)
    for (const d of data)
      if (d.series === s && d._y != null && d._x0 != null && d._x1 != null) seriesOrder.push(s);

  return {
    underlay: [],
    overlay,
    tagging: [{ selector: 'g[aria-label="rect"] rect', seriesOrder }],
    dashedNames: new Set<string>(),
  };
}
