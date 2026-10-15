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
import type { ChartSpec, ValueAffixes } from "../spec/types";
import type { NetMode } from "../spec/bar-stack";
import { resolveColumns, isPreBinned, categoryOrderFor, SINGLE_SERIES_KEY } from "../spec/columns";
import { parseDate } from "../spec/parse-time";
import { ownValue } from "../spec/own-key";
import { sectionKeyer, categoryText, rowsInSectionOrder } from "../spec/section-key";
import { isHorizontalDumbbell as isHorizontalDumbbellSpec } from "../spec/dumbbell-orientation";
import { facetsDrawAsGroups } from "../spec/facet-groups";
import { figurePaneValues } from "../spec/panes";
import { computeThresholds, temporalThresholds } from "./histogram-bin";
import type { TidyRow } from "../data/index";
import type { PreparedRow, MarkLayers } from "./marks/index";
import { renderPane, paneXValues, singleChartDrawsNetDots, buildColorMap, buildLegendItems, buildSeriesKeyRows, buildShapeLegendItems, shapeDomainOver, paneValueExtent } from "./index";
import type { LegendItem, ShapeLegendItem, RenderOptions, PaneResult } from "./index";
import type { SharedXDomain } from "./x-adapter";
import { resolveValueAffixes, normalizeSpec } from "./util";
import { dumbbellRowExtent } from "./marks/dumbbell";
import { NET_DOT_ROW_PX } from "./marks/stacked";
import { rowBandGeometry, HBAND_PADDING_INNER, VBAND_PADDING_INNER, VBAND_PADDING_OUTER } from "./marks/category-band";
import { horizontalLeftGutter, labelLineCount, GUTTER_TEXT_PAD, FACETED_CAT_LABEL_PX, bandLabelMode, bandLabelMarginBottom, sectionGapPx, SECTION_LABEL_INDENT } from "./axes";
import type { BandLabelMode } from "./axes";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, SHARED_LABELLESS_MARGIN_LEFT, TBL_VALUE_LABEL } from "./theme";
import type { SeriesHatch } from "./hatch";
import type { OverlayTooltipLine } from "./overlays";


/** The figure legend's `series_patterns` textures: for each series, the hatch the FIRST pane that
 *  paints it was painted with.
 *
 *  A pane's own key rows take that pane's own painted hatches, so a pane's TOOLTIP is exact. The
 *  figure legend cannot be: it is ONE key over N panes, so if two panes painted a series over
 *  different grounds no single ground would match them all. It is taken from a pane rather than
 *  re-derived from `figureColors` because a derivation is the thing this whole path exists to
 *  remove — a ground the colour map names is not necessarily a ground any pane draws.
 *
 *  First-pane-wins is not arbitrary in practice: a series' colour is resolved ONCE for the whole
 *  figure and handed to every pane as `paletteSeries` (see `figureSeries` below — before that, a
 *  pane missing a series shifted the palette and painted a colour the legend contradicted), so
 *  every pane paints a given series the same ground and "first" is the only one there is. Panes
 *  are folded in ORDER and the first pane that paints a series wins, so a series the first pane
 *  lacks is still keyed. `test/key-agreement.test.ts` pins BOTH halves — the panes agreeing, and the
 *  figure legend following them; if a future per-pane fill breaks the first half, the figure legend
 *  names the first pane and the panes' own tooltips stay exact. */
function figureSeriesHatches(panePainted: Array<Map<string, SeriesHatch>>): Map<string, SeriesHatch> {
  return firstPainted(panePainted);
}

/** What the FIGURE's one legend key names, for a value each pane resolves for itself: the first pane
 *  that painted the series. Panes agree on colour figure-wide, so "first" is not a coin toss. */
function firstPainted<T>(perPane: Array<Map<string, T>>): Map<string, T> {
  const out = new Map<string, T>();
  for (const painted of perPane) {
    for (const [series, v] of painted) if (!out.has(series)) out.set(series, v);
  }
  return out;
}

/** Default grid-column count for `n` panes: ≈ ceil(sqrt(n)), capped at 4. */
function defaultColumns(n: number): number {
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
}

// Horizontal-bar height model (computeChartHeight and the PNG export). A horizontal bar chart grows with the number of category band SLOTS so the bars stay
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
/** A row-sized chart whose chrome-estimate height (horizontalBarHeight) is at least this keeps
 *  that height, byte for byte: these are the charts the old 400px floor never touched, every one
 *  already published among them. A shorter one is fitted to its rendered row band instead
 *  (fitRowsHeight), so its rows sit at exactly the slot pitch rather than spreading the estimate's
 *  spare chrome over a few rows. */
const CHROME_ESTIMATE_KEPT_PX = 400;

/** The chrome-estimate height (px) of a horizontal bar chart: each category band
 *  slot is tall enough for its bars (grouped → nSeries bars) OR its wrapped label, whichever is
 *  taller; each section break adds the fixed section gap; HORIZONTAL_CHROME_PX covers the rest
 *  (generously — the real margins are about half of it). */
export function horizontalBarHeight(opts: {
  nCategories: number;
  nSeries: number;
  grouped: boolean;
  /** Section breaks (sections − 1): each adds `sectionGapPx()`, not a band slot. */
  nSectionBreaks: number;
  maxLabelLines: number;
  /** Extra top-margin px (sectioned charts reserve room for the first section header). */
  extraTopPx?: number;
}): number {
  const { nCategories, nSeries, grouped, nSectionBreaks, maxLabelLines, extraTopPx = 0 } = opts;
  // Uniform band → every category slot is the same height; size it to the taller of the bar budget
  // and the wrapped-label budget so neither is clipped.
  const slotPx = rowSlotPx(grouped ? Math.max(1, nSeries) : 1, maxLabelLines);
  // The rows get at least as much as the gaps, so the render never shrinks a gap at this height
  // (axes.ts fittedSectionGapPx).
  const gapsPx = Math.max(0, nSectionBreaks) * sectionGapPx();
  const inner = Math.max(nCategories * slotPx, gapsPx) + gapsPx;
  return Math.round(inner + HORIZONTAL_CHROME_PX + extraTopPx);
}

type RowBand = { margins: number; inner: number; outer: number };

/** Plot's band-step divisor for `nRows` rows (rowBandGeometry). */
const bandSteps = (nRows: number, band: RowBand): number => Math.max(1, nRows - band.inner + 2 * band.outer);

/** The rows px at which a band of `nRows` rows renders exactly `pitch` (whole) px apart: the step
 *  is then under a px over `pitch` and wastes under a px in all, so Plot rounds it down to it. */
