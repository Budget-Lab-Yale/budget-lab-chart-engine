// Where the legend goes, and in what order — the ONE decision shared by the live card
// (engine/render-live.ts) and the PNG export (embed/export-png.ts).
//
// WHY THIS MODULE EXISTS. The rule lived inside render-live.ts, so the export never saw it: a
// stacked chart with five or more series, or a diverging one, showed a RIGHT legend on screen and a
// TOP legend in the download. That divergence was reported from a real download, and it is the
// class the repo's own invariant names — the export re-renders from the spec and does not serialise
// the live DOM, so anything decided only in the live path is silently absent from the PNG.
//
// It cannot simply be imported from render-live.ts either: render-live imports `exportChartPng`
// from embed/export-png.ts for its download button, so an import back the other way would be a
// runtime cycle between the two. Hence a third module that neither of them owns. Both import from
// here; the type-only import of `LegendItem` from ./index.js carries no runtime edge, and
// engine/index.ts does not import this file, so nothing new is circular.
import { resolveColumns } from "../spec/columns.js";
import type { ChartSpec } from "../spec/types.js";
import type { TidyRow } from "../data/index.js";
import type { LegendItem } from "./index.js";

/** Width reserved for a right-hand legend column, and the gap between it and the chart. */
export const LEGEND_COLUMN_WIDTH = 160;
export const LEGEND_GAP = 16;

/**
 * The series rows a legend actually keys — the count the position rule is defined on.
 *
 * `nonInteractive` rows (the neutral shape legend) and `isExtra` rows (the interactive stacked
 * Total pseudo-series) are chrome, not series: counting them would tip a four-series stack into the
 * right-legend layout on the strength of a row that names no series. Both call sites must use this,
 * or the live card and the download can still disagree about the position.
 */
export function legendSeriesCount(items: readonly LegendItem[]): number {
  return items.filter((i) => !i.nonInteractive && !i.isExtra).length;
}

/**
 * "top" or "right" for this spec.
 *
 * `legend: false` suppresses the legend entirely (buildLegendItems returns null), so no right
 * column must ever be reserved — treat the layout as top, whose slot stays empty and takes no
 * space, regardless of an explicit legendPosition or the stacked defaults below.
 *
 * An explicit `spec.legendPosition` wins over the defaults. Otherwise "right" when the chart is
 * `stacked` AND (five or more series, OR diverging — any row with a negative value), because a tall
 * stack's legend reads better beside it than wrapped above it.
 *
 * The LIVE path additionally falls back to "top" when the card is too narrow for the column; that
 * belongs to the caller, which is the only place a card width is known. The export's frame is a
 * fixed 1000px and never hits it.
 */
export function resolveLegendPosition(
  spec: ChartSpec,
  seriesCount: number,
  rows: TidyRow[],
): "top" | "right" {
  if (spec.legend === false) return "top";
  if (spec.legendPosition === "top" || spec.legendPosition === "right") {
    return spec.legendPosition;
  }
  if (spec.chartType === "stacked") {
    if (seriesCount >= 5) return "right";
    const valueCol = resolveColumns(spec, rows).value;
    const isDiverging = rows.some((r) => {
      const v = typeof r._y === "number" ? r._y : Number(r[valueCol]);
      return Number.isFinite(v) && v < 0;
    });
    if (isDiverging) return "right";
  }
  return "top";
}

/**
 * Order legend items for a right-hand column so the rows read top→bottom as the stack does.
 *
 *   - When the engine supplies `legendVisualOrder` (stacked charts), series rows follow that order
 *     ([positives reversed] ++ [negatives in declaration order]).
 *   - Otherwise fall back to REVERSED declaration order (top-of-stack first).
 *   - Extra rows (the interactive Total pseudo-series, the neutral shape legend) are appended at
 *     the END in their original relative order.
 *
 * A top legend keeps declaration order: it flows left-to-right and has no stack to mirror.
 */
export function orderForRightLegend(
  items: readonly LegendItem[],
  visualOrder?: readonly string[],
): LegendItem[] {
  const series = items.filter((i) => !i.nonInteractive && !i.isExtra);
  const extras = items.filter((i) => i.nonInteractive || i.isExtra);
  let orderedSeries: LegendItem[];
  if (visualOrder && visualOrder.length) {
    const bySeries = new Map(series.map((i) => [i.series, i]));
    orderedSeries = visualOrder
      .map((s) => bySeries.get(s))
      .filter((i): i is LegendItem => i != null);
    // Append any series not named in visualOrder (defensive), preserving their order.
    for (const i of series) if (!visualOrder.includes(i.series)) orderedSeries.push(i);
  } else {
    orderedSeries = [...series].reverse();
  }
  return [...orderedSeries, ...extras];
}
