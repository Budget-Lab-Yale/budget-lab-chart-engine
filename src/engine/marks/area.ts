// Area chart mark builder. Stacked areas for multi-series (Plot.areaY applies the stack transform
// by default); a single series degenerates to one band filled to the zero baseline. Borrows the
// line builder's structure — the generic chrome (axes, gridlines, zero baseline, annotations) is
// added by assemblePlot, and the coordinated crosshair is driven by the prepared data, not the
// mark type, so it works here unchanged.
import { Plot } from "../vendor";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";
import { splitProjectedRuns } from "./projected";

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

  // Projected-range fade veil (task 12): a stacked area can't split per-series like the line
  // builder does — a per-series projected sub-range would need its OWN areaY z-group, which
  // would double-count / misalign Plot's stack transform. Instead, paint a translucent WHITE
  // rect over the x-range(s) where EVERY in-scope series is flagged projected, painted on top of
  // the stacked fill. Returned in its own `veil` layer (NOT `overlay` — see fix-wave I1) so
  // assemblePlot can paint xAxis marker rules above it while keeping the fill exactly where it
  // paints today. This is conservative and documented as a known limitation: a stack has no way
  // to visually express ONE series' projected flag without affecting the read of the other
  // series sharing that x, so an x where only SOME series are flagged is NOT faded.
  //
  // Reuses the exact run-boundary/extension algorithm the line builder uses (splitProjectedRuns)
  // over a synthetic one-row-per-x "virtual series", so the veil's edges extend to the adjacent
  // ACTUAL x exactly like the line's dashed connector does (an edge run — no adjacent actual x on
  // that side, e.g. a trailing forecast — clamps to the run's own x extent).
  const veil: unknown[] = [];
  if (spec.projected_field && ctx.yDomain) {
    const [y1, y2] = ctx.yDomain;
    const byX = new Map<string, { x: unknown; allProjected: boolean }>();
    for (const r of data) {
      const entry = byX.get(r.time);
      const projectedHere = r._projected === true;
      if (entry) {
        entry.allProjected = entry.allProjected && projectedHere;
      } else {
        byX.set(r.time, { x: (r as unknown as Record<string, unknown>)[xField], allProjected: projectedHere });
      }
    }
    const entries = Array.from(byX.values());
    // Numeric/temporal: sort by the parsed value so the virtual sequence is true x-order even if
    // the input happens to be series-major with series covering different x subsets. Categorical
    // x keeps Map insertion order, which already matches dataInScope's resolved category order
    // (x_order is applied upstream in renderPane before the mark builder runs).
    if (xField === "_xn" || xField === "_xd") {
      entries.sort((a, b) => {
        const av = xField === "_xd" ? (a.x as Date | null)?.getTime() ?? 0 : (a.x as number);
        const bv = xField === "_xd" ? (b.x as Date | null)?.getTime() ?? 0 : (b.x as number);
        return av - bv;
      });
    }
    // _y: 0 is a finite sentinel (every real x has data for at least one series) so
    // splitProjectedRuns' null-boundary rule never fires on this synthetic sequence.
    const virtualRows = entries.map(
      (v) => ({ series: " veil", time: "", _y: 0, _projected: v.allProjected, [xField]: v.x }) as unknown as PreparedRow,
    );
    const { projected: veilRuns } = splitProjectedRuns(virtualRows);
    const bySeg = new Map<string, PreparedRow[]>();
    for (const r of veilRuns) {
      const seg = (r as unknown as { _seg: string })._seg;
      const bucket = bySeg.get(seg);
      if (bucket) bucket.push(r);
      else bySeg.set(seg, [r]);
    }
    const fillOpacity = spec.projected_style?.fillOpacity ?? 0.2;
    const veilRects = Array.from(bySeg.values()).map((rows) => ({
      x1: (rows[0] as unknown as Record<string, unknown>)[xField],
      x2: (rows[rows.length - 1] as unknown as Record<string, unknown>)[xField],
      y1,
      y2,
    }));
    if (veilRects.length) {
      veil.push(
        Plot.rect(veilRects, {
          x1: "x1",
          x2: "x2",
          y1: "y1",
          y2: "y2",
          fill: "#FFFFFF",
          fillOpacity: 1 - fillOpacity,
          ...facetChannels,
        }),
      );
    }
  }

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
    ...(veil.length ? { veil } : {}),
    ...(xScaleOpts ? { xScaleOpts } : {}),
  };
}
