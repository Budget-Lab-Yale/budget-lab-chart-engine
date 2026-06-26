// Area chart mark builder. Stacked areas for multi-series (Plot.areaY applies the stack transform
// by default); a single series degenerates to one band filled to the zero baseline. Borrows the
// line builder's structure — the generic chrome (axes, gridlines, zero baseline, annotations) is
// added by assemblePlot, and the coordinated crosshair is driven by the prepared data, not the
// mark type, so it works here unchanged.
import { Plot } from "../vendor";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

export function buildAreaMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, colors, fxField, fyField } = ctx;
  const facetChannels = fxField && fyField ? { fx: fxField, fy: fyField } : {};

  const seriesNames = ctx.seriesNames ?? [];
  // Stacking order (bottom→top): the dynamic stackOrder when the live layer supplies one
  // (selected-to-bottom restacking), else series_order. Any series missing from stackOrder keeps
  // its series_order position after the listed ones.
  const stackSeq =
    ctx.stackOrder && ctx.stackOrder.length
      ? [...ctx.stackOrder, ...seriesNames.filter((s) => !ctx.stackOrder!.includes(s))]
      : seriesNames;
  const rank = new Map<string, number>(stackSeq.map((s, i) => [s, i]));

  // Stable-sort the rows by stack rank so the bottom series is encountered first and stacks at the
  // bottom (Plot stacks z groups in first-appearance order). The within-series x order is preserved
  // (input is time-sorted), so each area path connects its points correctly.
  const sorted = data
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (rank.get(a.r.series) ?? 0) - (rank.get(b.r.series) ?? 0) || a.i - b.i)
    .map((x) => x.r);

  // Single filled band (one series) vs stacked bands (many): the same areaY call covers both —
  // with one z group it fills to the zero baseline.
  const overlay: unknown[] = [
    Plot.areaY(sorted, {
      x: xField,
      y: "_y",
      z: "series",
      fill: "series",
      // Hairline separator between stacked bands (and a clean edge on a single fill): white,
      // matching the chart background.
      stroke: "#FFFFFF",
      strokeWidth: 0.75,
      defined: (r: PreparedRow) => Number.isFinite(r._y),
      ...facetChannels,
    }),
  ];

  // Plot emits one <path> per z group in STACK order; tag each with its series so legend
  // hover/pin/dim maps correctly even after a restack.
  const present = stackSeq.filter((s) => sorted.some((r) => r.series === s));
  const tagging = [{ selector: 'g[aria-label="area"] path', seriesOrder: present }];

  // Categorical x: areas span a point scale (small edge inset) rather than the bar band scale,
  // matching the line builder so the first/last point sit near the edges.
  const categorical = xField === "_xc";
  const xScaleOpts = categorical ? { type: "point" as const, padding: 0.08 } : undefined;

  return {
    underlay: [],
    overlay,
    tagging,
    dashedNames: new Set<string>(),
    ...(xScaleOpts ? { xScaleOpts } : {}),
  };
}