function rowsPxAtPitch(pitch: number, nRows: number, band: RowBand): number {
  return Math.ceil(pitch * bandSteps(nRows, band) - 1e-9);
}

/** Height of a row-sized chart. `estimate` (horizontalBarHeight) is kept from
 *  CHROME_ESTIMATE_KEPT_PX up; below that the height is the real margins + the section gaps +
 *  exactly `slotPx` per row, the rows taking at least as much as the gaps (as horizontalBarHeight). */
function fitRowsHeight(estimate: number, nRows: number, slotPx: number, gapsPx: number, band: RowBand): number {
  if (estimate >= CHROME_ESTIMATE_KEPT_PX) return estimate;
  return band.margins + gapsPx + Math.max(rowsPxAtPitch(slotPx, nRows, band), gapsPx);
}

/** The row slot (px) of a row-sized chart: one bar budget per bar in a category (a grouped bar has
 *  nSeries, a stack or dumbbell one), or the wrapped-label budget, whichever is taller. */
function rowSlotPx(barsPerCat: number, maxLabelLines: number): number {
  return Math.max(barsPerCat * HORIZONTAL_PX_PER_BAR, Math.max(1, maxLabelLines) * HORIZONTAL_LABEL_LINE_PX + 6);
}

/** The floors of a FITTED row slot (horizontalBarChartHeight's `maxHeight`, a framed export's
 *  `fitRows`), which compresses the pitch toward these and never past them.
 *
 *  Per label line: HORIZONTAL_LABEL_LINE_PX, without rowSlotPx's 6px pad. A wrapped label's lines
 *  are drawn 1em (FACETED_CAT_LABEL_PX, 13px) apart, so 16px a line still leaves 3px clear between
 *  neighbouring labels. With the pad, a one-line label's floor would be 22px, the unfitted pitch
 *  itself, and no single-series chart could be fitted at all. */
export const FIT_LABEL_LINE_PX = HORIZONTAL_LABEL_LINE_PX;
/** Per bar: a bar at least as thick as its value label is tall (TBL_VALUE_LABEL.fontSize), so labels
 *  beside neighbouring bars cannot overlap. A bar is the slot less the band's inner padding
 *  (HBAND_PADDING_INNER), and a grouped row splits its slot among its bars: 12 / 0.8 = 15px a bar. */
export const FIT_MIN_PX_PER_BAR = Math.ceil(TBL_VALUE_LABEL.fontSize / (1 - HBAND_PADDING_INNER));

/** Clear space a fitted row keeps between its own marks and its neighbours' (px): what the label floor
 *  leaves between neighbouring one-line labels, 16px a line less the 13px font. */
export const FIT_ROW_CLEAR_PX = FIT_LABEL_LINE_PX - FACETED_CAT_LABEL_PX;

/** The pitch (px) a row-sized chart's per-row MARKS need beyond its bars and labels, or 0: a horizontal
 *  dumbbell's dots, connector and gap label (dumbbellRowExtent), and a stack's net dot when it draws
 *  one (index.ts singleChartDrawsNetDots: the renderer's own row prep, series scope and predicate). Each row's marks are centred on the row, so a row needs its own reach above
 *  the centre plus the reach below the centre of the row before it, plus FIT_ROW_CLEAR_PX. */
function rowMarksPx(spec: ChartSpec, rows: TidyRow[]): number {
  if (isHorizontalDumbbellSpec(spec)) {
    const { above, below } = dumbbellRowExtent(spec);
    return Math.ceil(above + below + FIT_ROW_CLEAR_PX);
  }
  if (singleChartDrawsNetDots(spec, rows)) return Math.ceil(NET_DOT_ROW_PX + FIT_ROW_CLEAR_PX);
  return 0;
}

/** The smallest row slot (px) a fitted chart may compress to (FIT_LABEL_LINE_PX, FIT_MIN_PX_PER_BAR,
 *  and the row's own marks, rowMarksPx). */
function minRowSlotPx(barsPerCat: number, maxLabelLines: number, marksPx: number): number {
  return Math.max(barsPerCat * FIT_MIN_PX_PER_BAR, Math.max(1, maxLabelLines) * FIT_LABEL_LINE_PX, marksPx);
}

/** A row-sized chart of `natural` height fitted under `maxHeight` by compressing its row pitch only:
 *  margins and section gaps keep their size. A chart that already fits is unchanged (never
 *  expanded). The rows never compress below `minSlotPx` (Plot rounds a fractional step down to whole
 *  px, and the floor is whole, so the rendered pitch is at least the floor) nor below the gaps' total
 *  (as fitRowsHeight); when that floor binds, the height is the floor's and exceeds `maxHeight`. */
function fitRowsUnder(
  natural: number,
  maxHeight: number,
  nRows: number,
  minSlotPx: number,
  gapsPx: number,
  band: RowBand,
): number {
  if (natural <= maxHeight) return natural;
  const floorPx = band.margins + gapsPx + Math.max(rowsPxAtPitch(minSlotPx, nRows, band), gapsPx);
  return Math.min(natural, Math.max(maxHeight, floorPx));
}

/** Whether a chart's height grows with its category rows: horizontal bar/stacked, and a horizontal
 *  dumbbell (orientation omitted included). The one predicate the live mount (computeChartHeight)
 *  and the PNG export (buildExportSvg) both ask, so the two cannot drift apart. Such a chart is
 *  never a small-multiples figure: its facets draw as groups (spec/facet-groups.ts). */
