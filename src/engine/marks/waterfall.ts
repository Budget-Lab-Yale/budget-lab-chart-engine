// Waterfall chart mark builder. A vertical, single-series categorical chart whose bars float on a
// running cumulative: each step spans from the running total entering it to the running total
// leaving it, `total` steps anchor at zero, and `skip` steps hold a category slot with no bar. The
// running math lives in scales.ts (computeWaterfallSteps), shared with the value-axis extent so the
// axis and bars agree. Small-multiples faceting comes for free through the per-pane orchestrator
// (figure.ts) — this builder only ever sees one pane's rows.
//
// Coloring is semantic by default (increase = blue, decrease = red, total = navy); overridable
// globally via spec.waterfall.colors and per bar via category_colors. Connectors are dotted rules
// pushed BEFORE the bars so the opaque bars over-paint the overlapping halves, leaving the connector
// visible only in the inter-bar gap (matching the house waterfall style) — no pixel math needed.
import { Plot } from "../vendor";
import { TBL, TBL_VALUE_LABEL } from "../theme";
import { resolveColor } from "../palette";
import { CAT_LABEL_CLASS } from "../axes";
import { inferUnitsFromSubtitle } from "../util";
import { computeWaterfallSteps, waterfallValueDecimals } from "../scales";
import type { WaterfallStep } from "../scales";
import { SINGLE_SERIES_KEY } from "../../spec/columns";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

const DEFAULT_INCREASE = "blue";
const DEFAULT_DECREASE = "red";
const DEFAULT_TOTAL = "navy";

/** Fixed-precision value-label formatter with the subtitle-inferred units suffix. `decimals` is
 *  the shared waterfall precision (see waterfallValueDecimals), so labels and the hover delta agree. */
function makeLevelFormatter(units: string, decimals: number): (v: number) => string {
  const maxFrac = decimals;
  return (v: number) => {
    if (!Number.isFinite(v)) return "";
    const s = v.toFixed(maxFrac);
    return units ? `${s}${units}` : s;
  };
}

export function buildWaterfallMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const catField = ctx.xField; // "_xc"
  const clipOpt = ctx.clipMarks ? { clip: true as const } : {};
  const steps = computeWaterfallSteps(data);
  const categories = steps.map((s) => s.cat); // band domain: declaration order, INCLUDING skips
  const barSteps = steps.filter((s) => s.kind !== "skip");

  // --- Colors (semantic default; global + per-category overrides). ---
  const wf = spec.waterfall ?? {};
  const incColor = resolveColor(wf.colors?.increase) ?? (resolveColor(DEFAULT_INCREASE) as string);
  const decColor = resolveColor(wf.colors?.decrease) ?? (resolveColor(DEFAULT_DECREASE) as string);
  const totColor = resolveColor(wf.colors?.total) ?? (resolveColor(DEFAULT_TOTAL) as string);
  const categoryColorMap: Record<string, string> | null = spec.category_colors
    ? Object.fromEntries(
        Object.entries(spec.category_colors).map(([k, v]) => [k, resolveColor(v) as string]),
      )
    : null;
  const fillFor = (s: WaterfallStep): string => {
    const byCat = categoryColorMap?.[s.cat];
    if (byCat != null) return byCat;
    if (s.kind === "total") return totColor;
    return s.rise ? incColor : decColor;
  };

  // --- Bars: one rect per step (base → top), per-datum fill (a color-string channel Plot uses
  //     literally) so the live layer's value pill color-matches the bar. A `skip` step renders as a
  //     zero-height, fill:none rect: invisible, but it KEEPS a rect in the category slot so the live
  //     layer's rect-index→category mapping stays 1:1 (robust hover) — the running total is
  //     unchanged across it (base === top). ---
  const barRows = steps.map((s) => ({
    _xc: s.cat,
    _base: s.base,
    _top: s.top,
    _fill: s.kind === "skip" ? "none" : fillFor(s),
  }));
  const overlay: unknown[] = [];

  // --- Connectors (dotted): link each bar's outgoing level to the next non-skip bar's slot, at the
  //     shared level; bridges across skip slots. Pushed first → bars over-paint all but the gap. ---
  const connectors = wf.connectors !== false;
  if (connectors && barSteps.length > 1) {
    const connColor = resolveColor(wf.connectorColor) ?? TBL.color.annotationDim;
    const connRows: Array<{ x1: string; x2: string; y: number }> = [];
    for (let i = 0; i < barSteps.length - 1; i++) {
      connRows.push({ x1: barSteps[i]!.cat, x2: barSteps[i + 1]!.cat, y: barSteps[i]!.level });
    }
    overlay.push(
      Plot.link(connRows, {
        x1: "x1",
        x2: "x2",
        y1: "y",
        y2: "y",
        stroke: connColor,
        strokeWidth: 1,
        strokeDasharray: "1 3",
      }),
    );
  }

  overlay.push(
    Plot.barY(barRows, { x: "_xc", y1: "_base", y2: "_top", fill: (d: { _fill: string }) => d._fill, ...clipOpt }),
  );

  // --- Always-on running-total labels (opt-in): the cumulative level AFTER each step, above a
  //     rising bar / below a falling one. Color-matched to the bar and drawn at ONE uniform
  //     size + weight for totals and deltas alike (pane-aware — smaller in small-multiples). ---
  if (spec.valueLabels?.show === true) {
    const units = inferUnitsFromSubtitle(spec.subtitle);
    const fmt = makeLevelFormatter(units, waterfallValueDecimals(data, spec.valueLabels?.decimals));
    const labelSize = ctx.pane ? 10.5 : TBL_VALUE_LABEL.fontSize;
    const pushLabels = (rising: boolean): void => {
      const rows = barSteps
        .filter((s) => s.rise === rising)
        .map((s) => ({ _xc: s.cat, level: s.level, fill: fillFor(s) }));
      if (!rows.length) return;
      overlay.push(
        Plot.text(rows, {
          x: "_xc",
          y: "level",
          text: (d: { level: number }) => fmt(d.level),
          textAnchor: "middle",
          dy: rising ? -TBL_VALUE_LABEL.gap : TBL_VALUE_LABEL.gapBelow,
          fontSize: labelSize,
          fontWeight: TBL_VALUE_LABEL.fontWeight,
          fill: (d: { fill: string }) => d.fill,
        }),
      );
    };
    pushLabels(true);
    pushLabels(false);
  }

  // A `skip` step draws no bar and no text — it only reserves the category slot (zero-height rect,
  // above) so faceted panes stay aligned. Label the gap with a point annotation (annotations.points),
  // which now resolves a categorical x to the bar center and supports maxWidth wrapping.

  return {
    underlay: [],
    overlay,
    tagging: [
      // One rect per non-skip step, in barRows (= declaration) order; tag them the single-series
      // key so the live layer treats the whole chart as one series (per-bar fill is read off the
      // rendered rect). Category labels (adapter-drawn on `x`) tagged in full band-domain order.
      { selector: 'g[aria-label="bar"] rect', seriesOrder: barRows.map(() => SINGLE_SERIES_KEY) },
      { selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [], categoryOrder: categories },
    ],
    dashedNames: new Set<string>(),
    // Explicit band domain (declaration order, incl. skip slots) so a skipped step still reserves
    // its axis position; padding matches single-series bars.
    xScaleOpts: { domain: categories, paddingInner: 0.2, paddingOuter: 0.2 },
  };
}
