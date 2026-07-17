// Figure-level orchestrator for small-multiples specs. Turns a spec carrying
// `small_multiples` into a multi-panel figure of N independent mini-SVGs laid out on a
// (col,row) grid. BOTH modes use the SAME per-pane composition (each pane is its own single
// frame with its own crosshair / dimming / selection). They differ only in the y-scale:
//   - per-pane: each pane computes its own y-domain (and shows its own y-tick labels).
//   - shared:   ALL panes use ONE y-domain (the union of the per-pane domains), and y-tick
//               LABELS show only on the leftmost column (col>0 panes hide them; gridlines +
//               plot area + left margin stay so panes remain aligned).
// BOTH modes support line/bar/stacked (each pane is an independent single frame, so grouped
// bars' own `fx` faceting never collides with the grid — the grid is CSS-composed).
import type { ChartSpec } from "../spec/types";
import { resolveColumns } from "../spec/columns";
import type { TidyRow } from "../data/index";
import type { PreparedRow, MarkLayers } from "./marks/index";
import { renderPane, buildLegendItems, buildShapeLegendItems } from "./index";
import type { LegendItem, ShapeLegendItem, RenderOptions } from "./index";
import { inferUnitsFromSubtitle } from "./util";
import { horizontalLeftGutter, labelLineCount, GUTTER_TEXT_PAD, FACETED_CAT_LABEL_PX, bandLabelMode, bandLabelMarginBottom, SECTION_SPACER_SLOTS } from "./axes";
import type { BandLabelMode } from "./axes";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, SHARED_LABELLESS_MARGIN_LEFT } from "./theme";

// Re-exported for back-compat (the constant now lives in theme.ts so leaf modules can import it
// without a module cycle through figure.ts).
export { SHARED_LABELLESS_MARGIN_LEFT } from "./theme";

/** Default grid-column count for `n` panes: ≈ ceil(sqrt(n)), capped at 4. */
function defaultColumns(n: number): number {
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
}

// Horizontal-bar height model (shared by the single-chart computeChartHeight and the faceted
// figure). A horizontal bar/figure grows with the number of category band SLOTS so the bars stay
// legible and the rows aren't cramped; the stakeholder blessed very tall horizontals.
/** Per-bar vertical budget (px): a grouped category reserves this PER SERIES, a single/stacked
 *  category reserves one. Tuned for legible-but-compact rows in tall horizontal charts. */
export const HORIZONTAL_PX_PER_BAR = 22;
/** Top/bottom margins + value-axis label row + a little slack. */
export const HORIZONTAL_CHROME_PX = 80;
/** Extra top margin reserved for a sectioned chart's first section header (sits above the first bar). */
export const SECTION_HEADER_TOP_PX = 16;
/** Estimated wrapped-label line height (px), sized for the faceted category-label font. */
const HORIZONTAL_LABEL_LINE_PX = 16;
/** Floor so a short horizontal chart isn't smaller than a vertical one. */
const HORIZONTAL_HEIGHT_FLOOR = 400;

/** Intrinsic height (px) of a horizontal bar chart / faceted figure. Each category band slot is
 *  tall enough for its bars (grouped → nSeries bars) OR its wrapped label, whichever is taller;
 *  section spacer slots add one slot each. Floored at the vertical default. */
export function horizontalBarHeight(opts: {
  nCategories: number;
  nSeries: number;
  grouped: boolean;
  nSpacers: number;
  maxLabelLines: number;
  /** Extra top-margin px (sectioned charts reserve room for the first section header). */
  extraTopPx?: number;
}): number {
  const { nCategories, nSeries, grouped, nSpacers, maxLabelLines, extraTopPx = 0 } = opts;
  const barsPerCat = grouped ? Math.max(1, nSeries) : 1;
  const catBarPx = barsPerCat * HORIZONTAL_PX_PER_BAR;
  const labelPx = Math.max(1, maxLabelLines) * HORIZONTAL_LABEL_LINE_PX + 6;
  // Uniform band → every slot (category or spacer) is the same height; size it to the taller of
  // the bar budget and the wrapped-label budget so neither is clipped.
  const slotPx = Math.max(catBarPx, labelPx);
  const inner = (nCategories + Math.max(0, nSpacers)) * slotPx;
  return Math.max(HORIZONTAL_HEIGHT_FLOOR, Math.round(inner + HORIZONTAL_CHROME_PX + extraTopPx));
}

/** Intrinsic px height of a SINGLE horizontal bar/stacked chart. Single source of truth shared by
 *  the live mount (computeChartHeight) and the PNG export (buildExportSvg), so per-row height,
 *  section-spacer reservation and the export frame all agree. Caller must confirm the chart is a
 *  horizontal bar/stacked before calling. */