export function growsWithRows(spec: ChartSpec): boolean {
  return (
    ((spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal") ||
    isHorizontalDumbbellSpec(spec)
  );
}

/** Intrinsic px height of a SINGLE chart whose height grows with its rows (`growsWithRows`:
 *  horizontal bar/stacked or horizontal dumbbell — a dumbbell is never grouped, so it sizes like a
 *  single-series bar). Single source of truth shared by the live mount (computeChartHeight) and the
 *  PNG export (buildExportSvg), so per-row height, section-gap reservation and the export frame
 *  all agree. No floor: a chart with few rows is short, its rows at the slot pitch (fitRowsHeight).
 *  Caller must confirm `growsWithRows(spec)` before calling.
 *
 *  `maxHeight` (a framed export's `fitRows`; the live mount never passes it) compresses the row
 *  pitch of a chart taller than it so the chart is exactly `maxHeight` tall, down to the floor of
 *  minRowSlotPx (fitRowsUnder). It never makes a chart taller. */
export function horizontalBarChartHeight(spec: ChartSpec, rows: TidyRow[], opts: { maxHeight?: number } = {}): number {
  spec = normalizeSpec(spec);
  const cols = resolveColumns(spec, rows);
  rows = inSectionOrder(spec, cols, rows);
  const keyOf = rowCategoryKey(rows, cols);
  const categories = orderedCategories(rows, keyOf, spec);
  const nCats = Math.max(1, categories.length);
  const series = new Set<string>();
  for (const r of rows) {
    const s = cols.series ? (r[cols.series] as string) : "";
    if (s) series.add(s);
  }
  const nSeries =
    spec.series_order && spec.series_order.length ? spec.series_order.length : Math.max(1, series.size);
  const grouped = spec.chartType === "bar" && nSeries > 1;
  const nSections = cols.section ? countSections(rows, keyOf, cols.section, spec, categories) : 0;
  // Sectioned labels are indented; the gutter grows by the indent, so the text width is unchanged.
  const indent = cols.section ? SECTION_LABEL_INDENT : 0;
  const gutter = horizontalLeftGutter(categories, { fontSize: FACETED_CAT_LABEL_PX, indent });
  const maxLabelLines = categories.reduce(
    (m, c) => Math.max(m, labelLineCount(categoryText(c), gutter - GUTTER_TEXT_PAD - indent, FACETED_CAT_LABEL_PX)),
    1,
  );
  const nSectionBreaks = Math.max(0, nSections - 1);
  const estimate = horizontalBarHeight({
    nCategories: nCats,
    nSeries,
    grouped,
    nSectionBreaks,
    maxLabelLines,
    extraTopPx: nSections > 0 ? SECTION_HEADER_TOP_PX : 0,
  });
  const barsPerCat = grouped ? nSeries : 1;
  const gapsPx = nSectionBreaks * sectionGapPx();
  const band = rowBandGeometry(spec.chartType, spec.x_axis_ticks, nSections > 0);
  const natural = fitRowsHeight(estimate, nCats, rowSlotPx(barsPerCat, maxLabelLines), gapsPx, band);
  if (opts.maxHeight === undefined) return natural;
  const marksPx = rowMarksPx(spec, rows);
  return fitRowsUnder(natural, opts.maxHeight, nCats, minRowSlotPx(barsPerCat, maxLabelLines, marksPx), gapsPx, band);
}

/** Fixed per-pane px height for a small-multiples figure, by chart type — the single source of
 *  truth shared by the live figure mount (render-live) and the PNG export (export-png), so the
 *  two can't drift (the export previously omitted waterfall's taller pane, squashing it to 240).
 *  A horizontal bar, stack or dumbbell is never a figure (its facets draw as groups), so a dumbbell
 *  pane here is a vertical one. */
export function figurePaneHeight(spec: ChartSpec): number {
  if (spec.chartType === "waterfall") return 420;
  if (spec.chartType === "dotplot" || spec.chartType === "bar" || spec.chartType === "stacked" || spec.chartType === "dumbbell") return 320;
  return 240;
}

/** Each raw row's category key, as renderPane's row prep assigns it (spec/section-key.ts): section +
 *  category when a label repeats across sections, else the category. Height and gutter sizing
 *  count rows by this key, so a repeated label is counted once per section, as it is drawn. */
function rowCategoryKey(rows: TidyRow[], cols: { x: string; section?: string | null }): (r: TidyRow) => string {
  const sectionField = cols.section;
  if (!sectionField) return (r) => (r[cols.x] as string) ?? "";
  return sectionKeyer(rows, (r) => r[cols.x] as string, (r) => r[sectionField] as string);
}

/** `rows` without those of a section `section_order` leaves out, as a pane's row prep drops them. */
function inSectionOrder(spec: ChartSpec, cols: { section?: string | null }, rows: TidyRow[]): TidyRow[] {
  const sectionField = cols.section;
  return rowsInSectionOrder(rows, spec.section_order, sectionField ? (r) => r[sectionField] as string : null);
}

/** Count the distinct sections present (filtered + ordered by section_order, else encounter order)
 *  — one more than the number of fixed section gaps a sectioned horizontal axis opens. */
function countSections(
  rows: TidyRow[],
  keyOf: (r: TidyRow) => string,
  sectionField: string,
  spec: ChartSpec,
  categories: string[],
): number {
  const sectionOf = new Map<string, string>();
  for (const r of rows) {
    const cat = keyOf(r);
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

/** A row-sized chart's category (band) values in render order, for its gutter and height: x_order
 *  first when set, then data-encounter order. */
function orderedCategories(rows: TidyRow[], keyOf: (r: TidyRow) => string, spec: ChartSpec): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows) {
    const v = keyOf(r);
    if (v != null && v !== "" && !set.has(v)) {
      set.add(v);
      seen.push(v);
    }
  }
  const order = categoryOrderFor(spec);
  if (order && order.length) {
    const rank = new Map(order.map((c, i) => [c, i] as const));
    const rankOf = (c: string): number => rank.get(categoryText(c)) ?? order.length;
    seen.sort((a, b) => rankOf(a) - rankOf(b));
  }
  return seen;
}

/** SHARED-mode small-multiples per-row width math (the single source of truth, reused by the
 *  live grid and the PNG export). Given the TOTAL inner grid width `availW` (the width the row
 *  of panes spans, minus inter-column gaps already accounted for by the caller), the column
 *  count and the inter-column gap, compute:
 *   - `colWidths[c]`: each column's OUTER width — the leftmost (labeled) column is wider (it
 *     carries the full TBL_MARGIN_LEFT label gutter), the label-less columns are narrower (they
 *     only reserve SHARED_LABELLESS_MARGIN_LEFT);
 *   - `marginLeft[c]`: the per-column left margin (TBL_MARGIN_LEFT for col 0, the small margin
 *     otherwise) to thread into renderPane.
 *
 *  Width identity, where `dataW` is the inner DATA/plot width, IDENTICAL for every column when
 *  unweighted (so the series renders at the same apparent width in every pane):
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
): { colWidths: number[]; marginLeft: number[] } {
  // The leftmost (labeled) column's left margin: the y-label gutter (TBL_MARGIN_LEFT) unless the
  // caller passes another.
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
  for (let c = 0; c < C; c++) {
    const isLeft = c === 0;
    const ml = isLeft ? LM : lm;
    const dataW = (totalDataW * Math.max(0, w[c] as number)) / sumW;
    marginLeft.push(ml);
    colWidths.push(dataW + ml + R);
  }
  return { colWidths, marginLeft };
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
  /** This pane's value prefix/suffix. Every pane resolves the same chart-level fields, so these
   *  are identical across a figure; kept per-pane because each pane renders independently. */
  valueAffixes?: ValueAffixes;
  /** This pane's x-value parse/format for the crosshair. */
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** Scatter panes: the symbol scale THIS pane's marks were drawn with, and its rows in marker
   *  order. Both are per-pane on purpose — a pane's shape domain is filtered to the values in its
   *  own scope, so a figure-level scale would assign a different symbol to the same value in
   *  different panes. */
  symbolScale?: { domain: string[]; range: string[] } | undefined;
  shapeIsSeries?: boolean;
  pointOrder?: PreparedRow[];
  /** Stacked panes: mirrors MarkLayers.netMode — line/bar panes leave this undefined. */
  netMode?: NetMode;
  /** Stacked panes: visual top→bottom stack order, for the band crosshair's
   *  Total/series ordering. Line/bar panes leave this undefined. */
  legendVisualOrder?: string[];
  /** `overlays[].tooltip: true` lines that draw in THIS pane — see PaneResult.overlayTooltips.
   *  Per-pane because `facet` scoping and the pane's own x-domain both decide it. */
  overlayTooltips?: OverlayTooltipLine[];
  /** This pane's key row per series, INCLUDING the ones the figure legend suppresses — a
   *  single-series figure draws no legend but still tooltips. Per-pane, not figure-level, because
   *  per-pane mode resolves colours independently. See index.ts buildSeriesKeyRows. */
  seriesKeyRows?: LegendItem[];
}

export interface FigureRenderResult {
  mode: "shared" | "per-pane";
  panes: FigurePane[];
  columns: number;
  rows: number;
  /** The per-column OUTER pixel widths (length === `columns`) the panes were rendered at. SHARED
   *  mode: always set — col 0 carries the y-label gutter and col>0 do not, the inner data width
   *  split equally or by `pane_widths`. With equal weights, col 0 is wider by its label gutter;
   *  with unequal `pane_widths` any column can be the widest (e.g. `[1, 7]` on a 920px row with a
   *  20px gap: 162.75 / 737.25). PER-PANE mode: set only with a non-"equal" `pane_widths`
   *  (perPaneColumnWidths, every column keeping its own label gutter); undefined otherwise (equal
   *  `1fr` columns). The live grid sets `grid-template-columns` to these px widths and the PNG
   *  export places each pane in a cell of this width. */
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
  valueAffixes: ValueAffixes;
  xAxisTitle: string | null;
  dataInScope: PreparedRow[];
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** Visual top-to-bottom stack order of the interactive series (stacked panes only; line
   *  panes leave this undefined). Mirrors RenderResult.legendVisualOrder. */
  legendVisualOrder?: string[];
  /** Stacked panes only; line panes leave this undefined. Mirrors RenderResult.netMode. */
  netMode?: NetMode;
}

/** Whether a figure's panes share one x range: every continuous axis, in both modes. A categorical
 *  axis keeps each pane's own categories (panes may legitimately hold different ones), and a
 *  histogram already shares its bin edges (`figureBinThresholds`). */
function sharesXRange(spec: ChartSpec): boolean {
  return spec.xAxisType !== "categorical" && spec.chartType !== "histogram";
}

/** The x range every pane is drawn over: the union of the probes' own ranges, so no pane loses a
 *  point, marker or band it would have drawn alone. Undefined when no probe has a continuous x. */
function figureSharedX(probes: PaneResult[]): SharedXDomain | undefined {
  const union = (spans: Array<[number, number] | undefined>): [number, number] | undefined => {
    const present = spans.filter((s): s is [number, number] => s != null);
    if (!present.length) return undefined;
    return [Math.min(...present.map((s) => s[0])), Math.max(...present.map((s) => s[1]))];
  };
  const data = union(probes.map((p) => p.xDataExtent));
  const scale = union(probes.map((p) => p.xScaleDomain));
  return data && scale ? { data, scale } : undefined;
}

/** `x_ticks: data` in small multiples: every pane's x values together, so every pane draws the same
 *  ticks, including where it has no data of its own. */
function figureXTickValues(spec: ChartSpec, probes: PaneResult[]): number[] | undefined {
  if (spec.x_ticks !== "data" || !probes.length) return undefined;
  return [...new Set(probes.flatMap((p) => paneXValues(p.dataInScope)))];
}

/** The narrowest pane's data width, which every pane fits its ticks to, so unequal pane widths cannot
 *  give panes different ticks or bottom margins: on a date axis (any chart type, histograms included),
 *  and on a numeric axis with `x_ticks` (without it Plot picks numeric ticks itself). `marginLeft` is
 *  one value or one per column, as the caller renders them. Undefined where ticks are not fitted. */
function paneTickWidth(
  spec: ChartSpec,
  colWidths: number[],
  marginLeft: number | number[],
  opts: RenderOptions,
): number | undefined {
  const fitted =
    spec.xAxisType === "temporal" || spec.xAxisType === "quarterly" || (spec.xAxisType === "numeric" && spec.x_ticks != null);
  if (!fitted) return undefined;
  const right = opts.marginRight ?? TBL_MARGIN_RIGHT;
  return Math.min(
    ...colWidths.map((w, c) => w - (Array.isArray(marginLeft) ? (marginLeft[c] as number) : marginLeft) - right),
  );
}

/** Histogram shared mode: the ONE set of bin thresholds every pane bins to, computed over all rows.
 *  Undefined in per-pane mode (each pane bins its own rows), for pre-binned data (the edges are in
 *  the data), and off histograms. */
function figureBinThresholds(
  spec: ChartSpec,
  rows: TidyRow[],
  cols: ReturnType<typeof resolveColumns>,
  mode: "shared" | "per-pane",
): number[] | undefined {
  if (spec.chartType !== "histogram" || mode === "per-pane" || isPreBinned(cols)) return undefined;
  const isTemporal = spec.xAxisType === "temporal";
  const values = rows
    .map((r) => (isTemporal ? parseDate(r[cols.x] ?? "").getTime() : +(r[cols.x] ?? "")))
    .filter((v) => Number.isFinite(v));
  const bw = spec.histogram?.binWidth;
  return isTemporal
    ? temporalThresholds(values, bw, spec.histogram?.bins, spec.histogram?.domain)
    : computeThresholds(values, {
        bins: spec.histogram?.bins,
        binWidth: typeof bw === "number" ? bw : undefined,
        domain: spec.histogram?.domain,
      });
}

/**
 * `tbl-chart validate` warnings for a LONE `yAxisPolicy.min` strictly above every value in the data,
 * or a lone `max` strictly below every value (Ruling 74): per pane on a small-multiples figure,
 * naming the pane. A statement about the DATA only (`paneValueExtent`), never about what the chart
 * shows, which also answers to headroom, markers, nice rounding, autoWiden and shared domains. A
 * value exactly on the bound is not past it. Both bounds or neither: none.
 */
export function loneBoundWarnings(spec: ChartSpec, rows: TidyRow[]): string[] {
  // A horizontal chart's facets are groups of one chart, on one axis (spec/facet-groups.ts).
  spec = normalizeSpec(spec);
  const { min, max } = spec.yAxisPolicy ?? {};
  if ((min == null) === (max == null)) return [];
  const past = (ext: { min: number; max: number } | null): boolean =>
    ext != null && (min != null ? min > ext.max : (max as number) < ext.min);
  const noun = spec.chartType === "histogram" ? "bin height" : "value";
  const what = min != null ? `yAxisPolicy.min (${min}) is above every ${noun}` : `yAxisPolicy.max (${max}) is below every ${noun}`;
  const cols = resolveColumns(spec, rows);
  if (!spec.small_multiples || !cols.facet) {
    return past(paneValueExtent(spec, rows)) ? [`${what} in the data`] : [];
  }
  const facetField = cols.facet;
  const binThresholds = figureBinThresholds(spec, rows, cols, spec.small_multiples.mode ?? "shared");
  return figurePaneValues(spec, rows, facetField)
    .filter((v) => past(paneValueExtent(spec, rows.filter((r) => (r[facetField] as string) === v), binThresholds)))
    .map((v) => `${what} in pane "${v}"`);
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
  if (facetsDrawAsGroups(spec)) {
    throw new Error(
      "renderFigure: a horizontal bar, stacked or dumbbell chart draws columns.facet as groups in one chart, not as panes (Ruling 80) — render it with renderChart or render.",
    );
  }
  spec = normalizeSpec(spec);
  const sm = spec.small_multiples;
  if (!sm) throw new Error("renderFigure called without spec.small_multiples.");
  const mode = sm.mode ?? "shared";

  const cols = resolveColumns(spec, rows);
  const facetField = cols.facet;
  if (!facetField) {
    throw new Error("small_multiples requires a facet column (set columns.facet).");
  }

  // The figure's series, resolved ONCE over ALL panes' rows — by the same rule renderPane applies to
  // a pane's own rows (series_order is filter + order, else encounter order).
  //
  // A colour is assigned BY POSITION, so a pane that is MISSING a series would otherwise shift every
  // later series one slot down the palette and paint it a colour the figure legend contradicts: a
  // two-series figure whose second pane lacked the first series painted the second series blue
  // (#0072B2) while the legend, and the other pane, said amber (#E69F00). Panes index into this list
  // instead (RenderOptions.paletteSeries), and the figure-level legend is built from it rather than
  // from pane 0, so a series the FIRST pane happens to lack still gets a key.
  //
  // Resolved before section_order scoping, for the same reason: a series found only in an excluded
  // section takes no legend row (drawnSeries, below) but keeps its slot, so no drawn series changes
  // colour.
  //
  // First-encounter order over a subset preserves the parent's relative order, so a figure whose
  // panes all carry every series resolves exactly what pane 0 resolved — nothing moves.
  const seenSeries = new Set<string>();
  const seriesEncountered: string[] = [];
  for (const r of rows) {
    const s = cols.series ? (r[cols.series] ?? "") : SINGLE_SERIES_KEY;
    if (!seenSeries.has(s)) {
      seenSeries.add(s);
      seriesEncountered.push(s);
    }
  }
  const figureSeries = spec.series_order?.length
    ? spec.series_order.filter((s) => seenSeries.has(s))
    : seriesEncountered;
  rows = inSectionOrder(spec, cols, rows);
  const figureColors = buildColorMap(figureSeries, spec.series_colors);
  // Mirrors assemblePaneResult: a figure that resolves to ONE series adopts the title selector's
  // colour, so the figure-level legend matches the panes.
  if (opts.accentColor && figureSeries.length === 1) {
    figureColors.set(figureSeries[0] as string, opts.accentColor);
  }

  // Histogram shared mode (default): bin every pane to ONE set of thresholds computed over ALL
  // in-scope rows, so panes share a common continuous x-domain and their bars line up. Threaded into
  // every pane's renderPane via opts.binThresholds.
  const binThresholds = figureBinThresholds(spec, rows, cols, mode);

  // A horizontal bar, stacked or dumbbell chart never reaches here: its facets draw as groups of one
  // chart (spec/facet-groups.ts), and the guard at the top refuses it. So every figure is a vertical
  // (or non-categorical) grid, with no category gutter, row-sized height or sections.
  const keyOf = rowCategoryKey(rows, cols);
  const effHeight = opts.height;

  // 1. Partition + order panes (see figurePaneValues).
  const paneValues = figurePaneValues(spec, rows, facetField);

  if (!paneValues.length) throw new Error("No panes: facet_field produced no values in scope.");

  // How many DISTINCT series the figure draws: rows in a drawn pane, through series_order's filter.
  // The stacked net dot needs two (spec/bar-stack.ts drawsNetDots). Not `figureSeries.length`, which
  // also counts series found only in panes pane_order leaves out.
  const drawnPanes = new Set(paneValues);
  const drawnSeries = new Set<string>();
  for (const r of rows) {
    if (drawnPanes.has(r[facetField] as string)) drawnSeries.add(cols.series ? (r[cols.series] ?? "") : SINGLE_SERIES_KEY);
  }
  const listedSeries = spec.series_order?.length ? new Set(spec.series_order) : null;
  const chartSeriesCount = [...drawnSeries].filter((s) => !listedSeries || listedSeries.has(s)).length;
  // The figure legend keys only the series a pane draws: one found only in a pane pane_order leaves
  // out is drawn nowhere. Its rows are still built over `figureSeries` and then filtered, so every
  // drawn series keeps the row it had — colour and marker both index the full list.
  const legendSeries = figureSeries.filter((s) => drawnSeries.has(s));
  const drawnKeyRows = (rows: LegendItem[]): LegendItem[] => rows.filter((r) => drawnSeries.has(r.series));

  // A point chart's SEPARATE shape channel (columns.shape not the series): ONE shape list, which
  // every pane's symbols and the shape legend index. A pane numbering its own shapes drew a shape
  // another pane also has with a different marker, and the legend (pane 0's) had no row for a shape
  // pane 0 lacks. The list is renderPane's own shape rule run over the rows of every DRAWN pane
  // (index.ts shapeDomainOver), so a figure whose panes already agreed resolves the list each pane
  // did and renders unchanged. Unlike a series' colour position, a shape found only in a pane
  // pane_order leaves out takes no position: the panes never counted it, and neither did the legend.
  const figureShapes =
    cols.shape && cols.shape !== cols.series && (spec.chartType === "scatter" || spec.chartType === "dotplot")
      ? shapeDomainOver(spec, rows.filter((r) => drawnPanes.has(r[facetField] as string)))
      : undefined;
  // The figure's shape legend: every shape some pane draws (a pane's `shapeNames` is its symbol
  // domain, which is also its draw filter), in the figure's order and with the figure's symbols.
  const figureShapeLegend = (firstLayers: MarkLayers | undefined, paneShapes: Array<string[] | undefined>) => {
    const layers = firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set<string>() };
    if (!figureShapes || !layers.shapeNames || layers.shapeIsSeries) return buildShapeLegendItems(spec, layers);
    const drawn = new Set(paneShapes.flatMap((s) => s ?? []));
    return buildShapeLegendItems(spec, { ...layers, shapeNames: figureShapes.filter((s) => drawn.has(s)) }, figureShapes);
  };
  const paneShapes: Array<string[] | undefined> = [];
  // 2. Grid layout. columns = config else default; rows = ceil(n / columns). col = i % columns,
  //    row = floor(i / columns).
  // Column count: a live-layer override (responsive reflow) wins, else the spec config, else the
  // default — which is a SINGLE ROW when pane_widths is set (variable widths are per-column across
  // one row of panes), and the ≈ceil(sqrt(n)) grid otherwise. Clamp to [1, paneValues.length].
  const variableWidths = sm.pane_widths != null && sm.pane_widths !== "equal";
  const requestedColumns =
    opts.columns && opts.columns > 0
      ? opts.columns
      : sm.columns && sm.columns > 0
        ? sm.columns
        : variableWidths
          ? paneValues.length
          : defaultColumns(paneValues.length);
  const columns = Math.max(1, Math.min(requestedColumns, paneValues.length));
  const gridRows = Math.ceil(paneValues.length / columns);

  const titleFor = (value: string): string => ownValue(sm.pane_titles, value) ?? value;
  const seriesLabels = spec.series_labels ?? {};

  // Variable pane widths (`pane_widths`) — used by BOTH modes. Resolve the per-column weight
  // vector once here: a proportion array is used directly; "equal-bar" weights each column by the
  // band span of its busiest pane (see barSpan); "equal"/unset ⇒ undefined (uniform). The TOTAL inner grid width is
  // `opts.gridWidth` (live grid) else `opts.width` (golden tests pass one width as the row total).
  const gridGap = opts.gridGap ?? 0;
  const availW = opts.gridWidth ?? opts.width ?? 720;
  let colWeights: number[] | undefined;
  {
    const pw = sm.pane_widths;
    if (Array.isArray(pw) && pw.length === columns) {
      colWeights = pw;
    } else if (pw === "equal-bar") {
      const barCount = (value: string): { cats: number; perCat: number } => {
        const pr = rows.filter((r) => (r[facetField] as string) === value);
        const catSet = new Set<string>();
        const serSet = new Set<string>();
        for (const r of pr) {
          const c = keyOf(r);
          if (c) catSet.add(c);
          const s = cols.series ? (r[cols.series] as string) : "";
          if (s) serSet.add(s);
        }
        return { cats: Math.max(1, catSet.size), perCat: Math.max(1, serSet.size) };
      };
      // A vertical band of n categories spans n + 2·outer − inner steps of the data width, not n
      // (d3 band: step = width / (n − inner + 2·outer)), and each step holds `perCat` bars (a
      // grouped bar's inner series band has no padding). Weighting by bar count alone left the
      // busier pane's bars wider. Horizontal bars take their thickness from the pane's height, so
      // their weighting stays the plain bar count.
      const horizontal = spec.orientation === "horizontal";
      const barSpan = (value: string): number => {
        const { cats, perCat } = barCount(value);
        return horizontal ? cats * perCat : perCat * (cats + 2 * VBAND_PADDING_OUTER - VBAND_PADDING_INNER);
      };
      const weights = Array.from({ length: columns }, () => 0);
      paneValues.forEach((v, i) => {
        const col = i % columns;
        weights[col] = Math.max(weights[col] as number, barSpan(v));
      });
      colWeights = weights;
    }
  }

  // Vertical categorical facets: coordinate the x-axis label layout so panes' baselines align — used
  // by BOTH modes. Each pane would otherwise pick single/wrap/rotate from ITS own width + category
  // count, so a pane that rotates (or has longer labels) reserves a taller bottom margin and drops
  // its baseline below the others'. Given each column's inner DATA width, force (a) the WORST-CASE
  // mode across panes for a consistent look, and (b) the MAX bottom margin so every pane reserves
  // the same space. Returns {} for a non-categorical x (no coordination needed).
  const coordinateXLabels = (
    dataWByCol: number[],
  ): { mode?: BandLabelMode; marginBottom?: number } => {
    if (spec.xAxisType !== "categorical") return {};
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

  // PER-PANE mode: each pane is its OWN single-frame SVG with an independent y-scale and units
  // (a continuous x range is still shared — see sharesXRange) (Plot faceting can't give
  // independent y-scales, so we render + compose N
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
    const perPaneWidths = variableWidths
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
    // The first pane's value formatter, for a `{value}` token in a keyed annotation label (per-pane
    // mode: each pane has its own scale, so the first one keys them).
    let firstFormatValue: ((v: number) => string) | undefined;
    // Each pane's PAINTED textures, in pane order — folded into the figure legend's (see
    // figureSeriesHatches). Collected rather than taken from pane 0 so a series pane 0 lacks is
    // still keyed, matching how `figureSeries` is resolved over every pane's rows.
    const panePainted: Array<Map<string, SeriesHatch>> = [];
  const paneFills: Array<Map<string, string>> = [];
    // The panes share one x range (see sharesXRange), read off a probe render of each pane.
    const xProbes = sharesXRange(spec)
      ? paneValues.map((value) =>
          renderPane(
            spec,
            rows.filter((r) => (r[facetField] as string) === value),
            { ...opts, height: effHeight, pane: true, paneFacetValue: value },
            "probe",
          ),
        )
      : [];
    const sharedX = figureSharedX(xProbes);
    const xTickValues = figureXTickValues(spec, xProbes);
    // Ticks fit the narrowest pane, measured with the margins renderPane itself subtracts.
    const xTickWidth = paneTickWidth(
      spec,
      Array.from({ length: columns }, (_, c) => perPaneWidths?.[c] ?? opts.width ?? availW),
      opts.marginLeft ?? TBL_MARGIN_LEFT,
      opts,
    );
    const panes: FigurePane[] = paneValues.map((value, i) => {
      // Restrict the rows to this pane (own y-domain/units): renderPane renders a standalone
      // single frame for these rows only.
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
          paletteSeries: figureSeries,
          ...(figureShapes ? { paletteShapes: figureShapes } : {}),
          chartSeriesCount,
          ...(perPaneWidths ? { width: perPaneWidths[col] } : {}),
          ...(ppXLabelMode ? { xLabelMode: ppXLabelMode } : {}),
          ...(ppMarginBottom != null ? { marginBottom: ppMarginBottom } : {}),
          ...(sharedX ? { sharedX } : {}),
          ...(xTickWidth != null ? { xTickWidth } : {}),
          ...(xTickValues ? { xTickValues } : {}),
        },
        `p${i}`,
      );
      if (i === 0) {
        firstLayers = p.layers;
        firstFormatValue = p.formatValue;
      }
      panePainted.push(p.seriesHatches);
      paneFills.push(p.seriesPainted);
      paneShapes.push(p.layers.shapeNames);
      // Escape hatch, per pane: a figure has no single SVG (each pane is its own), so this fires
      // once per pane, LAST — after renderPane's own assembly — with ctx.facet set to the SAME
      // FigurePane.value the tooltip hook (Task 5) already uses, not a second derivation of it.
      if (opts.hooks?.afterRender && p.svg) {
        opts.hooks.afterRender(p.svg, { phase: opts.phase ?? "live", facet: value });
      }
      return {
        value,
        title: titleFor(value),
        svg: p.svg,
        dataInScope: p.dataInScope,
        colors: p.colors,
        seriesOrder: p.seriesNames,
        dashedNames: p.layers.dashedNames,
        symbolScale: p.layers.symbolScaleOpts,
        shapeIsSeries: p.layers.shapeIsSeries ?? false,
        pointOrder: p.layers.pointOrder,
        valueAffixes: p.valueAffixes ?? resolveValueAffixes(spec),
        tooltipXParse: p.tooltipXParse,
        tooltipXFormat: p.tooltipXFormat,
        overlayTooltips: p.overlayTooltips,
        netMode: p.layers.netMode,
        legendVisualOrder: p.layers.legendVisualOrder,
        seriesKeyRows: buildSeriesKeyRows(spec, p.seriesNames, p.colors, p.layers, p.seriesHatches, p.seriesPainted, figureSeries),
      };
    });

    // Figure-level legend: series config is shared across panes, so compute it ONCE — from the
    // FIGURE's series/colors (not pane 0's: a pane may be missing a series) plus the first pane's
    // mark layers, which carry the swatch shapes and are the same for every pane. Its textures come
    // from what the PANES painted, never from figureColors — see figureSeriesHatches.
    const first = panes[0];
    const figureLayers = firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set<string>() };
    const legendItems = buildLegendItems(
      spec,
      legendSeries,
      figureColors,
      figureLayers,
      drawnKeyRows(buildSeriesKeyRows(spec, figureSeries, figureColors, figureLayers, figureSeriesHatches(panePainted), firstPainted(paneFills))),
      firstFormatValue,
    );

    return {
      mode: "per-pane",
      panes,
      columns,
      rows: gridRows,
      ...(perPaneWidths ? { columnWidths: perPaneWidths } : {}),
      legendItems,
      shapeLegendItems: figureShapeLegend(firstLayers, paneShapes),
      colorLegendTitle: spec.color_legend_title,
      shapeLegendTitle: spec.shape_legend_title,
      seriesLabels,
      colors: figureColors,
      seriesOrder: figureSeries,
      dashedNames: first?.dashedNames ?? new Set(),
      valueAffixes: first?.valueAffixes ?? resolveValueAffixes(spec),
      xAxisTitle: spec.x_axis_title ?? null,
      dataInScope: first?.dataInScope ?? [],
      tooltipXParse: first?.tooltipXParse,
      tooltipXFormat: first?.tooltipXFormat,
      legendVisualOrder: firstLayers?.legendVisualOrder,
      netMode: firstLayers?.netMode,
    };
  }

  // SHARED mode: the SAME per-pane composition as above (N independent mini-SVGs in the grid,
  // each its own frame with its own crosshair / dimming / selection), with TWO differences:
  //   1. ALL panes use ONE shared y-domain, computed once over ALL in-scope rows.
  //   2. y-axis tick LABELS show only on the leftmost column (col 0); panes with col > 0 keep
  //      their gridlines + plot area + left margin but hide the tick label text (so panes stay
  //      aligned and the same width).

  // 1. Shared y-domain: probe EACH pane independently and UNION the per-pane domains. A single
  //    combined probe over all in-scope rows would, for STACKED bars, sum same-category rows
  //    ACROSS panes (panes share the x-categories) and inflate the scale. Probing per pane and
  //    unioning is correct for every chart type, and — because computeYAxis's nice-rounding is
  //    monotonic — yields exactly the combined-probe domain for line/single-series/grouped bars,
  //    so those stay unchanged. Each per-pane probe already applies the bar zero-baseline +
  //    value-label headroom, so the union endpoints carry it. Probe SVGs are discarded.
  //    A lone yAxisPolicy bound's ascending fallback is decided on the FIGURE (Ruling 74): whenever
  //    another pane ascends on its own, a pane whose own axis needed it (nothing on the bound's open
  //    side) contributes the domain it had before the fallback existed (reversed or [b, b]), not its
  //    fallback domain. That keeps its pinned end as its own markers extend it (a facet-scoped marker
  //    beyond a bar's ceiling), and leaves those figures exactly as they were before the fallback.
  //    Dropping the pane instead lost such a marker's extent and drew it off the frame. Only when
  //    every pane needs the fallback does the figure take it, as the union of their fallback domains.
  const probes = paneValues.map((value) =>
    renderPane(
      spec,
      rows.filter((r) => (r[facetField] as string) === value),
      {
        ...opts,
        height: effHeight,
        pane: true,
        paneFacetValue: value,
        ...(binThresholds ? { binThresholds } : {}),
      },
      "probe",
    ),
  );
  const anyAscends = probes.some((p) => !p.yDomainWithoutFallback);
  let yLo = Infinity;
  let yHi = -Infinity;
  for (const p of probes) {
    const [lo, hi] = (anyAscends && p.yDomainWithoutFallback) || p.yDomain;
    if (lo < yLo) yLo = lo;
    if (hi > yHi) yHi = hi;
  }
  const sharedYDomain: [number, number] = [yLo, yHi];

  // 3. Per-row width math (single source: sharedColumnWidths). The label-less (non-leftmost)
  //    columns drop the label gutter for a small left margin; column OUTER widths are made unequal
  //    so the inner DATA width is IDENTICAL across a row (labeled col 0 wider, label-less cols
  //    narrower). `availW`/`gridGap`/`colWeights` were resolved once above (shared by both modes).
  const { colWidths, marginLeft: colMarginLeft } = sharedColumnWidths(
    availW,
    columns,
    gridGap,
    TBL_MARGIN_LEFT,
    colWeights,
  );

  // 3b. Vertical categorical facets: coordinate the x-axis label layout so panes' baselines align
  //     (shared by both modes — see coordinateXLabels). Data width per column: the shared-mode
  //     column outer width minus its own left margin + the right margin.
  const colDataW = colWidths.map((w, c) => w - (colMarginLeft[c] as number) - TBL_MARGIN_RIGHT);
  const { mode: forcedXLabelMode, marginBottom: forcedMarginBottom } = coordinateXLabels(colDataW);
  // 3c. Shared x range (continuous axes), from the y probes; ticks fit the narrowest column.
  const sharedX = sharesXRange(spec) ? figureSharedX(probes) : undefined;
  const xTickValues = figureXTickValues(spec, probes);
  const xTickWidth = paneTickWidth(spec, colWidths, colMarginLeft, opts);

  // 4. Render each pane as its own single frame at its column's OUTER width + left margin, forcing
  //    the shared y-domain. Panes hide the y-tick LABELS on non-leftmost columns.
  let firstLayers: MarkLayers | undefined;
  // Shared mode: every pane shares one value scale, so this IS the figure's value formatter.
  let firstFormatValue: ((v: number) => string) | undefined;
  // Each pane's PAINTED textures, in pane order — folded into the figure legend's (see
  // figureSeriesHatches).
  const panePainted: Array<Map<string, SeriesHatch>> = [];
  const paneFills: Array<Map<string, string>> = [];
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
        paletteSeries: figureSeries,
        ...(figureShapes ? { paletteShapes: figureShapes } : {}),
        chartSeriesCount,
        yDomain: sharedYDomain,
        ...(binThresholds ? { binThresholds } : {}),
        ...(sharedX ? { sharedX } : {}),
        ...(xTickWidth != null ? { xTickWidth } : {}),
        ...(xTickValues ? { xTickValues } : {}),
        width: colWidths[col],
        ...(forcedXLabelMode ? { xLabelMode: forcedXLabelMode } : {}),
        ...(forcedMarginBottom != null ? { marginBottom: forcedMarginBottom } : {}),
        hideYAxisLabels: col > 0,
        marginLeft: colMarginLeft[col],
      },
      `p${i}`,
    );
    if (i === 0) {
      firstLayers = p.layers;
      firstFormatValue = p.formatValue;
    }
    panePainted.push(p.seriesHatches);
    paneShapes.push(p.layers.shapeNames);
    // Pushed in BOTH pane loops or the figure legend lies. `paneFills` was declared here and pushed
    // only in the per-pane branch, so shared mode — the DEFAULT — handed firstPainted() an empty map
    // and the legend fell through to the palette: panes painted a `highlightSeries`-dimmed series
    // grey, the one legend over them keyed it amber. Gated by key-agreement.test.ts, which asserts
    // both modes against the fill the panes are drawn in.
    paneFills.push(p.seriesPainted);
    // Escape hatch, per pane — see the identical call + rationale in the per-pane-mode branch above.
    if (opts.hooks?.afterRender && p.svg) {
      opts.hooks.afterRender(p.svg, { phase: opts.phase ?? "live", facet: value });
    }
    return {
      value,
      title: titleFor(value),
      svg: p.svg,
      dataInScope: p.dataInScope,
      colors: p.colors,
      seriesOrder: p.seriesNames,
      dashedNames: p.layers.dashedNames,
      symbolScale: p.layers.symbolScaleOpts,
      shapeIsSeries: p.layers.shapeIsSeries ?? false,
      pointOrder: p.layers.pointOrder,
      valueAffixes: p.valueAffixes ?? resolveValueAffixes(spec),
      tooltipXParse: p.tooltipXParse,
      tooltipXFormat: p.tooltipXFormat,
      overlayTooltips: p.overlayTooltips,
      netMode: p.layers.netMode,
      legendVisualOrder: p.layers.legendVisualOrder,
      seriesKeyRows: buildSeriesKeyRows(spec, p.seriesNames, p.colors, p.layers, p.seriesHatches, p.seriesPainted, figureSeries),
    };
  });

  // 4. Figure-level legend: series config is shared across panes, so compute it ONCE — from the
  //    FIGURE's series/colors (not pane 0's: a pane may be missing a series) plus the first pane's
  //    mark layers, which carry the swatch shapes. L1/single-series → null. Its textures come from
  //    what the PANES painted, never from figureColors — see figureSeriesHatches.
  const first = panes[0];
  const figureLayers = firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set<string>() };
  const legendItems = buildLegendItems(
    spec,
    legendSeries,
    figureColors,
    figureLayers,
    drawnKeyRows(buildSeriesKeyRows(spec, figureSeries, figureColors, figureLayers, figureSeriesHatches(panePainted), firstPainted(paneFills))),
    firstFormatValue,
  );

  return {
    mode: "shared",
    panes,
    columns,
    rows: gridRows,
    columnWidths: colWidths,
    legendItems,
    shapeLegendItems: figureShapeLegend(firstLayers, paneShapes),
    colorLegendTitle: spec.color_legend_title,
    shapeLegendTitle: spec.shape_legend_title,
    seriesLabels,
    colors: figureColors,
    seriesOrder: figureSeries,
    dashedNames: first?.dashedNames ?? new Set(),
    valueAffixes: first?.valueAffixes ?? resolveValueAffixes(spec),
    xAxisTitle: spec.x_axis_title ?? null,
    dataInScope: first?.dataInScope ?? [],
    tooltipXParse: first?.tooltipXParse,
    tooltipXFormat: first?.tooltipXFormat,
    legendVisualOrder: firstLayers?.legendVisualOrder,
    netMode: firstLayers?.netMode,
  };
}
