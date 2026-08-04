// Line chart mark builder. Produces the chart-type-specific marks (confidence-band
// areas + the line(s)); the generic chrome (gridlines, axes, zero baseline, reference
// markers) is added by assemblePlot. Split out of the tracker's monolithic
// buildLineChart so other chart types can register their own builder (marks/index.ts).
import { Plot } from "../vendor";
import { TBL, markerSymbolForIndex } from "../theme";
import { resolveColor } from "../palette";
import { buildShadeRuns } from "../shade";
import { labelMovedToLegend, annotationKey } from "../annotation-legend";
import type { ShadeXField } from "../shade";
import { domainBounds } from "../scales";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";
import { splitProjectedRuns } from "./projected";

/** Stamped on every `shading` fill group so tagging (and any future styling) can address the fills
 *  without catching confidence bands, which render as `g[aria-label="area"]` too. Plot puts `class`
 *  on the INNER <g> when a mark is clipped, so selectors built on this must stay descendant
 *  selectors. */
export const SHADE_CLASS = "tbl-shade";

/** Shading is the subject of the chart, not chrome behind it, so it reads at half opacity rather than
 *  the confidence-band tint (0.18) it originally borrowed. Override per region with `fillOpacity`.
 *  Note two overlapping regions compound — 0.5 over 0.5 renders as 0.75. */