export function horizontalBarChartHeight(spec: ChartSpec, rows: TidyRow[]): number {
  const cols = resolveColumns(spec, rows);
  const categories = orderedCategories(rows, cols.x, spec);
  const nCats = Math.max(1, categories.length);
  const series = new Set<string>();
  for (const r of rows) {
    const s = cols.series ? (r[cols.series] as string) : "";
    if (s) series.add(s);
  }
  const nSeries =
    spec.series_order && spec.series_order.length ? spec.series_order.length : Math.max(1, series.size);
  const grouped = spec.chartType === "bar" && nSeries > 1;
  const nSections = cols.section ? countSections(rows, cols.x, cols.section, spec, categories) : 0;
  const nSpacers = Math.max(0, nSections - 1) * SECTION_SPACER_SLOTS;
  const gutter = horizontalLeftGutter(categories, { fontSize: FACETED_CAT_LABEL_PX });
  const maxLabelLines = categories.reduce(
    (m, c) => Math.max(m, labelLineCount(c, gutter - GUTTER_TEXT_PAD, FACETED_CAT_LABEL_PX)),
    1,
  );
  return horizontalBarHeight({
    nCategories: nCats,
    nSeries,
    grouped,
    nSpacers,
    maxLabelLines,
    extraTopPx: nSections > 0 ? SECTION_HEADER_TOP_PX : 0,
  });
}

/** Fixed per-pane px height for a small-multiples figure, by chart type — the single source of
 *  truth shared by the live figure mount (render-live) and the PNG export (export-png), so the
 *  two can't drift (the export previously omitted waterfall's taller pane, squashing it to 240).
 *  Returns undefined for horizontal bar/stacked figures, whose height GROWS with row count:
 *  renderFigure computes it from horizontalBarHeight when opts.height is undefined. */
export function figurePaneHeight(spec: ChartSpec): number | undefined {
  const horizontal = spec.orientation === "horizontal";
  if (horizontal && (spec.chartType === "bar" || spec.chartType === "stacked")) return undefined;
  if (spec.chartType === "waterfall") return 420;
  if (spec.chartType === "dotplot" || spec.chartType === "bar" || spec.chartType === "stacked") return 320;
  return 240;
}

/** Count the distinct sections present (filtered + ordered by section_order, else encounter order)
 *  — i.e. the number of section spacer slots a sectioned horizontal axis inserts. */
function countSections(
  rows: TidyRow[],
  xField: string,
  sectionField: string,
  spec: ChartSpec,
  categories: string[],
): number {
  const sectionOf = new Map<string, string>();
  for (const r of rows) {
    const cat = r[xField] as string;
    const sec = r[sectionField] as string;
    if (cat && sec != null && !sectionOf.has(cat)) sectionOf.set(cat, sec);
  }
  const present = new Set<string>();
  for (const c of categories) present.add(sectionOf.get(c) ?? "");
  if (spec.section_order && spec.section_order.length) {
    return spec.section_order.filter((s) => present.has(s)).length;
  }
  return present.size;
}

/** The category (band) values in render order, SHARED across every pane (so each pane's category
 *  band — and the left-gutter sizing — match): x_order first when set, then data-encounter order.
 *  Used by faceted horizontal bars to size the one shared category gutter. */
function orderedCategories(rows: TidyRow[], xField: string, spec: ChartSpec): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[xField] as string;
    if (v != null && v !== "" && !set.has(v)) {
      set.add(v);
      seen.push(v);
    }
  }
  if (spec.x_order && spec.x_order.length) {
    const order = spec.x_order;
    const rank = new Map(order.map((c, i) => [c, i] as const));
    seen.sort((a, b) => (rank.get(a) ?? order.length) - (rank.get(b) ?? order.length));
  }
  return seen;
}

/** SHARED-mode small-multiples per-row width math (the single source of truth, reused by the
 *  live grid and the PNG export). Given the TOTAL inner grid width `availW` (the width the row
 *  of panes spans, minus inter-column gaps already accounted for by the caller), the column
 *  count and the inter-column gap, compute:
 *   - `dataW`: the inner DATA/plot width, IDENTICAL for every column (so the series renders at
 *     the same apparent width in every pane);
 *   - `colWidths[c]`: each column's OUTER width — the leftmost (labeled) column is wider (it
 *     carries the full TBL_MARGIN_LEFT label gutter), the label-less columns are narrower (they
 *     only reserve SHARED_LABELLESS_MARGIN_LEFT);
 *   - `marginLeft[c]`: the per-column left margin (TBL_MARGIN_LEFT for col 0, the small margin
 *     otherwise) to thread into renderPane.
 *
 *  Width identity (per the brief):
 *    dataW    = (availW − LM − (C−1)·lm − C·R − (C−1)·G) / C
 *    colW[0]  = dataW + LM + R
 *    colW[c>0]= dataW + lm + R
 *  For C=1 there is no label-less column, so dataW = availW − LM − R.
 *  The colWidths sum to availW − (C−1)·G (i.e. they tile the row exactly, leaving the gaps). */
