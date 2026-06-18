// Stacked bar mark builder. Produces full-fidelity stacked bars per the Style-Guide
// `bar-stacked.md`: cumulative (all-positive) and diverging (mixed sign) stacks,
// categorical or monochromatic color, net-total markers (text-above for cumulative,
// black-stroked white dot + signed label for diverging), 100%-normalized stacks, and
// optional in-segment value labels with a pixel-height suppression rule. Vertical is the
// primary path; horizontal mirrors with barX/swapped channels.
//
// Unlike grouped bars (bar.ts), stacked bars use a SINGLE band x-scale with Plot's
// automatic stacking (one bar per category, segmented by series) — NO `fx` faceting — so
// the A6.5 facet chrome does not apply. The generic chrome (gridlines, y-labels, zero
// baseline, category x-labels) is added by assemblePlot; the adapter already labels the
// categories on `x`, so this builder leaves xAxisMarks undefined for the vertical path.
//
// Stack ORDER (top risk, verified empirically against Plot 0.6.16 — see task A7 report):
// Plot's DEFAULT stack order (no `order`/`reverse` option) places the FIRST-declared
// series at the bottom of the positive sub-stack (just above 0) and stacks subsequent
// series upward in declaration order; negatives stack downward from 0 in declaration
// order (first-declared negative just below 0). That is exactly the Style-Guide rule, so
// we pass NO order/reverse option and rely on data being supplied in declaration order.
import { Plot } from "../vendor";
import { TBL } from "../theme";
import { tblBandYAxis } from "../axes";
import { monoScale } from "../palette";
import { inferUnitsFromSubtitle } from "../util";
import { tokens } from "../../theme/tokens";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

// Below this pixel height a segment value-label can't fit cleanly — drop it
// (bar-stacked.md §7, slide half-scale 25px threshold).
const SEGMENT_LABEL_MIN_PX = 25;
const MARK_BLACK = tokens.structural.mark_black;
const WHITE = "#FFFFFF";

/** A pure value-label formatter (no toLocaleString/locale, so goldens stay byte-stable).
 *  Mirrors bar.ts: minimum decimal precision across the rendered values; `signed`
 *  prepends an explicit + / U+2212. */
function makeValueFormatter(
  values: number[],
  units: string,
  signed: boolean,
): (d: number) => string {
  const maxFrac = values.reduce((max, v) => {
    if (!Number.isFinite(v)) return max;
    const s = String(v);
    const i = s.indexOf(".");
    return Math.max(max, i < 0 ? 0 : s.length - i - 1);
  }, 0);
  return (d: number) => {
    if (!Number.isFinite(d)) return "";
    const mag = Math.abs(d).toFixed(maxFrac);
    const body = units ? `${mag}${units}` : mag;
    if (!signed) return body;
    return d < 0 ? `−${body}` : `+${body}`;
  };
}

