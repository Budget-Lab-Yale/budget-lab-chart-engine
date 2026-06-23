// Line chart mark builder. Produces the chart-type-specific marks (confidence-band
// areas + the line(s)); the generic chrome (gridlines, axes, zero baseline, reference
// markers) is added by assemblePlot. Split out of the tracker's monolithic
// buildLineChart so other chart types can register their own builder (marks/index.ts).
import { Plot } from "../vendor";
import { TBL, markerSymbolForIndex } from "../theme";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

export function buildLineMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, colors, fxField, fyField } = ctx;

  // Shared-mode small multiples: when the orchestrator supplies facet field names, every mark
  // binds `fx`/`fy` so it faces into the grid. Absent → no facet channels → single frame.
  const facetChannels =
    fxField && fyField ? { fx: fxField, fy: fyField } : {};

  // Lines render at the full weight in panes too (matches single charts) for legibility.
  const solidStroke = TBL.strokeWidth.solid;
  const dashedStroke = TBL.strokeWidth.dashed;

  // Underlay: confidence-band areas, painted behind the gridlines.
  const underlay: unknown[] = [];
  for (const band of spec.confidence_bands ?? []) {
    const bandColor = colors.get(band.series) || TBL.color.blue;
    underlay.push(
      Plot.areaY(
        data.filter(
          (r) => r.series === band.series && Number.isFinite(r._lo) && Number.isFinite(r._hi),
        ),
        { x: xField, y1: "_lo", y2: "_hi", fill: bandColor, fillOpacity: 0.18, ...facetChannels },
      ),
    );
  }

  // Group series into dashed vs solid so each is a single Plot.line call (z: "series").
  // Dashed paints first so solid lines paint over them where paths cross.
  const dashedNames = new Set<string>();
  for (const [s, st] of Object.entries(spec.series_styles ?? {})) {
    if (st?.dashed) dashedNames.add(s);
  }
  const dashedData = data.filter((r) => dashedNames.has(r.series));
  const solidData = data.filter((r) => !dashedNames.has(r.series));

  const overlay: unknown[] = [];
  if (dashedData.length) {
    overlay.push(
      Plot.line(dashedData, {
        x: xField,
        y: "_y",
        z: "series",
        stroke: "series",
        strokeWidth: dashedStroke,
        strokeDasharray: TBL.dashArray,
        defined: (r: PreparedRow) => Number.isFinite(r._y),
        ...facetChannels,
      }),
    );
  }
  if (solidData.length) {
    overlay.push(
      Plot.line(solidData, {
        x: xField,
        y: "_y",
        z: "series",
        stroke: "series",
        strokeWidth: solidStroke,
        defined: (r: PreparedRow) => Number.isFinite(r._y),
        ...facetChannels,
      }),
    );
  }

  // Data-point markers (spec.points): a filled dot at each finite point, on top of the lines.
  // Dashed-then-solid order matches the line groups so post-render tagging maps each <circle>
  // to its series (one tagging entry per circle, in this exact DOM order) → dots dim with the
  // legend like the lines. Pane charts use a slightly smaller radius.
  const pointData = spec.points
    ? [...dashedData, ...solidData].filter((r) => Number.isFinite(r._y))
    : [];
  if (pointData.length) {
    overlay.push(
      Plot.dot(pointData, {
        x: xField,
        y: "_y",
        fill: "series",
        // Distinct symbol per series (accessibility): mapped via the symbol scale below so
        // series can be told apart without relying on color.
        symbol: "series",
        r: ctx.pane ? 3.3 : 3.6,
        stroke: "#ffffff",
        strokeWidth: 1,
        ...facetChannels,
      }),
    );
  }

  // Series encounter order within each line group, so post-render path tagging maps
  // each <path data-series> correctly even when dashed+solid groups share a color.
  // `g[aria-label="line"] path` returns all line paths in document order — dashed-group
  // paths first (they paint first), then solid-group paths — which matches concatenating
  // each group's encounter order in the same dashed-then-solid sequence.
  const encounterOrder = (rs: PreparedRow[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rs) if (!seen.has(r.series)) { seen.add(r.series); out.push(r.series); }
    return out;
  };
  const seriesOrder: string[] = [];
  if (dashedData.length) seriesOrder.push(...encounterOrder(dashedData));
  if (solidData.length) seriesOrder.push(...encounterOrder(solidData));

  // Categorical x (xField "_xc"): a line connects category points, so use a POINT scale (points
  // span the axis with only a small edge inset) instead of the bar BAND scale (whose outer
  // padding + half-bandwidth pushes the first/last point well inside the plot — wasted space on
  // a line). The band axis labels resolve to the same positions, so they stay aligned.
  const categorical = xField === "_xc";
  const xScaleOpts = categorical ? { type: "point" as const, padding: 0.08 } : undefined;

  const tagging = [{ selector: 'g[aria-label="line"] path', seriesOrder }];
  // Per-series symbol scale for the markers (series → distinct shape, in MARKER_SYMBOLS order).
  let symbolScaleOpts: { domain: string[]; range: string[] } | undefined;
  if (pointData.length) {
    const symbolSeries = ctx.seriesNames ?? seriesOrder;
    symbolScaleOpts = {
      domain: symbolSeries,
      range: symbolSeries.map((_, i) => markerSymbolForIndex(i)),
    };
    // Symbol markers render as <path>; tag each (DOM order == pointData order) with its series
    // so the dots dim with the legend exactly like the lines.
    tagging.push({
      selector: 'g[aria-label="dot"] path',
      seriesOrder: pointData.map((r) => r.series),
    });
  }

  return {
    underlay,
    overlay,
    tagging,
    dashedNames,
    ...(xScaleOpts ? { xScaleOpts } : {}),
    ...(symbolScaleOpts ? { symbolScaleOpts } : {}),
  };
}