export function sharedColumnWidths(
  availW: number,
  columns: number,
  gap: number,
  leftMargin: number = TBL_MARGIN_LEFT,
  weights?: number[],
): { dataW: number; colWidths: number[]; marginLeft: number[] } {
  // The leftmost (labeled) column's left margin. For vertical charts this is the y-label gutter
  // (TBL_MARGIN_LEFT); for faceted horizontal bars the caller passes the wider category gutter.
  const LM = leftMargin;
  const lm = SHARED_LABELLESS_MARGIN_LEFT;
  const R = TBL_MARGIN_RIGHT;
  const C = Math.max(1, columns);
  // Total DATA width the row's columns share (after the left gutter, per-column right margins and
  // inter-column gaps). Split it by `weights` (default all-ones ⇒ equal ⇒ byte-identical to before).
  const totalDataW =
    C === 1 ? availW - LM - R : availW - LM - (C - 1) * lm - C * R - (C - 1) * gap;
  const w = weights && weights.length === C ? weights : Array.from({ length: C }, () => 1);
  const sumW = w.reduce((a, b) => a + (b > 0 ? b : 0), 0) || C;
  const colWidths: number[] = [];
  const marginLeft: number[] = [];
  let firstDataW = totalDataW;
  for (let c = 0; c < C; c++) {
    const isLeft = c === 0;
    const ml = isLeft ? LM : lm;
    const dataW = (totalDataW * Math.max(0, w[c] as number)) / sumW;
    if (c === 0) firstDataW = dataW;
    marginLeft.push(ml);
    colWidths.push(dataW + ml + R);
  }
  // `dataW` retained for API compatibility (informational — col 0's data width; per-column widths
  // now differ when weighted, so read colWidths/marginLeft for exact values).
  return { dataW: firstDataW, colWidths, marginLeft };
}

/** PER-PANE-mode column widths. Unlike shared mode, EVERY pane draws its own y-axis, so every
 *  column reserves the full label gutter (TBL_MARGIN_LEFT) — not just col 0. The inner DATA width
 *  is split among the columns by `weights` (default all-ones ⇒ equal). Columns tile `availW`
 *  exactly, leaving the inter-column gaps:
 *    totalDataW = availW − C·LM − C·R − (C−1)·G
 *    colW[c]    = totalDataW·(w[c]/Σw) + LM + R
 *  For C=1 there is a single column: colW[0] = availW. */
export function perPaneColumnWidths(
  availW: number,
  columns: number,
  gap: number,
  weights?: number[],
): { colWidths: number[] } {
  const LM = TBL_MARGIN_LEFT;
  const R = TBL_MARGIN_RIGHT;
  const C = Math.max(1, columns);
  const totalDataW = availW - C * LM - C * R - (C - 1) * gap;
  const w = weights && weights.length === C ? weights : Array.from({ length: C }, () => 1);
  const sumW = w.reduce((a, b) => a + (b > 0 ? b : 0), 0) || C;
  const colWidths: number[] = [];
  for (let c = 0; c < C; c++) {
    const dataW = (totalDataW * Math.max(0, w[c] as number)) / sumW;
    colWidths.push(dataW + LM + R);
  }
  return { colWidths };
}

/** A pane's identity + its standalone SVG and per-pane interaction metadata. BOTH modes
 *  populate every field the same way (each pane is its OWN single-frame SVG with its own
 *  crosshair / dimming / selection); shared mode only forces a common y-domain and hides the
 *  y-tick labels on non-leftmost columns. */