export function buildStackedMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, colors } = ctx;
  const catField = xField;
  const seriesNames = ctx.seriesNames ?? [];
  const horizontal = spec.orientation === "horizontal";
  const normalize = spec.barStack?.normalize === true;

  // Category domain in data-encounter order (declaration order is authoritative).
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

  // --- Per-category aggregates (computed INDEPENDENTLY of the stack) ---
  // net (Σ _y), positive sum (visual top of positive stack), negative sum.
  const rank = new Map<string, number>(seriesNames.map((s, i) => [s, i]));
  const netByCat = new Map<string, number>();
  const posSumByCat = new Map<string, number>();
  for (const r of data) {
    const cat = (r as unknown as Record<string, unknown>)[catField] as string;
    const y = r._y;
    if (!Number.isFinite(y as number) || y == null) continue;
    netByCat.set(cat, (netByCat.get(cat) ?? 0) + y);
    if (y >= 0) posSumByCat.set(cat, (posSumByCat.get(cat) ?? 0) + y);
  }

  const hasNegatives = data.some((r) => Number.isFinite(r._y as number) && (r._y as number) < 0);

  // Net display mode (bar-stacked.md §6): "auto" → dot when any negative, else text.
  // Normalized stacks always top at 100% so a net callout is meaningless — suppress.
  const netDisplayCfg = spec.barStack?.netDisplay ?? "auto";
  const netMode: "dot" | "text" | "none" = normalize
    ? "none"
    : netDisplayCfg === "dot"
      ? "dot"
      : netDisplayCfg === "text"
        ? "text"
        : hasNegatives
          ? "dot"
          : "text";

  const units = inferUnitsFromSubtitle(spec.subtitle);
  const allValues = data
    .map((r) => r._y)
    .filter((v): v is number => Number.isFinite(v as number));
  // Net text above a cumulative stack is unsigned (always positive); diverging net is signed.
  const netFmt = makeValueFormatter([...netByCat.values()], units, netMode === "dot");
  const segFmt = makeValueFormatter(allValues, units, false);

  // --- Color: categorical (default) or monochromatic by stack position ---
  // For mono, segments are colored darkest-at-bottom → lightest-at-top by their VISUAL
  // stack rank (through 0 for diverging), NOT declaration order. We compute each series'
  // bottom→top rank within its (single-category) stack; since the stack order is the same
  // across categories (declaration order), one global ranking suffices.
  // Series sign classification (by SUMMED value across categories): a series is negative
  // if its total is < 0, positive otherwise. Edge case: a genuinely mixed-sign series is
  // classified by the sign of its sum, which can place it on the "wrong" visual side for
  // individual categories — acceptable, and the only well-defined single classification.
  const sumBySeries = new Map<string, number>();
  for (const r of data) {
    const y = r._y;
    if (!Number.isFinite(y as number) || y == null) continue;
    sumBySeries.set(r.series, (sumBySeries.get(r.series) ?? 0) + (y as number));
  }
  const sign = new Map<string, number>();
  for (const s of seriesNames) sign.set(s, (sumBySeries.get(s) ?? 0) < 0 ? -1 : 1);
  const negs = seriesNames.filter((s) => sign.get(s) === -1);
  const poss = seriesNames.filter((s) => sign.get(s) !== -1);

  // Visual stack order, top→bottom (bar-stacked.md §8.2): positives stack up from 0 in
  // declaration order (first-declared just above 0) so visual top→bottom = positives
  // REVERSED; negatives stack down from 0 in declaration order so visual top→bottom =
  // negatives in declaration order. Full order = [positives reversed] ++ [negatives].
  const legendVisualOrder = [...poss.slice().reverse(), ...negs];

  const monoBase = spec.barStack?.mono?.base;
  // series → mono tier hex (darkest at bottom of the visual stack), or null when categorical.
  let monoTierForSeries: Map<string, string> | null = null;
  let fillChannel: string | ((d: PreparedRow) => string);
  if (monoBase) {
    const tiers = monoScale(monoBase, seriesNames.length); // darkest-first
    // Bottom→top: bottommost negative first. Negatives stack downward in declaration
    // order, so the last-declared negative sits at the visual bottom → reverse them.
    const bottomToTop = [...negs.slice().reverse(), ...poss];
    const tierForSeries = new Map<string, string>();
    bottomToTop.forEach((s, i) => {
      tierForSeries.set(s, tiers[Math.min(i, tiers.length - 1)] as string);
    });
    monoTierForSeries = tierForSeries;
    fillChannel = (d: PreparedRow) => tierForSeries.get(d.series) ?? (tiers[0] as string);
  } else {
    // Categorical: literal accessor against the engine color map (matches the legend).
    fillChannel = (d: PreparedRow) => colors.get(d.series) || TBL.color.blue;
  }

  // Resolved series → fill color: the source of truth for the legend swatches. Mono uses
  // the tonal tier per series; categorical uses the engine color map.
  const seriesColors = new Map<string, string>();
  for (const s of seriesNames) {
    seriesColors.set(s, monoTierForSeries?.get(s) ?? colors.get(s) ?? TBL.color.blue);
  }

  // --- Stack mark ---
  // Plot stacks barY/barX automatically when rows share a category. We pass NO order/
  // reverse so the default (declaration-order-from-zero) ordering applies.
  //
  // 100%-normalized: rather than Plot's `offset:"normalize"` (which renormalizes to a
  // [0,1] range, conflicting with A4's [0,100] y-axis + "%" tick labels), we rescale each
  // value to its share-of-category-total × 100 up front. That keeps the engine's [0,100]
  // domain and tick formatting intact and stacks the shares normally. Normalize is a
  // share-of-total (all-positive) view; for diverging data shares are computed against the
  // positive sum (the brief scopes normalize to the cumulative case).
  let stackData = data;
  if (normalize) {
    const totalByCat = new Map<string, number>();
    for (const r of data) {
      const y = r._y;
      if (!Number.isFinite(y as number) || y == null || (y as number) < 0) continue;
      const cat = (r as unknown as Record<string, unknown>)[catField] as string;
      totalByCat.set(cat, (totalByCat.get(cat) ?? 0) + (y as number));
    }
    stackData = data.map((r) => {
      const y = r._y;
      if (!Number.isFinite(y as number) || y == null) return r;
      const cat = (r as unknown as Record<string, unknown>)[catField] as string;
      const total = totalByCat.get(cat) ?? 0;
      return { ...r, _y: total ? ((y as number) / total) * 100 : 0 };
    });
  }
  const stackMark = horizontal
    ? Plot.barX(stackData, { y: catField, x: "_y", fill: fillChannel })
    : Plot.barY(stackData, { x: catField, y: "_y", fill: fillChannel });

  const overlay: unknown[] = [stackMark];

  // --- Net total markers ---
  const netRows = categories.map((cat) => ({
    _xc: cat,
    net: netByCat.get(cat) ?? 0,
    posTop: posSumByCat.get(cat) ?? 0,
  }));

  if (netMode === "text") {
    // Text above the stack top (= positive sum, since no negatives in this branch). 10pt
    // 700 text_heading, baseline 6px above the top.
    const common = {
      text: (d: { net: number }) => netFmt(d.net),
      fill: TBL.color.heading,
      fontSize: 10,
      fontWeight: 700,
    };
    overlay.push(
      horizontal
        ? Plot.text(netRows, { ...common, y: "_xc", x: "posTop", textAnchor: "start", dx: 6 })
        : Plot.text(netRows, { ...common, x: "_xc", y: "posTop", textAnchor: "middle", dy: -6 }),
    );
  } else if (netMode === "dot") {
    // Black-stroked white dot at the true net y, plus a signed value label below.
    const netLabelFill = spec.barStack?.netLabelColor === "black" ? MARK_BLACK : WHITE;
    if (horizontal) {
      overlay.push(
        Plot.dot(netRows, {
          y: "_xc",
          x: "net",
          r: 7,
          fill: WHITE,
          stroke: MARK_BLACK,
          strokeWidth: 1.5,
        }),
        Plot.text(netRows, {
          y: "_xc",
          x: "net",
          text: (d: { net: number }) => netFmt(d.net),
          fill: netLabelFill,
          fontSize: 10,
          fontWeight: 700,
          textAnchor: "middle",
          dy: 19,
        }),
      );
    } else {
      overlay.push(
        Plot.dot(netRows, {
          x: "_xc",
          y: "net",
          r: 7,
          fill: WHITE,
          stroke: MARK_BLACK,
          strokeWidth: 1.5,
        }),
        Plot.text(netRows, {
          x: "_xc",
          y: "net",
          text: (d: { net: number }) => netFmt(d.net),
          fill: netLabelFill,
          fontSize: 10,
          fontWeight: 700,
          textAnchor: "middle",
          dy: 19,
        }),
      );
    }
  }

  // --- Segment labels ---
  // Suppressed entirely when net is a dot (diverging). For cumulative (text) they are
  // OPTIONAL, default OFF — only when spec.valueLabels.show === true.
  if (netMode !== "dot" && spec.valueLabels?.show === true) {
    // Mono light tiers (the two lightest, 100 & 200 per the Style-Guide) get dark text;
    // everything else white. monoScale returns darkest-first, so the light tiers are the
    // last two hexes assigned.
    let lightSeries: Set<string> | null = null;
    if (monoTierForSeries) {
      const lightHexes = new Set(monoScale(monoBase as string, seriesNames.length).slice(-2));
      lightSeries = new Set<string>();
      for (const [s, hex] of monoTierForSeries) if (lightHexes.has(hex)) lightSeries.add(s);
    }
    overlay.push(
      ...buildSegmentLabels(data, categories, {
        catField,
        rank,
        posSumByCat,
        normalize,
        horizontal,
        plotHeight: ctx.plotHeight ?? 0,
        plotWidth: ctx.plotWidth ?? 0,
        mono: monoBase != null,
        lightSeries,
        fmt: segFmt,
      }),
    );
  }

  // --- Rect tagging order ---
  // Plot 0.6.16 stacked barY/barX emits one <rect> per (category, series) row that is
  // PRESENT in the data (a null-value row still yields a zero-height rect; an OMITTED
  // (cat,series) pair yields no rect — verified empirically, opposite of the faceted bar
  // case). Rects appear category-major, and within a category in stack/declaration order.
  // Build the order to match: for each category (declaration order), the present series in
  // seriesNames order.
  const presentByCat = new Map<string, Set<string>>();
  for (const r of data) {
    const cat = (r as unknown as Record<string, unknown>)[catField] as string;
    if (!categories.includes(cat)) continue;
    let set = presentByCat.get(cat);
    if (!set) {
      set = new Set<string>();
      presentByCat.set(cat, set);
    }
    set.add(r.series);
  }
  const rectSeriesOrder: string[] = [];
  for (const cat of categories) {
    const present = presentByCat.get(cat);
    if (!present) continue;
    for (const s of seriesNames) if (present.has(s)) rectSeriesOrder.push(s);
  }

  // --- Legend extras: diverging stacks add a "Total" dot row (A8 renders it) ---
  const legendExtras =
    netMode === "dot" ? [{ label: "Total", markerShape: "dot" as const }] : undefined;

  if (horizontal) {
    return {
      underlay: [],
      overlay,
      tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder: rectSeriesOrder }],
      dashedNames: new Set<string>(),
      yScaleOpts: { type: "band", domain: categories, padding: 0.2, axis: null },
      xAxisMarks: tblBandYAxis(categories),
      seriesColors,
      legendVisualOrder,
      ...(legendExtras ? { legendExtras } : {}),
    };
  }

  return {
    underlay: [],
    overlay,
    tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder: rectSeriesOrder }],
    dashedNames: new Set<string>(),
    // Single category band on `x`; refine outer pad like single-series bars. xScaleField
    // stays "x" → adapter's x labels are correct, no xAxisMarks override needed.
    xScaleOpts: { paddingInner: 0.2, paddingOuter: 0.2 },
    seriesColors,
    legendVisualOrder,
    ...(legendExtras ? { legendExtras } : {}),
  };
}