const SHADE_FILL_OPACITY = 0.5;

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
  // Truncated value axis (see assemblePaneResult's clip gate): clip the data marks to the frame. Geometric,
  // not a data filter — the stroke runs to its true crossing with the axis edge and is cut there, so
  // a series that leaves and re-enters the domain resumes at the right x. No-op (and byte-identical)
  // when the domain covers the data.
  const clipOpt = ctx.clipMarks ? { clip: true as const } : {};

  const underlay: unknown[] = [];

  // Shaded line-to-baseline regions (spec.shading). Pushed FIRST so they paint under the confidence
  // bands — a CI band is the more specific statement and should read on top of a broad fill — and,
  // being in the underlay, both sit behind the gridlines.
  //
  // Each region's baseline is `region.baseline ?? 0` — a threshold rather than zero when the author
  // wants the breach shaded. `side` is measured against that raw value; the DRAWN edge is clamped
  // into the y-domain so a fill can never leave the frame, exactly as the zero case always did.
  // The clamp reads the domain's NUMERIC bounds (domainBounds), not the raw pair: a reversed axis
  // runs descending, and clamping against that as [lo, hi] pinned every threshold to the far edge.
  const shadeSeriesOrder: string[] = [];
  // Parallel to shadeSeriesOrder: the annotation key of the region each emitted path came from, for
  // the regions keyed in the legend (undefined for the rest). A fill therefore carries BOTH keys —
  // it dims with its own line, and lights up when its annotation row is hovered.
  const shadeAnnotationOrder: Array<string | undefined> = [];
  if (spec.shading?.length && ctx.yDomain) {
    const [domainLo, domainHi] = domainBounds(ctx.yDomain);
    const clampToDomain = (v: number) => Math.min(Math.max(v, domainLo), domainHi);
    const parseBound = (v: string | undefined) =>
      v == null ? null : (ctx.parseXValue?.(v) ?? null);
    for (const region of spec.shading) {
      const regionBaseline = region.baseline ?? 0;
      const drawnBaseline = clampToDomain(regionBaseline);
      const targets =
        region.series != null
          ? [region.series]
          : (ctx.seriesNames ?? Array.from(new Set(data.map((r) => r.series))));
      for (const seriesKey of targets) {
        const seriesPoints = data.filter((r) => r.series === seriesKey);
        if (!seriesPoints.length) continue;
        const runs = buildShadeRuns(seriesPoints, xField as ShadeXField, {
          side: region.side ?? "both",
          baseline: regionBaseline,
          from: parseBound(region.from),
          to: parseBound(region.to),
        });
        if (!runs.length) continue;
        const fill =
          (region.color && (resolveColor(region.color) || region.color)) ||
          colors.get(seriesKey) ||
          TBL.color.blue;
        // One mark per (region, series) with z: "_seg" — Plot emits one path per run, in _seg
        // first-appearance order, which is the order pushed onto shadeSeriesOrder below.
        underlay.push(
          Plot.areaY(runs.flatMap((r) => r.rows), {
            x: xField,
            y1: drawnBaseline,
            y2: "_y",
            z: "_seg",
            fill,
            fillOpacity: region.fillOpacity ?? SHADE_FILL_OPACITY,
            className: SHADE_CLASS,
            ...facetChannels,
            ...clipOpt,
          }),
        );
        const annKey = labelMovedToLegend(spec, region) ? annotationKey(region.label as string) : undefined;
        for (let i = 0; i < runs.length; i++) {
          shadeSeriesOrder.push(seriesKey);
          shadeAnnotationOrder.push(annKey);
        }
      }
    }
  }

  // Confidence-band areas, painted behind the gridlines.
  for (const band of spec.confidence_bands ?? []) {
    const bandColor = colors.get(band.series) || TBL.color.blue;
    underlay.push(
      Plot.areaY(
        data.filter(
          (r) => r.series === band.series && Number.isFinite(r._lo) && Number.isFinite(r._hi),
        ),
        {
          x: xField,
          y1: "_lo",
          y2: "_hi",
          fill: bandColor,
          fillOpacity: 0.18,
          ...facetChannels,
          ...clipOpt,
        },
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
        ...clipOpt,
      }),
    );
  }
  // Projected-run split (task 12): a per-row `_projected` flag (spec.projected_field) splits
  // ONLY the solid group into maximal actual/projected runs per series, so the projected date
  // range(s) render dashed while the rest of the series stays solid — connecting continuously to
  // the adjacent actual points (splitProjectedRuns extends each projected run with a shallow copy
  // of its neighboring actual boundary point, so the connector segment renders once, dashed, with
  // no gap). A series ALSO listed in series_styles[..].dashed lives in dashedData (above), never
  // solidData, so it is NEVER split here — whole-series dashed wins outright over per-row
  // projected styling for that series.
  const hasProjected = !!spec.projected_field;
  let projRows: PreparedRow[] = [];
  let actualRows: PreparedRow[] = solidData;
  if (hasProjected) {
    const split = splitProjectedRuns(solidData);
    projRows = split.projected;
    actualRows = split.actual;
  }
  // Default true (projected runs render dashed); an explicit `false` opts a chart out of the
  // visual distinction while keeping projected_field wired (e.g. for tooling that only needs the
  // area fade, or a future non-dash treatment).
  const projDashed = spec.projected_style?.dashed !== false;

  if (hasProjected) {
    // Paint order: dashed-series (above) → projected-runs → actual-runs. z:"_seg" (not "series")
    // is essential in both calls: grouping by series would let Plot bridge the projected gap (or
    // bridge two disjoint projected runs) with an unwanted solid/dashed segment.
    if (projRows.length) {
      overlay.push(
        Plot.line(projRows, {
          x: xField,
          y: "_y",
          z: "_seg",
          stroke: "series",
          strokeWidth: solidStroke,
          ...(projDashed ? { strokeDasharray: TBL.dashArray } : {}),
          defined: (r: PreparedRow) => Number.isFinite(r._y),
          ...facetChannels,
          ...clipOpt,
        }),
      );
    }
    if (actualRows.length) {
      overlay.push(
        Plot.line(actualRows, {
          x: xField,
          y: "_y",
          z: "_seg",
          stroke: "series",
          strokeWidth: solidStroke,
          defined: (r: PreparedRow) => Number.isFinite(r._y),
          ...facetChannels,
          ...clipOpt,
        }),
      );
    }
  } else if (solidData.length) {
    overlay.push(
      Plot.line(solidData, {
        x: xField,
        y: "_y",
        z: "series",
        stroke: "series",
        strokeWidth: solidStroke,
        defined: (r: PreparedRow) => Number.isFinite(r._y),
        ...facetChannels,
        ...clipOpt,
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
        ...clipOpt,
      }),
    );
  }

  // Path encounter order within each line group, so post-render path tagging maps each
  // <path data-series> correctly even when several groups share a color. `g[aria-label="line"]
  // path` returns all line paths in document order, matching the overlay's paint order above.
  // Plot emits one <path> per unique z-group value (in the z-group's first-appearance order in
  // its call's data), so the tagging key must be the z FIELD actually used by that call: plain
  // "series" for the unsplit dashed/solid groups, "_seg" (falling back to "series") once
  // projected_field splits solidData into multiple per-run paths per series — each unique _seg
  // is its own path and must get its own (repeated) series tag.
  const encounterOrder = (rs: PreparedRow[], keyField: "series" | "_seg" = "series"): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rs) {
      const key = keyField === "_seg" ? ((r as PreparedRow & { _seg?: string })._seg ?? r.series) : r.series;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(r.series);
      }
    }
    return out;
  };
  const seriesOrder: string[] = [];
  if (dashedData.length) seriesOrder.push(...encounterOrder(dashedData));
  if (hasProjected) {
    if (projRows.length) seriesOrder.push(...encounterOrder(projRows, "_seg"));
    if (actualRows.length) seriesOrder.push(...encounterOrder(actualRows, "_seg"));
  } else if (solidData.length) {
    seriesOrder.push(...encounterOrder(solidData));
  }

  // Categorical x (xField "_xc"): a line connects category points, so use a POINT scale (points
  // span the axis with only a small edge inset) instead of the bar BAND scale (whose outer
  // padding + half-bandwidth pushes the first/last point well inside the plot — wasted space on
  // a line). The band axis labels resolve to the same positions, so they stay aligned.
  const categorical = xField === "_xc";
  const xScaleOpts = categorical ? { type: "point" as const, padding: 0.08 } : undefined;

  const tagging = [{ selector: 'g[aria-label="line"] path', seriesOrder }];
  // Shade fills get data-series too, so legend hover/pin/dim covers them with no extra wiring.
  if (shadeSeriesOrder.length) {
    tagging.push({
      selector: `g.${SHADE_CLASS} path`,
      seriesOrder: shadeSeriesOrder,
      ...(shadeAnnotationOrder.some((k) => k != null) ? { annotationOrder: shadeAnnotationOrder } : {}),
    });
  }
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