export interface FigurePane {
  value: string;
  title: string;
  /** This pane's standalone SVG. */
  svg?: SVGSVGElement;
  /** Rows actually rendered in this pane (series-filtered), for the crosshair. */
  dataInScope?: PreparedRow[];
  /** This pane's series → resolved color map. */
  colors?: Map<string, string>;
  /** This pane's resolved series order. */
  seriesOrder?: string[];
  /** This pane's dashed series. */
  dashedNames?: Set<string>;
  /** This pane's units (each pane infers independently). */
  units?: string;
  /** This pane's x-value parse/format for the crosshair. */
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** Stacked panes: net-dot mode for the band crosshair's Total row. Mirrors
   *  MarkLayers.showTotalDot — line/bar panes leave this undefined. */
  showTotalDot?: boolean;
  /** Stacked panes: visual top→bottom stack order, for the band crosshair's
   *  Total/series ordering. Line/bar panes leave this undefined. */
  legendVisualOrder?: string[];
}

export interface FigureRenderResult {
  mode: "shared" | "per-pane";
  /** Always undefined now — both modes are per-pane compositions (no combined SVG). Retained
   *  for API/back-compat with callers that still check `combinedSvg in result`. */
  combinedSvg?: SVGSVGElement;
  panes: FigurePane[];
  columns: number;
  rows: number;
  /** SHARED mode only: the per-column OUTER pixel widths (length === `columns`) the panes were
   *  rendered at — col 0 wider (labeled), col>0 narrower (label-less), all sharing one inner data
   *  width. The live grid sets `grid-template-columns` to these px widths and the PNG export lays
   *  the panes out the same way. Undefined for per-pane mode (equal `1fr` columns). */
  columnWidths?: number[];
  legendItems: LegendItem[] | null;
  /** Point-chart figures with dual color/shape encoding: the SHAPE legend rows (else null). */
  shapeLegendItems?: ShapeLegendItem[] | null;
  colorLegendTitle?: string;
  shapeLegendTitle?: string;
  seriesLabels: Record<string, string>;
  // Fields render-live / export read (mirrors RenderResult's interaction surface).
  colors: Map<string, string>;
  seriesOrder: string[];
  dashedNames: Set<string>;
  units: string;
  xAxisTitle: string | null;
  dataInScope: PreparedRow[];
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** Visual top-to-bottom stack order of the interactive series (stacked panes only; line
   *  panes leave this undefined). Mirrors RenderResult.legendVisualOrder. */
  legendVisualOrder?: string[];
  /** Net-dot mode for the band crosshair's Total row (stacked panes only; line panes leave
   *  this undefined). Mirrors RenderResult.showTotalDot. */
  showTotalDot?: boolean;
}

/**
 * Render a small-multiples figure. Requires `spec.small_multiples`.
 *
 * Both modes: partition + order panes → grid layout → render N independent single-frame panes.
 * Shared mode (default) additionally probe-renders over all in-scope rows for ONE shared
 * y-domain, then forces it on every pane and hides the y-tick labels on non-leftmost columns.
 */