/** In-segment value labels, centered on each segment's midpoint. We compute the cumulative
 *  offsets ourselves (positive segments stack up from 0 in declaration order; negatives
 *  down from 0) so each label gets an explicit y (vertical) or x (horizontal) at the
 *  segment midpoint. For normalized stacks the offsets/values are share-of-total fractions
 *  (×100 to match the 0–100 axis). A segment whose pixel height/width is below the 25px
 *  threshold is suppressed. */
function buildSegmentLabels(
  data: PreparedRow[],
  categories: string[],
  opts: {
    catField: string;
    rank: Map<string, number>;
    posSumByCat: Map<string, number>;
    normalize: boolean;
    horizontal: boolean;
    plotHeight: number;
    plotWidth: number;
    mono: boolean;
    lightSeries: Set<string> | null;
    fmt: (d: number) => string;
  },
): unknown[] {
  const {
    catField, rank, posSumByCat, normalize,
    horizontal, plotHeight, plotWidth, mono, lightSeries, fmt,
  } = opts;

  // Per-category totals (sum of |value| on each side) for normalization shares.
  const posSumAbsByCat = posSumByCat; // positive sum already
  const negSumAbsByCat = new Map<string, number>();
  for (const r of data) {
    const y = r._y;
    if (!Number.isFinite(y as number) || y == null || (y as number) >= 0) continue;
    const cat = (r as unknown as Record<string, unknown>)[catField] as string;
    negSumAbsByCat.set(cat, (negSumAbsByCat.get(cat) ?? 0) - (y as number));
  }
  // Value-axis span in data units, for px-height estimation. Normalized → 0..100.
  const valueSpan = normalize
    ? 100
    : (() => {
        let max = 0;
        for (const c of categories) max = Math.max(max, posSumByCat.get(c) ?? 0);
        let minNeg = 0;
        for (const [, v] of negSumAbsByCat) minNeg = Math.max(minNeg, v);
        return (max + minNeg) || 1;
      })();
  const valueAxisPx = (horizontal ? plotWidth : plotHeight) || 0;

  // Compute label rows: for each category, walk positives up from 0 and negatives down,
  // in declaration order, tracking cumulative offsets.
  type LabelRow = { _xc: string; mid: number; text: string; light: boolean };
  const rows: LabelRow[] = [];
  for (const cat of categories) {
    const catRows = data.filter(
      (r) =>
        ((r as unknown as Record<string, unknown>)[catField] as string) === cat &&
        Number.isFinite(r._y as number) &&
        r._y != null,
    );
    // Order within the category by declaration rank, split by sign.
    const ordered = catRows
      .slice()
      .sort((a, b) => (rank.get(a.series) ?? 0) - (rank.get(b.series) ?? 0));
    const posTotal = posSumAbsByCat.get(cat) ?? 0;
    const negTotal = negSumAbsByCat.get(cat) ?? 0;
    let posCum = 0;
    let negCum = 0;
    for (const r of ordered) {
      const y = r._y as number;
      let segValue: number; // signed data-units height of the segment on the axis
      let mid: number; // axis position of the segment midpoint (data units)
      let labelNum: number; // number shown
      if (y >= 0) {
        segValue = normalize ? (posTotal ? (y / posTotal) * 100 : 0) : y;
        mid = posCum + segValue / 2;
        posCum += segValue;
        labelNum = segValue;
      } else {
        segValue = normalize ? (negTotal ? (Math.abs(y) / negTotal) * 100 : 0) : Math.abs(y);
        mid = -(negCum + segValue / 2);
        negCum += segValue;
        labelNum = normalize ? segValue : y;
      }
      // Suppress when the segment's pixel size is below the threshold.
      const segPx = valueAxisPx > 0 ? (segValue / valueSpan) * valueAxisPx : Infinity;
      if (Number.isFinite(segPx) && segPx < SEGMENT_LABEL_MIN_PX) continue;
      // Light mono tiers (100/200) get dark text; everything else white (§7).
      const light = mono && lightSeries != null && lightSeries.has(r.series);
      rows.push({ _xc: cat, mid, text: fmt(labelNum), light });
    }
  }

  if (!rows.length) return [];
  // Text color: white on categorical/dark mono; dark on light mono tiers (per-row).
  const fill = (d: LabelRow) => (d.light ? TBL.color.heading : WHITE);
  const common = { text: (d: LabelRow) => d.text, fill, fontSize: 10, fontWeight: 600 };
  return [
    horizontal
      ? Plot.text(rows, { ...common, y: "_xc", x: "mid", textAnchor: "middle" })
      : Plot.text(rows, { ...common, x: "_xc", y: "mid", textAnchor: "middle" }),
  ];
}