export function renderFigure(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
): FigureRenderResult {
  const sm = spec.small_multiples;
  if (!sm) throw new Error("renderFigure called without spec.small_multiples.");
  const mode = sm.mode ?? "shared";

  const cols = resolveColumns(spec, rows);
  const facetField = cols.facet;
  if (!facetField) {
    throw new Error("small_multiples requires a facet column (set columns.facet).");
  }

  // Horizontal bars: the category axis runs down the left gutter (shared across panes). Compute the
  // shared category set, gutter, section-spacer count and tallest wrapped label ONCE here, so the
  // gutter sizing, category-label suppression and the auto-grown figure HEIGHT all agree across
  // panes. (Vertical / non-bar figures keep the default chrome + caller height.)
  // Horizontal bar AND horizontal stacked share the left-gutter / category-label / auto-height
  // chrome. A stack is one bar slot per category (never grouped-by-series), so isHorizontalStacked
  // gates the two places that differ: the auto-height `grouped` flag and the equal-bar weight.
  const isHorizontalStacked = spec.chartType === "stacked" && spec.orientation === "horizontal";
  const isHorizontalBar =
    (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal";
  const sharedCategories = isHorizontalBar ? orderedCategories(rows, cols.x, spec) : [];
  // Size the gutter at the (larger) faceted category-label font so wrapped labels fit.
  const hGutter = isHorizontalBar
    ? horizontalLeftGutter(sharedCategories, { fontSize: FACETED_CAT_LABEL_PX })
    : TBL_MARGIN_LEFT;
  // Auto-height: grow the panes with the row count when the caller doesn't force a height.
  let autoHeight: number | undefined;
  if (isHorizontalBar && opts.height == null) {
    const nSeries =
      spec.series_order && spec.series_order.length
        ? spec.series_order.length
        : new Set(rows.map((r) => (cols.series ? (r[cols.series] as string) : "")).filter((s) => s !== "")).size;
    // First section has no spacer slot (its header sits in the top margin), so spacers = sections − 1,
    // each reserving a SECTION_SPACER_SLOTS-slot block.
    const nSections = cols.section ? countSections(rows, cols.x, cols.section, spec, sharedCategories) : 0;
    const nSpacers = Math.max(0, nSections - 1) * SECTION_SPACER_SLOTS;
    const maxPx = hGutter - GUTTER_TEXT_PAD;
    const maxLabelLines = sharedCategories.reduce(
      (m, c) => Math.max(m, labelLineCount(c, maxPx, FACETED_CAT_LABEL_PX)),
      1,
    );
    // Height sizes to the BUSIEST pane's category count, not the union: with one-facet-per-row
    // (disjoint categories) each pane should be sized to its own rows, not the total. When facets
    // share categories (the common case), the busiest pane == the union, so this is unchanged.
    const catsByFacet = new Map<string, Set<string>>();
    for (const r of rows) {
      const f = facetField ? (r[facetField] as string) : "";
      const c = r[cols.x] as string;
      if (!c) continue;
      if (!catsByFacet.has(f)) catsByFacet.set(f, new Set());
      catsByFacet.get(f)!.add(c);
    }
    const maxPaneCats = Math.max(1, ...[...catsByFacet.values()].map((s) => s.size));
    autoHeight = horizontalBarHeight({
      nCategories: maxPaneCats,
      nSeries: Math.max(1, nSeries),
      grouped: nSeries > 1 && !isHorizontalStacked,
      nSpacers,
      maxLabelLines,
      extraTopPx: nSections > 0 ? SECTION_HEADER_TOP_PX : 0,
    });
  }
  const effHeight = opts.height ?? autoHeight;

  // 1. Partition + order panes. Distinct facet values in data-encounter order, then reorder +
  //    filter by pane_order when set (pane_order names the included panes, in order).
  const encounterOrder: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[facetField] as string;
    if (v != null && v !== "" && !seen.has(v)) {
      seen.add(v);
      encounterOrder.push(v);
    }
  }
  const paneValues =
    sm.pane_order && sm.pane_order.length
      ? sm.pane_order.filter((v) => seen.has(v))
      : encounterOrder;

  if (!paneValues.length) throw new Error("No panes: facet_field produced no values in scope.");

  // 2. Grid layout. columns = config else default; rows = ceil(n / columns). col = i % columns,
  //    row = floor(i / columns).
  // Column count: a live-layer override (responsive reflow) wins, else the spec config, else the
  // default — which is a SINGLE ROW when pane_widths is set (variable widths are per-column across
  // one row of panes), and the ≈ceil(sqrt(n)) grid otherwise. Clamp to [1, paneValues.length].
  const variableWidths = sm.pane_widths != null && sm.pane_widths !== "equal";
  const requestedColumns = opts.columns && opts.columns > 0
    ? opts.columns
    : sm.columns && sm.columns > 0
      ? sm.columns
      : variableWidths
        ? paneValues.length
        : defaultColumns(paneValues.length);
  const columns = Math.max(1, Math.min(requestedColumns, paneValues.length));
  const gridRows = Math.ceil(paneValues.length / columns);

  const titles = sm.pane_titles ?? {};
  const titleFor = (value: string): string => titles[value] ?? value;
  const seriesLabels = spec.series_labels ?? {};

  // Variable pane widths (`pane_widths`) — used by BOTH modes. Resolve the per-column weight
  // vector once here: a proportion array is used directly; "equal-bar" weights each column by its
  // busiest pane's bar count; "equal"/unset ⇒ undefined (uniform). The TOTAL inner grid width is
  // `opts.gridWidth` (live grid) else `opts.width` (golden tests pass one width as the row total).
  const gridGap = opts.gridGap ?? 0;
  const availW = opts.gridWidth ?? opts.width ?? 720;
  let colWeights: number[] | undefined;
  {
    const pw = sm.pane_widths;
    if (Array.isArray(pw) && pw.length === columns) {
      colWeights = pw;
    } else if (pw === "equal-bar") {
      const barCount = (value: string): number => {
        const pr = rows.filter((r) => (r[facetField] as string) === value);
        const catSet = new Set<string>();
        const serSet = new Set<string>();
        for (const r of pr) {
          const c = r[cols.x] as string;
          if (c) catSet.add(c);
          const s = cols.series ? (r[cols.series] as string) : "";
          if (s) serSet.add(s);
        }
        // A stack is one bar per category; a grouped bar is category × series bars.
        return isHorizontalStacked
          ? Math.max(1, catSet.size)
          : Math.max(1, catSet.size) * Math.max(1, serSet.size);
      };
      const weights = Array.from({ length: columns }, () => 0);
      paneValues.forEach((v, i) => {
        const col = i % columns;
        weights[col] = Math.max(weights[col] as number, barCount(v));
      });
      colWeights = weights;
    }
  }

  // Vertical categorical facets: coordinate the x-axis label layout so panes' baselines align — used
  // by BOTH modes. Each pane would otherwise pick single/wrap/rotate from ITS own width + category
  // count, so a pane that rotates (or has longer labels) reserves a taller bottom margin and drops
  // its baseline below the others'. Given each column's inner DATA width, force (a) the WORST-CASE
  // mode across panes for a consistent look, and (b) the MAX bottom margin so every pane reserves
  // the same space. Returns {} for horizontal bars / non-categorical x (no coordination needed).
  const coordinateXLabels = (
    dataWByCol: number[],
  ): { mode?: BandLabelMode; marginBottom?: number } => {
    if (isHorizontalBar || spec.xAxisType !== "categorical") return {};
    const rank: Record<BandLabelMode, number> = { single: 0, wrap: 1, rotate: 2 };
    const paneCats = paneValues.map((value, i) => {
      const col = i % columns;
      const catList = Array.from(
        new Set(rows.filter((r) => (r[facetField] as string) === value).map((r) => r[cols.x] as string).filter(Boolean)),
      );
      return { cats: catList, mode: bandLabelMode(catList, dataWByCol[col] ?? 0) };
    });
    let worst: BandLabelMode = "single";
    for (const p of paneCats) if (rank[p.mode] > rank[worst]) worst = p.mode;
    return { mode: worst, marginBottom: Math.max(...paneCats.map((p) => bandLabelMarginBottom(p.cats, worst))) };
  };

  // PER-PANE mode: each pane is its OWN single-frame SVG with an independent y-scale, units,
  // and x-domain (Plot faceting can't give independent y-scales, so we render + compose N
  // mini-SVGs instead of one faceted SVG). Each pane gets a distinct deterministic
  // classNameSuffix ("p0", "p1", …) so clip-path ids stay unique across the composed DOM, and
  // `pane: true` thins its line stroke.
  if (mode === "per-pane") {
    // Keep the first pane's full PaneResult so the figure-level legend reads its real mark
    // layers (rect swatches for bar/stacked, the diverging-stack "Total" extra, mono/categorical
    // seriesColors). Line panes carry a dashedNames-only layer, so this is a no-op for them.
    // Variable pane widths in per-pane mode: distribute the inner data width by the resolved
    // weights, but EVERY column keeps its own full y-label gutter (independent axes). Absent
    // (equal) ⇒ leave widths undefined so the live grid uses equal `1fr` columns as before.
    // EXCEPT horizontal bars: the category gutter is asymmetric (pane 0 carries the shared
    // gutter, col>0 panes only the small label-less margin — see the categoryGutter threading
    // below), so equal OUTER widths would give col>0 panes a much wider inner DATA width and the
    // same value would render as visibly different bar lengths across panes. Use the shared-mode
    // width math (sharedColumnWidths with the category gutter as col 0's left margin) so the
    // inner data width is IDENTICAL across a row, exactly like the shared branch.
    const perPaneWidths = isHorizontalBar
      ? sharedColumnWidths(availW, columns, gridGap, hGutter, colWeights).colWidths
      : variableWidths
        ? perPaneColumnWidths(availW, columns, gridGap, colWeights).colWidths
        : undefined;
    // Coordinate x-label rotation/wrap + bottom margin across panes so their baselines align — each
    // pane draws its own x-axis, so a pane with longer/rotated labels would otherwise sit lower.
    // Data width per column: the variable per-pane widths, else the single equal pane width.
    const perPaneDataW = perPaneWidths
      ? perPaneWidths.map((w) => w - TBL_MARGIN_LEFT - TBL_MARGIN_RIGHT)
      : Array.from({ length: columns }, () => (opts.width ?? availW) - TBL_MARGIN_LEFT - TBL_MARGIN_RIGHT);
    const { mode: ppXLabelMode, marginBottom: ppMarginBottom } = coordinateXLabels(perPaneDataW);
    let firstLayers: MarkLayers | undefined;
    const panes: FigurePane[] = paneValues.map((value, i) => {
      // Restrict the rows to this pane (own y-domain/units/x-domain). No facetInfo → renderPane
      // renders a standalone single frame for these rows only.
      const paneRows = rows.filter((r) => (r[facetField] as string) === value);
      const col = i % columns;
      const p = renderPane(
        spec,
        paneRows,
        {
          ...opts,
          height: effHeight,
          pane: true,
          paneFacetValue: value,
          ...(perPaneWidths ? { width: perPaneWidths[col] } : {}),
          ...(ppXLabelMode ? { xLabelMode: ppXLabelMode } : {}),
          ...(ppMarginBottom != null ? { marginBottom: ppMarginBottom } : {}),
          // Horizontal bars: mirror the shared-mode category-gutter/label suppression (see below)
          // so a sectioned per-pane facet also reads as one figure — pane 0 carries the section
          // headers + category labels, other panes in the row keep only their bars + value ticks.
          // Independent y-domains are unaffected (that's what "per-pane" governs); this only
          // assumes every pane shares one category axis, same as shared mode always has.
          ...(isHorizontalBar
            ? {
                categoryGutter: col === 0 ? hGutter : SHARED_LABELLESS_MARGIN_LEFT,
                hideCategoryLabels: col > 0,
              }
            : {}),
        },
        `p${i}`,
      );
      if (i === 0) firstLayers = p.layers;
      return {
        value,
        title: titleFor(value),
        svg: p.svg,
        dataInScope: p.dataInScope,
        colors: p.colors,
        seriesOrder: p.seriesNames,
        dashedNames: p.layers.dashedNames,
        units: p.units || inferUnitsFromSubtitle(spec.subtitle),
        tooltipXParse: p.tooltipXParse,
        tooltipXFormat: p.tooltipXFormat,
        showTotalDot: p.layers.showTotalDot,
        legendVisualOrder: p.layers.legendVisualOrder,
      };
    });

    // Figure-level legend: series config is shared across panes, so compute it ONCE from the
    // first pane's series/colors + its mark layers (same source of truth as a single chart).
    const first = panes[0];
    const legendItems = buildLegendItems(
      spec,
      first?.seriesOrder ?? [],
      first?.colors ?? new Map(),
      firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set() },
    );

    return {
      mode: "per-pane",
      combinedSvg: undefined,
      panes,
      columns,
      rows: gridRows,
      ...(perPaneWidths ? { columnWidths: perPaneWidths } : {}),
      legendItems,
      shapeLegendItems: buildShapeLegendItems(spec, firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set() }),
      colorLegendTitle: spec.color_legend_title,
      shapeLegendTitle: spec.shape_legend_title,
      seriesLabels,
      colors: first?.colors ?? new Map(),
      seriesOrder: first?.seriesOrder ?? [],
      dashedNames: first?.dashedNames ?? new Set(),
      units: first?.units ?? inferUnitsFromSubtitle(spec.subtitle),
      xAxisTitle: spec.x_axis_title ?? null,
      dataInScope: first?.dataInScope ?? [],
      tooltipXParse: first?.tooltipXParse,
      tooltipXFormat: first?.tooltipXFormat,
      legendVisualOrder: firstLayers?.legendVisualOrder,
      showTotalDot: firstLayers?.showTotalDot,
    };
  }

  // SHARED mode: the SAME per-pane composition as above (N independent mini-SVGs in the grid,
  // each its own frame with its own crosshair / dimming / selection), with TWO differences:
  //   1. ALL panes use ONE shared y-domain, computed once over ALL in-scope rows.
  //   2. y-axis tick LABELS show only on the leftmost column (col 0); panes with col > 0 keep
  //      their gridlines + plot area + left margin but hide the tick label text (so panes stay
  //      aligned and the same width).
  // (The old Plot-faceting path — one combined SVG, collapseFacetGridChrome, facet-aware
  // crosshair — is retired; combinedSvg is now undefined for shared mode too.)

  // 1. Shared y-domain: probe EACH pane independently and UNION the per-pane domains. A single
  //    combined probe over all in-scope rows would, for STACKED bars, sum same-category rows
  //    ACROSS panes (panes share the x-categories) and inflate the scale. Probing per pane and
  //    unioning is correct for every chart type, and — because computeYAxis's nice-rounding is
  //    monotonic — yields exactly the combined-probe domain for line/single-series/grouped bars,
  //    so those stay unchanged. Each per-pane probe already applies the bar zero-baseline +
  //    value-label headroom, so the union endpoints carry it. Probe SVGs are discarded.
  let yLo = Infinity;
  let yHi = -Infinity;
  for (const value of paneValues) {
    const paneRows = rows.filter((r) => (r[facetField] as string) === value);
    const [lo, hi] = renderPane(
      spec,
      paneRows,
      { ...opts, height: effHeight, pane: true, paneFacetValue: value },
      "probe",
    ).yDomain;
    if (lo < yLo) yLo = lo;
    if (hi > yHi) yHi = hi;
  }
  const sharedYDomain: [number, number] = [yLo, yHi];

  // (isHorizontalBar / hGutter / effHeight were computed once at the top so the gutter, label
  //  suppression and the auto-grown height all agree across panes.)

  // 3. Per-row width math (single source: sharedColumnWidths). The label-less (non-leftmost)
  //    columns drop the label gutter for a small left margin; column OUTER widths are made unequal
  //    so the inner DATA width is IDENTICAL across a row (labeled col 0 wider, label-less cols
  //    narrower). `availW`/`gridGap`/`colWeights` were resolved once above (shared by both modes).
  const { colWidths, marginLeft: colMarginLeft } = sharedColumnWidths(
    availW,
    columns,
    gridGap,
    hGutter,
    colWeights,
  );

  // 3b. Vertical categorical facets: coordinate the x-axis label layout so panes' baselines align
  //     (shared by both modes — see coordinateXLabels). Data width per column: the shared-mode
  //     column outer width minus its own left margin + the right margin.
  const { mode: forcedXLabelMode, marginBottom: forcedMarginBottom } = coordinateXLabels(
    colWidths.map((w, c) => w - (colMarginLeft[c] as number) - TBL_MARGIN_RIGHT),
  );

  // 4. Render each pane as its own single frame at its column's OUTER width + left margin, forcing
  //    the shared y-domain. Vertical panes hide the y-tick LABELS on non-leftmost columns; horizontal
  //    bars instead pass the shared category gutter + suppress the CATEGORY labels there (and let the
  //    bar layer own the left margin, so the gutter sizing in the mark builder is authoritative).
  let firstLayers: MarkLayers | undefined;
  const panes: FigurePane[] = paneValues.map((value, i) => {
    const col = i % columns;
    const paneRows = rows.filter((r) => (r[facetField] as string) === value);
    const p = renderPane(
      spec,
      paneRows,
      {
        ...opts,
        height: effHeight,
        pane: true,
        paneFacetValue: value,
        yDomain: sharedYDomain,
        width: colWidths[col],
        ...(forcedXLabelMode ? { xLabelMode: forcedXLabelMode } : {}),
        ...(forcedMarginBottom != null ? { marginBottom: forcedMarginBottom } : {}),
        ...(isHorizontalBar
          ? {
              categoryGutter: col === 0 ? hGutter : SHARED_LABELLESS_MARGIN_LEFT,
              hideCategoryLabels: col > 0,
            }
          : {
              hideYAxisLabels: col > 0,
              marginLeft: colMarginLeft[col],
            }),
      },
      `p${i}`,
    );
    if (i === 0) firstLayers = p.layers;
    return {
      value,
      title: titleFor(value),
      svg: p.svg,
      dataInScope: p.dataInScope,
      colors: p.colors,
      seriesOrder: p.seriesNames,
      dashedNames: p.layers.dashedNames,
      units: p.units || inferUnitsFromSubtitle(spec.subtitle),
      tooltipXParse: p.tooltipXParse,
      tooltipXFormat: p.tooltipXFormat,
      showTotalDot: p.layers.showTotalDot,
      legendVisualOrder: p.layers.legendVisualOrder,
    };
  });

  // 4. Figure-level legend: series config is shared across panes, so compute it ONCE from the
  //    first pane (same source of truth as a single chart). L1/single-series → null.
  const first = panes[0];
  const legendItems = buildLegendItems(
    spec,
    first?.seriesOrder ?? [],
    first?.colors ?? new Map(),
    firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set() },
  );

  return {
    mode: "shared",
    combinedSvg: undefined,
    panes,
    columns,
    rows: gridRows,
    columnWidths: colWidths,
    legendItems,
    shapeLegendItems: buildShapeLegendItems(spec, firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set() }),
    colorLegendTitle: spec.color_legend_title,
    shapeLegendTitle: spec.shape_legend_title,
    seriesLabels,
    colors: first?.colors ?? new Map(),
    seriesOrder: first?.seriesOrder ?? [],
    dashedNames: first?.dashedNames ?? new Set(),
    units: first?.units ?? inferUnitsFromSubtitle(spec.subtitle),
    xAxisTitle: spec.x_axis_title ?? null,
    dataInScope: first?.dataInScope ?? [],
    tooltipXParse: first?.tooltipXParse,
    tooltipXFormat: first?.tooltipXFormat,
    legendVisualOrder: firstLayers?.legendVisualOrder,
    showTotalDot: firstLayers?.showTotalDot,
  };
}
