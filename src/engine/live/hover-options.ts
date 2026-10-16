// One hover/selection options builder per chart family, shared by both live mount paths: mountChart's
// draw() (a standalone chart) and wireFigureSvg (each small-multiples pane), render-live.ts. The two
// used to build these options by hand, side by side, and drifted (click-to-pin, the scatter card,
// the categorical-line hit-paths). Both now call `buildHoverPlan`, so a rule has one expression.
//
// The plan is pure data plus the callbacks the caller hands in: which attach function, with which
// options, which pills and coordinated (secondary) cursor, and whether a click pins. The caller
// attaches it in its own order (see each call site) and owns where the handles go.
//
// PANE DIFFERENCES. Given the same inputs, the standalone and pane plans differ ONLY where `mount` is
// read below, and test/hover-options-parity.test.ts asserts exactly this list:
//   1. Coordinated cursor. A pane coordinates when its figure hands it `onResolve` (wireFigureSvg's
//      bus): the primary emits its resolved key, and the plan carries the secondary cursor that
//      echoes the key on every pane. Most families emit with `emitOnly` (the secondary draws, no
//      card); a dumbbell pane, and a band pane in tooltip hover mode, emit WITHOUT it (the card
//      stays) — the band one adds an echo-only secondary, and its legend pills are deaf to the
//      cursor (`pillsHearCursor: false`). A histogram pane coordinates only in shared mode. A
//      standalone chart never coordinates, with one exception: a band chart in pills hover mode
//      drives its own coordinated cursor, a bus of one (`emitOnly` + the full secondary).
//   2. Orientation. A pane is always vertical: `columns.facet` is rejected on a horizontal bar, stack
//      or dumbbell (spec/facet-groups.ts), so it has no panes. A standalone band or dumbbell
//      reads `orientation` (and, horizontal, the row strip from the left edge + the label accent).
//   3. Value-pill default: `resolveValuePills(spec, netMode, pane, segmentLabelsDropped)` — a pane
//      paints no segment labels, so it passes `pane: true` and nothing dropped.
//   4. Dot-plot dodge: a pane dodges at the pane gap (`pointDodgeOffsets(order, true)`).
//   5. Waterfall precision. A standalone band chart formats its card and its legend pills with the
//      running-total labels' precision; a pane formats both with `tooltip_decimals` (CONFIG-SPEC
//      `tooltip_decimals`: a waterfall pane that hovers with a card uses it as usual). The
//      coordinated value pill uses the waterfall precision on both.
//   6. Click-to-pin hit-paths. Standalone: `xAxisType !== "categorical"`, or a categorical line or
//      area (so a standalone histogram asks for them); a pane: per family (a histogram does not).
//   7. `treemap` and `timeline` are standalone-only families (a pane never dispatches to them).
// `facet` is an input, not a mount difference: only a pane has one to pass.
import type { ChartSpec, ValueAffixes } from "../../spec/types.js";
import type { RenderHooks } from "../../spec/hooks.js";
import type { NetMode } from "../../spec/bar-stack.js";
import { resolveHoverMode, resolveTotalRow, hasNetDots, resolveValuePills } from "../../spec/bar-stack.js";
import { ownValue } from "../../spec/own-key.js";
import { isHorizontalDumbbell } from "../../spec/dumbbell-orientation.js";
import type { PreparedRow } from "../marks/index.js";
import { pointDodgeOffsets } from "../marks/point.js";
import type { TreemapTileInfo } from "../marks/treemap.js";
import { attachTreemapHover } from "../treemap-hover.js";
import { waterfallValueDecimals } from "../scales.js";
import { applyValueAffixes, formatNumericX } from "../util.js";
import { FACETED_CAT_LABEL_PX } from "../axes.js";
import type { IconSpec } from "../icon.js";
import {
  attachCrosshair,
  attachBandCrosshair,
  attachHistogramHover,
  attachSecondaryHistogramCursor,
  attachSecondaryLineCursor,
  attachSecondaryBandCursor,
  attachCategoricalLineCrosshair,
  attachSecondaryCategoricalLineCursor,
  attachPointHover,
  attachHighlightPills,
} from "../crosshair.js";
import type {
  BandCrosshairOptions,
  BandHoverCtx,
  CategoricalLineOptions,
  CrosshairOptions,
  HighlightPillsHandle,
  HighlightPillsOptions,
  HistogramHoverOptions,
  HoverDetach,
  PointHoverOptions,
  SecondaryBandOptions,
} from "../crosshair.js";
import type { OverlayTooltipLine } from "../overlays.js";
import type { BinLabelOpts, CalendarInterval } from "../histogram-label.js";
import { TBL, markerSymbolForSeries } from "../theme.js";

/** Format a numeric value for tooltip display. `decimals` (default 2) lets a tooltip be more
 *  precise than the axis — e.g. 4 for small magnitudes that round to 0.00 on a 2-decimal axis. */
export function formatValue(v: number, affixes: ValueAffixes, decimals = 2): string {
  if (!Number.isFinite(v)) return "—";
  return applyValueAffixes(v.toFixed(decimals), affixes);
}

const CALENDAR_INTERVALS = ["day", "week", "month", "quarter", "year"] as const;

/** Everything the scatter card needs, derived ONCE from what the render resolved.
 *
 *  Standalone and faceted scatter used to build this twice, and the two copies disagreed about both
 *  halves: whether to name the shape (one asked the legend, which `legend: false` nulls) and which
 *  symbol a value gets (one indexed raw `spec.shape_order`, which is optional and gets filtered per
 *  pane before it becomes the domain). Each divergence was a live defect. One builder, two callers,
 *  so there is exactly one expression of each rule.
 *
 *  `symbolScale` is the domain/range handed to Plot — not the legend's view of it — and `pointOrder`
 *  is the rows that actually produced markers, which is what index-pairing requires. */
function scatterPointHoverOptions(a: {
  spec: ChartSpec;
  pointOrder: PreparedRow[];
  colors: Map<string, string>;
  seriesLabels: Record<string, string>;
  icons?: Map<string, IconSpec>;
  valueAffixes: ValueAffixes;
  symbolScale?: { domain: string[]; range: string[] } | undefined;
  shapeIsSeries?: boolean;
  overlayTooltips?: OverlayTooltipLine[];
  tooltipContainer: HTMLElement;
  chromeTooltip: boolean;
}): Parameters<typeof attachPointHover>[1] {
  const { spec, symbolScale } = a;
  const hasShape = !!spec.columns?.shape;
  return {
    tooltipContainer: a.tooltipContainer,
    ...(a.icons ? { icons: a.icons } : {}),
    points: a.pointOrder.map((r) => ({
      series: r.series,
      shape: r._shape,
      x: r._xn ?? 0,
      y: r._y,
      ...(r._pointLabel ? { pointLabel: r._pointLabel } : {}),
    })),
    selector: hasShape ? 'g[aria-label="dot"] path' : 'g[aria-label="dot"] circle',
    colors: a.colors,
    seriesLabels: a.seriesLabels,
    shapeLabels: spec.shape_labels,
    // The shape token names a SECOND encoding; a redundant shape===series channel is already named
    // by the series itself. The marker still keys off `symbolScale` either way.
    showShape: !!symbolScale?.domain.length && !a.shapeIsSeries,
    showSeriesName: spec.tooltip_series_name !== false,
    symbols: new Map((symbolScale?.domain ?? []).map((d, i) => [d, symbolScale!.range[i]!] as const)),
    xLabel: spec.tooltip_x_label ?? spec.x_axis_title ?? "x",
    yLabel: spec.tooltip_y_label ?? spec.y_axis_title ?? "Value",
    xFormat: formatNumericX,
    yFormat: (v: number) => formatValue(v, a.valueAffixes, spec.tooltip_decimals),
    ...(a.overlayTooltips ? { overlays: a.overlayTooltips } : {}),
    showTooltip: a.chromeTooltip,
  };
}

/** `tooltip_section: true` → the card-header options every sectioned hover card takes (stack card,
 *  dumbbell; standalone and panes; a bar or stack pane under `coordinated_cursor: false`). Card
 *  only: the pills and the coordinated echo never get them. */
function tooltipSectionOpts(spec: ChartSpec): { tooltipSection?: boolean; sectionLabels?: Record<string, string> } {
  if (spec.tooltip_section !== true) return {};
  return { tooltipSection: true, ...(spec.section_labels ? { sectionLabels: spec.section_labels } : {}) };
}

/** Resolve the friendly bin-label options for a histogram from its spec: the x kind, the calendar
 *  interval (only when `binWidth` is a calendar-interval NAME — count/day-count bins → null), and
 *  the optional `bin_label` unit/rounding config. */
function histogramBinLabelOpts(spec: ChartSpec): BinLabelOpts {
  const xType = spec.xAxisType === "temporal" ? "temporal" : "numeric";
  const bw = spec.histogram?.binWidth;
  const interval: CalendarInterval | null =
    xType === "temporal" && typeof bw === "string" && (CALENDAR_INTERVALS as readonly string[]).includes(bw)
      ? (bw as CalendarInterval)
      : null;
  const cfg = spec.histogram?.bin_label;
  return {
    xType,
    interval,
    ...(cfg?.unit != null ? { unit: cfg.unit } : {}),
    ...(cfg?.unit_position != null ? { unitPosition: cfg.unit_position } : {}),
    ...(cfg?.decimals != null ? { decimals: cfg.decimals } : {}),
  };
}

// Bar charts facet their category band whenever bar.ts puts it on fx (vertical grouped) or fy
// (horizontal grouped, OR horizontal sectioned — any series count, since Task 16 unified single-
// and multi-series sectioned bars onto one fy topology; see bar.ts). A stack facets only when
// sectioned (stacked.ts: one bar per fy row; never grouped). The category-band crosshair
// (attachBandCrosshair) reads rect geometry differently in each case: faceted charts wrap each
// category in its own translated `<g>` (readCategoryBands/H's `isFaceted` branch); unfaceted charts
// read raw rect x/y directly. Passing the wrong branch reads a facet-LOCAL coordinate as if it were
// absolute, misresolving every hover past the first facet.
function isBarCategoryFaceted(spec: ChartSpec, rows: PreparedRow[], seriesCount: number): boolean {
  if (spec.chartType !== "bar" && spec.chartType !== "stacked") return false;
  if (spec.chartType === "bar" && seriesCount > 1) return true;
  return spec.orientation === "horizontal" && rows.some((r) => r._section != null);
}

// Sectioned horizontal bars render categories grouped by section (bar.ts's `bandDomain`), so the
// bands' rendered VISUAL (fy facet) order can differ from data-encounter order. The category-band
// crosshair maps facet rows -> categories BY INDEX, so callers must reorder their category list to
// match before passing it in. Stable sort keeps within-section order. No-op (returns `cats`
// unchanged, same array reference) when the chart has no section column.
function sectionOrderedCategories(spec: ChartSpec, rows: PreparedRow[], cats: string[]): string[] {
  const sectionCol = spec.columns?.section;
  if (!sectionCol) return cats;
  const sectionOf = new Map<string, string>();
  for (const r of rows) {
    if (r._xc && r._section != null && !sectionOf.has(r._xc)) sectionOf.set(r._xc, r._section);
  }
  const secOrder =
    spec.section_order && spec.section_order.length
      ? spec.section_order
      : [...new Set(cats.map((c) => sectionOf.get(c) ?? ""))];
  const rankOf = (c: string): number => {
    const i = secOrder.indexOf(sectionOf.get(c) ?? "");
    return i < 0 ? secOrder.length : i;
  };
  return [...cats].sort((a, b) => rankOf(a) - rankOf(b));
}

/** Which mount the plan is for: mountChart's single chart, or one wireFigureSvg pane. */
export type HoverMount = "standalone" | "pane";

/** The hover family a chart dispatches to. One attach function per primary. */
export type HoverFamily =
  | "timeline"
  | "treemap"
  | "scatter"
  | "dotplot"
  | "dumbbell"
  | "catline"
  | "band"
  | "histogram"
  | "line";

/** What the render resolved, as both mount paths hand it over. */
export interface HoverInputs {
  spec: ChartSpec;
  dataInScope: PreparedRow[];
  colors: Map<string, string>;
  seriesLabels: Record<string, string>;
  seriesOrder: string[];
  valueAffixes: ValueAffixes;
  /** Series → its resolved icon (icon.ts resolveTooltipIcons), shared by every card. */
  icons: Map<string, IconSpec>;
  /** MountOptions.tooltipContainer, resolved to its default. */
  tooltipContainer: HTMLElement;
  /** Only `tooltip` is read: the screen-only card hook, forwarded to the band and categorical cards. */
  hooks?: RenderHooks;
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** This frame's `overlays[].tooltip: true` lines, for the two attach sites that resolve a single
   *  x (attachCrosshair, attachPointHover). Per-pane on a figure. */
  overlayTooltips?: OverlayTooltipLine[];
  /** Scatter / dot plot: THIS frame's resolved symbol scale and marker-order rows. Per-pane on a
   *  figure, because a pane filters its shape domain to its own scope. */
  symbolScale?: { domain: string[]; range: string[] } | undefined;
  shapeIsSeries?: boolean;
  pointOrder?: PreparedRow[];
  netMode?: NetMode;
  /** Standalone only: the label builder's report that some segment was too thin for its in-bar
   *  number, so the value pills must stay (see resolveValuePills). A pane paints no segment labels. */
  segmentLabelsDropped?: boolean;
  /** Pane only: the FIGURE's series list, which the coordinated cursor's hover-dot symbols index. */
  symbolSeries?: string[];
  /** Standalone treemap: the tiles the render laid out. */
  treemapTiles?: TreemapTileInfo[];
  /** Pane only: this pane's facet value, forwarded into TooltipHookCtx.facet. */
  facet?: string;
  /** MountOptions.onHover's notifier; read by the band crosshair only. */
  onHover?: (ctx: BandHoverCtx | null) => void;
  /** The coordinated cursor's sink: a pane's figure bus, or a standalone band chart's own driver.
   *  Read per PANE DIFFERENCES 1 above. */
  onResolve?: (key: unknown) => void;
}

/** The primary hover attachment: one per chart. */
export type PrimaryHover =
  | { kind: "treemap"; opts: Parameters<typeof attachTreemapHover>[1] }
  | { kind: "point"; opts: PointHoverOptions }
  | { kind: "catline"; opts: CategoricalLineOptions }
  | { kind: "band"; opts: BandCrosshairOptions }
  | { kind: "histogram"; opts: HistogramHoverOptions }
  | { kind: "line"; opts: CrosshairOptions };

/** The coordinated (secondary) cursor that echoes a resolved key. */
export type SecondaryHover =
  | { kind: "catline"; opts: CategoricalLineOptions }
  | { kind: "band"; opts: SecondaryBandOptions }
  | { kind: "histogram"; opts: HistogramHoverOptions }
  | { kind: "line"; opts: CrosshairOptions };

/** A coordinated-cursor driver: renders the cursor at `key` (`active` on the hovered frame). */
export type CursorDriver = (key: unknown, active?: boolean) => void;

export interface HoverPlan {
  family: HoverFamily;
  /** null: no hover (a timeline is static by design). */
  primary: PrimaryHover | null;
  /** Legend-highlight value pills; null when the family has none or `chrome.valuePills` is off. */
  pills: HighlightPillsOptions | null;
  /** false: the pills must ignore the cursor's category suppression (PANE DIFFERENCES 1). */
  pillsHearCursor: boolean;
  secondary: SecondaryHover | null;
  /** Click-to-pin (render-live's wireClickToPin), when a legend exists to pin through; null: the
   *  family takes no click (point charts). */
  clickToPin: { lineHitPaths: boolean } | null;
}

/** The family `spec` dispatches to on `mount`. A pane never reaches `timeline` or `treemap`. */
export function hoverFamily(spec: ChartSpec, mount: HoverMount): HoverFamily {
  if (mount === "standalone") {
    if (spec.chartType === "timeline") return "timeline";
    if (spec.chartType === "treemap") return "treemap";
  }
  if (spec.chartType === "scatter") return "scatter";
  if (spec.chartType === "dotplot") return "dotplot";
  if (spec.chartType === "dumbbell") return "dumbbell";
  if (spec.xAxisType === "categorical") {
    return spec.chartType === "line" || spec.chartType === "area" ? "catline" : "band";
  }
  if (spec.chartType === "histogram") return "histogram";
  return "line";
}

/** Build the hover/selection plan for one chart frame. See PANE DIFFERENCES at the top. */
export function buildHoverPlan(mount: HoverMount, i: HoverInputs): HoverPlan {
  const { spec } = i;
  const family = hoverFamily(spec, mount);
  const pane = mount === "pane";
  // chrome: declarative switches (spec.chrome) that turn hover chrome OFF from the spec itself —
  // so a PNG export (which re-renders from the spec) agrees with the screen. Default true (today's
  // behaviour) when `chrome` or the key is absent.
  const chromeTooltip = spec.chrome?.tooltip ?? true;
  // `valueLabels.show` moves the pill DEFAULT (the numbers are already in the bars); an explicit
  // `chrome.valuePills` still wins. See spec/bar-stack.ts resolveValuePills.
  //
  // Standalone: `segmentLabelsDropped` is the label builder's report that some segment was too thin
  // for its in-bar number, so the pills must stay to carry it (the crosshair is then `emitOnly` —
  // there is no tooltip behind them). It rides on THIS draw's geometry: a resize that shrinks the
  // frame past the fit threshold re-decides it, because draw() rebuilds the plan.
  //
  // Pane: `pane: true` — a pane paints no segment labels, so `valueLabels.show` leaves its pills
  // alone — and `segmentLabelsDropped: false`, because a pane's label builder never runs. `pane:
  // true` already forces the pills on by itself; `false` is passed explicitly (rather than
  // defaulted) so a future pane that DID paint labels would have to come back and answer the
  // question instead of silently inheriting "nothing was dropped".
  const chromePills = pane
    ? resolveValuePills(spec, i.netMode, true, false)
    : resolveValuePills(spec, i.netMode, false, i.segmentLabelsDropped ?? false);
  const yFormat = (v: number): string => formatValue(v, i.valueAffixes, spec.tooltip_decimals);
  const tooltipHook = i.hooks?.tooltip;
  const facet = i.facet !== undefined ? { facet: i.facet } : {};
  // Standalone (PANE DIFFERENCES 6): line strokes are thin, so fat hit-paths on a continuous-x
  // chart and on a categorical line or area; bars resolve directly off the rect geometry.
  const standaloneClick = {
    lineHitPaths: spec.xAxisType !== "categorical" || spec.chartType === "line" || spec.chartType === "area",
  };
  const click = (paneLineHitPaths: boolean): { lineHitPaths: boolean } =>
    pane ? { lineHitPaths: paneLineHitPaths } : standaloneClick;
  const plan = (p: Omit<HoverPlan, "family" | "pills" | "pillsHearCursor" | "secondary"> & Partial<HoverPlan>): HoverPlan => ({
    family,
    pills: null,
    pillsHearCursor: true,
    secondary: null,
    ...p,
  });
  // Line charts with point markers: per-series marker shape, so the coordinated hover dot can
  // match the static marker. Keyed by the series' position in the figure's list, as the pane's
  // symbol scale (marks/line.ts) and the figure legend are.
  const markerSymbols = (): Map<string, string> | undefined =>
    spec.points && spec.chartType === "line"
      ? new Map(i.seriesOrder.map((s, k) => [s, markerSymbolForSeries(s, k, i.symbolSeries)] as const))
      : undefined;

  switch (family) {
    case "timeline":
      // Static by design: every label is on the page, so screen and PNG agree. Legend pin/dim
      // still works through the data-series attributes.
      return plan({ primary: null, clickToPin: standaloneClick });

    case "treemap":
      // Per-tile hover: outline + dim, and the card unless chrome.tooltip is false. That flag
      // suppresses only the card, as on every chart type (CONFIG-SPEC `chrome.tooltip`).
      return plan({
        primary: {
          kind: "treemap",
          opts: { tiles: i.treemapTiles ?? [], spec, showTooltip: chromeTooltip, tooltipContainer: i.tooltipContainer },
        },
        clickToPin: standaloneClick,
      });

    case "scatter":
      // Per-point hover (no shared-x guide — points aren't aligned on x). No click-to-pin.
      return plan({
        primary: {
          kind: "point",
          opts: scatterPointHoverOptions({
            spec,
            pointOrder: i.pointOrder ?? i.dataInScope,
            colors: i.colors,
            seriesLabels: i.seriesLabels,
            icons: i.icons,
            valueAffixes: i.valueAffixes,
            symbolScale: i.symbolScale,
            shapeIsSeries: i.shapeIsSeries,
            ...(i.overlayTooltips ? { overlayTooltips: i.overlayTooltips } : {}),
            tooltipContainer: i.tooltipContainer,
            chromeTooltip,
          }),
        },
        clickToPin: null,
      });

    case "dotplot": {
      // Category hover: resolve the category from the dot marks, list each series' value. Reuses
      // the categorical-line crosshair — no bars required. A coordinated pane shades the hovered
      // band and shows per-series value pills on EVERY pane. No click-to-pin.
      const coordinated = pane && i.onResolve != null;
      const rows = i.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y }));
      // Multi-series dot plots dodge horizontally; the pills and coordinated dots must use the same
      // offsets so they land over the actual points (panes dodge at the pane gap).
      const dodge = i.seriesOrder.length > 1 ? pointDodgeOffsets(i.seriesOrder, pane) : undefined;
      // Each coordinated hover dot draws the marker of the point it sits on: that point's own shape
      // through this pane's symbol scale. A series-keyed map was wrong whenever shape is its own
      // column (and a shape can change between categories within one series). No shape channel:
      // every point is a circle, and so is every dot.
      let pointSymbols: Map<string, Map<string, string>> | undefined;
      if (coordinated && i.symbolScale) {
        const scale = i.symbolScale;
        const symbolOf = new Map(scale.domain.map((d, k) => [d, scale.range[k]!] as const));
        pointSymbols = new Map();
        for (const r of i.pointOrder ?? []) {
          const sym = symbolOf.get(r._shape ?? "");
          if (sym == null || !r._xc) continue;
          if (!pointSymbols.has(r._xc)) pointSymbols.set(r._xc, new Map());
          pointSymbols.get(r._xc)!.set(r.series, sym);
        }
      }
      return plan({
        primary: {
          kind: "catline",
          opts: {
            tooltipContainer: i.tooltipContainer,
            icons: i.icons,
            rows,
            colors: i.colors,
            seriesLabels: i.seriesLabels,
            seriesOrder: i.seriesOrder,
            yFormat,
            categoryLabels: spec.x_labels,
            bandHighlight: true,
            centersFromMarks: true,
            showTooltip: chromeTooltip,
            tooltipHook,
            ...facet,
            ...(coordinated ? { emitOnly: true, onResolve: i.onResolve } : {}),
          },
        },
        pills: chromePills
          ? { rows, chartType: "dotplot", colors: i.colors, seriesOrder: i.seriesOrder, yFormat, dodge }
          : null,
        secondary: coordinated
          ? {
              kind: "catline",
              opts: {
                rows,
                colors: i.colors,
                seriesLabels: i.seriesLabels,
                seriesOrder: i.seriesOrder,
                yFormat,
                ...(pointSymbols ? { pointSymbols } : {}),
                bandHighlight: true,
                centersFromMarks: true,
                dodge,
                showPills: chromePills,
              },
            }
          : null,
        clickToPin: null,
      });
    }

    case "dumbbell": {
      // Per-category band hover (resolve the category from the dot marks; the card lists each
      // series' value with a DOT swatch that matches the legend/chart marker — hollow ring / ink /
      // filled). Reuses the categorical crosshair with orientation. A coordinated pane is NOT
      // emitOnly: every pane shows its own card (the dumbbell reads values via the card, not
      // in-place pills); `onResolve` still fires (it runs before the emitOnly gate), so hovering one
      // pane drives the band echo on the others.
      const coordinated = pane && i.onResolve != null;
      const horizontal = !pane && isHorizontalDumbbell(spec);
      const rows = i.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y, ...(r._section != null ? { _section: r._section } : {}) }));
      const dbMarkers = new Map(i.seriesOrder.map((s) => [s, ownValue(spec.series_marker, s) ?? "filled"] as const));
      const dbFills = new Map(i.seriesOrder.map((s) => [s, dbMarkers.get(s) === "ink" ? TBL.color.heading : (i.colors.get(s) || TBL.color.blue)] as const));
      return plan({
        primary: {
          kind: "catline",
          opts: {
            tooltipContainer: i.tooltipContainer,
            icons: i.icons,
            rows,
            colors: i.colors,
            seriesLabels: i.seriesLabels,
            seriesOrder: i.seriesOrder,
            yFormat,
            categoryLabels: spec.x_labels,
            ...tooltipSectionOpts(spec),
            bandHighlight: true,
            centersFromMarks: true,
            orientation: horizontal ? "horizontal" : "vertical",
            renderedFills: dbFills,
            showTooltip: chromeTooltip,
            tooltipHook,
            ...facet,
            // Horizontal: the row strip runs under the label, which accents — as on a horizontal bar.
            ...(horizontal ? { regionFromLeftEdge: true, accentLabel: true } : {}),
            ...(coordinated ? { onResolve: i.onResolve } : {}),
          },
        },
        secondary: coordinated
          ? {
              kind: "catline",
              opts: {
                rows,
                colors: i.colors,
                seriesLabels: i.seriesLabels,
                seriesOrder: i.seriesOrder,
                yFormat,
                categoryLabels: spec.x_labels,
                bandHighlight: true,
                centersFromMarks: true,
                orientation: "vertical",
                renderedFills: dbFills,
                markerless: true,
              },
            }
          : null,
        // The dots carry data-series: no hit-paths.
        clickToPin: click(false),
      });
    }

    case "catline": {
      // Categorical-x LINE or AREA: resolve the category from the x-axis labels (no bars) and show
      // a guide + card. Area takes this path, not the band crosshair, because the band crosshair
      // resolves the category from bar rects an area chart does not draw. Coordinated panes
      // hit-test + emit only; the secondary draws guide + per-series dot + value pill.
      const coordinated = pane && i.onResolve != null;
      const rows = i.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y }));
      return plan({
        primary: {
          kind: "catline",
          opts: {
            tooltipContainer: i.tooltipContainer,
            icons: i.icons,
            rows,
            colors: i.colors,
            seriesLabels: i.seriesLabels,
            seriesOrder: i.seriesOrder,
            yFormat,
            categoryLabels: spec.x_labels,
            showTooltip: chromeTooltip,
            tooltipHook,
            ...facet,
            // Stacked area: a Total row, as the temporal crosshair's. Reaches only a frame that
            // hovers with a card (emitOnly builds none).
            ...(spec.chartType === "area" ? { showTotal: true } : {}),
            ...(coordinated ? { emitOnly: true, onResolve: i.onResolve } : {}),
          },
        },
        secondary: coordinated
          ? {
              kind: "catline",
              opts: {
                rows,
                colors: i.colors,
                seriesLabels: i.seriesLabels,
                seriesOrder: i.seriesOrder,
                yFormat,
                symbols: markerSymbols(),
                showPills: chromePills,
              },
            }
          : null,
        // Lines are thin; fat hit-paths + tagged dots let clicks resolve the series.
        clickToPin: click(true),
      });
    }

    case "band": {
      // Categorical bar / stacked / waterfall: the category-band crosshair.
      const isStacked = spec.chartType === "stacked";
      // A grouped bar IS fx-faceted within its own frame (xScaleField === "fx" in bar.ts) — see
      // isBarCategoryFaceted above.
      const isFaceted = isBarCategoryFaceted(spec, i.dataInScope, i.seriesOrder.length);
      // Derive the ordered category list from the data rows (declaration order), then reorder to
      // the rendered (section) order: the crosshair maps facet rows → categories by index.
      const catsSeen = new Set<string>();
      const catsRaw: string[] = [];
      for (const r of i.dataInScope) {
        const cat = r._xc;
        if (cat && !catsSeen.has(cat)) { catsSeen.add(cat); catsRaw.push(cat); }
      }
      const categories = sectionOrderedCategories(spec, i.dataInScope, catsRaw);
      // `_section` is read by the card (its "<section> · <category>" header and onHover's
      // `section`); the pills and the secondary ignore it.
      const rows = i.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y, ...(r._section != null ? { _section: r._section } : {}) }));
      const horizontal = !pane && spec.orientation === "horizontal";
      // Waterfall: `delta` steps get a signed value pill CENTERED in the bar on hover; `total`/`skip`
      // steps shade only (their value is the always-on running-total label). Computed from THIS
      // frame's rows, so a step that is a delta in one facet and a skip in another is handled
      // correctly (e.g. the April 2 decomposition's "Apply ηs"). `skip` steps render a zero-height
      // rect in the builder, so every category still has a rect and the rect-index→category mapping
      // stays 1:1.
      const waterfall =
        spec.chartType === "waterfall"
          ? {
              deltaCats: new Set(
                i.dataInScope
                  .filter((r) => {
                    const k = ((r._kind as string | undefined) ?? "").trim();
                    return k !== "total" && k !== "skip";
                  })
                  .map((r) => r._xc as string),
              ),
            }
          : undefined;
      // Waterfall: the hover delta uses the SAME precision as the always-on running-total labels
      // (valueLabels.decimals, else the min the data needs) so the two never disagree.
      const wfDecimals = waterfall ? waterfallValueDecimals(i.dataInScope, spec.valueLabels?.decimals) : undefined;
      const pillYFormat = (v: number): string => formatValue(v, i.valueAffixes, wfDecimals ?? spec.tooltip_decimals);
      // PANE DIFFERENCES 5: a standalone chart's card and legend pills take the waterfall precision.
      const cardYFormat = pane ? yFormat : pillYFormat;
      // Total-dot stacks hover with the floating band card (with its dot-swatch Total row), NOT the
      // per-segment value pills — the net is what matters and pills can't show it. Every other
      // bar/stacked chart hovers with the coordinated cursor's pills. Derived here rather than
      // forwarded: see spec/bar-stack.ts on why only `netMode` crosses the MarkLayers → FigurePane
      // chain. `netMode` is UN-DEFAULTED — undefined means "not a stacked chart".
      const hoverMode = resolveHoverMode(spec, i.netMode);
      const useTooltip = hoverMode === "tooltip";
      const totalRow = resolveTotalRow(spec, i.netMode, hoverMode);
      // PANE DIFFERENCES 1. `coord`: hit-test + emit only (no card), the secondary draws the
      // full-band shade, a one-row highlight that never covers a section gap, the category accent
      // and the bar-end value pill. A standalone chart in pills mode drives this itself — the local
      // driver plays the role the figure bus plays for panes — and a pane does when its figure
      // coordinates.
      //
      // `echoWithCard`: a tooltip-mode pane on a coordinating figure. Pills never appear for these
      // panes, but the cross-pane band ECHO is independent of both, and a faceted stack exists to
      // show the same category across panes, so the pane emits WITHOUT `emitOnly` (the card
      // survives, and the emit still fires), and gets an echo-only secondary. Issue #32: dropping
      // coordination wholesale left a two-pane stack echoing nothing. A standalone chart has no
      // siblings to echo on.
      const coord = !useTooltip && (!pane || i.onResolve != null);
      const echoWithCard = useTooltip && pane && i.onResolve != null;
      return plan({
        primary: {
          kind: "band",
          opts: {
            tooltipContainer: i.tooltipContainer,
            icons: i.icons,
            rows,
            isStacked,
            totalRow,
            totalPosition: spec.barStack?.total?.position,
            totalBold: spec.barStack?.total?.bold,
            totalDivider: spec.barStack?.total?.divider,
            isFaceted,
            categories,
            seriesLabels: i.seriesLabels,
            seriesOrder: i.seriesOrder,
            yFormat: cardYFormat,
            categoryLabels: spec.x_labels,
            ...tooltipSectionOpts(spec),
            orientation: horizontal ? "horizontal" : "vertical",
            // Horizontal card hover: the same row strip + label accent as the pill hover.
            ...(horizontal ? { regionFromLeftEdge: true, accentLabel: true } : {}),
            showTooltip: chromeTooltip,
            tooltipHook,
            ...facet,
            onHover: i.onHover,
            ...(coord
              ? { emitOnly: true, onResolve: i.onResolve }
              : echoWithCard
                ? { onResolve: i.onResolve }
                : {}),
          },
        },
        pills: chromePills
          ? {
              rows,
              chartType: isStacked ? "stacked" : "bar",
              isStacked,
              isFaceted,
              categories,
              colors: i.colors,
              seriesOrder: i.seriesOrder,
              yFormat: cardYFormat,
              horizontal,
              hasNetDots: hasNetDots(i.netMode),
            }
          : null,
        // The cursor suppresses the hovered category in the legend-highlight pills so they don't
        // double up with its own per-category pill. An `echoWithCard` pane draws no such pill (the
        // echo is a bare shade, the read-out is the card), so the suppression would just delete the
        // pinned series' only value for that category — on the siblings outright, and on the hovered
        // pane too. Its pills stay deaf to it, as a standalone tooltip-mode chart's are (it emits
        // nothing): legend-highlight pills stay in BOTH hover modes.
        pillsHearCursor: !echoWithCard,
        secondary: coord
          ? {
              kind: "band",
              opts: {
                rows,
                isStacked,
                isFaceted,
                categories,
                colors: i.colors,
                seriesLabels: i.seriesLabels,
                seriesOrder: i.seriesOrder,
                yFormat: pillYFormat,
                horizontal,
                showPills: chromePills,
                // Horizontal: shade into the left label gutter + bold the hovered row label (no
                // pill). Vertical: shade stops at the baseline; the x-axis category name gets its
                // own frosted pill from attachSecondaryBandCursor's addCoordCategoryHighlight.
                ...(horizontal ? { regionFromLeftEdge: true, accentLabel: { font: FACETED_CAT_LABEL_PX } } : {}),
                ...(waterfall ? { waterfall } : {}),
              },
            }
          : echoWithCard
            ? {
                // Echo only: no colors/labels/formatter, because it draws no pills — just the band
                // geometry inputs (`readCategoryBands` reads rows + the category list).
                kind: "band",
                opts: { rows, isFaceted, categories, echoOnly: true },
              }
            : null,
        // Bars carry data-series on their rects → a click resolves directly (no fat hit-paths).
        clickToPin: click(false),
      });
    }

    case "histogram": {
      // Continuous numeric/temporal x, but BINNED bars — resolve the bin under the cursor by
      // x-extent (not a snapped point) and show a per-bin card headed by the bin range. In SHARED
      // small-multiples mode every pane bins to ONE set of thresholds, so hovering one pane can echo
      // the same bin on every other pane. Per-pane mode bins each pane independently, so it stays a
      // plain per-pane card.
      const coordinated =
        pane && i.onResolve != null && (spec.small_multiples?.mode ?? "shared") !== "per-pane";
      const rows = i.dataInScope.map((r) => ({ _x0: r._x0, _x1: r._x1, series: r.series, _y: r._y }));
      return plan({
        primary: {
          kind: "histogram",
          opts: {
            tooltipContainer: i.tooltipContainer,
            // A single-series histogram has NO legend row, so the icons' fallback supplies the icon.
            // Its COLOUR is not settled here: `attachHistogramHover` reads the rendered bars and
            // recolours through `recolourIcons`, which also re-grounds a texture. Reading the
            // palette for it gave a blue key over `bar_color: violet` bins.
            icons: i.icons,
            rows,
            colors: i.colors,
            seriesLabels: i.seriesLabels,
            seriesOrder: i.seriesOrder,
            yFormat,
            label: histogramBinLabelOpts(spec),
            showTooltip: chromeTooltip,
            ...(coordinated ? { emitOnly: true, onResolve: i.onResolve } : {}),
          },
        },
        secondary: coordinated
          ? {
              kind: "histogram",
              opts: {
                rows,
                colors: i.colors,
                seriesLabels: i.seriesLabels,
                seriesOrder: i.seriesOrder,
                yFormat,
                label: histogramBinLabelOpts(spec),
                showPills: chromePills,
              },
            }
          : null,
        // Bins carry data-series, as bars do: no hit-paths on a pane (PANE DIFFERENCES 6).
        clickToPin: click(false),
      });
    }

    case "line": {
      // Continuous x: the shared-x crosshair.
      const coordinated = pane && i.onResolve != null;
      const rows = i.dataInScope.map((r) => ({ time: r.time, series: r.series, value: r._y }));
      return plan({
        primary: {
          kind: "line",
          opts: {
            tooltipContainer: i.tooltipContainer,
            rows,
            xField: "time",
            yField: "value",
            seriesField: "series",
            // Set by every continuous x-adapter; a categorical chart dispatched elsewhere.
            xParse: i.tooltipXParse as (v: unknown) => number,
            xFormat: i.tooltipXFormat,
            yFormat,
            // ONE resolved icon per series, from the legend's own rows — which is what carries the
            // point MARKER a line chart's key shows.
            icons: i.icons,
            seriesLabels: i.seriesLabels,
            seriesOrder: i.seriesOrder,
            // Stacked area: the cumulative stack height is the meaningful aggregate — show a Total
            // row. A coordinated pane (`emitOnly`) never builds the card.
            showTotal: spec.chartType === "area",
            ...(i.overlayTooltips ? { overlays: i.overlayTooltips } : {}),
            showTooltip: chromeTooltip,
            ...(coordinated ? { emitOnly: true, onResolve: i.onResolve } : {}),
          },
        },
        secondary: coordinated
          ? {
              kind: "line",
              opts: {
                rows,
                xField: "time",
                yField: "value",
                seriesField: "series",
                xParse: i.tooltipXParse as (v: unknown) => number,
                xFormat: i.tooltipXFormat,
                // `tooltipXFormat` is always a function on a temporal axis (the x-adapter defaults it
                // to the axis-matching "%b %Y"), so the cursor cannot tell an author's format from
                // the default and would otherwise collapse its two-line echo on every figure. The
                // spec field is the signal.
                xFormatExplicit: spec.tooltip_x_format != null,
                xAxisType: spec.xAxisType,
                yFormat,
                colors: i.colors,
                seriesLabels: i.seriesLabels,
                seriesOrder: i.seriesOrder,
                symbols: markerSymbols(),
                showPills: chromePills,
              },
            }
          : null,
        // Line strokes are thin; transparent fat hit-paths let clicks near a line resolve it.
        clickToPin: click(true),
      });
    }
  }
}

/** Attach a plan's primary hover; returns its detach handle. */
export function attachPrimaryHover(svg: SVGSVGElement, p: PrimaryHover): HoverDetach {
  switch (p.kind) {
    case "treemap": return attachTreemapHover(svg, p.opts);
    case "point": return attachPointHover(svg, p.opts);
    case "catline": return attachCategoricalLineCrosshair(svg, p.opts);
    case "band": return attachBandCrosshair(svg, p.opts);
    case "histogram": return attachHistogramHover(svg, p.opts);
    case "line": return attachCrosshair(svg, p.opts);
  }
}

/** Attach a plan's legend-highlight pills; null when it has none. Pills that must ignore the
 *  cursor's category suppression (`pillsHearCursor: false`) get a handle that drops it. */
export function attachPlanPills(svg: SVGSVGElement, plan: HoverPlan): HighlightPillsHandle | null {
  if (!plan.pills) return null;
  const pills = attachHighlightPills(svg, plan.pills);
  return plan.pillsHearCursor ? pills : { setActive: (a) => pills.setActive(a), setSuppressedCategory: () => {} };
}

/** Attach a plan's coordinated cursor; returns its driver. */
export function attachSecondaryHover(svg: SVGSVGElement, s: SecondaryHover): CursorDriver {
  switch (s.kind) {
    case "catline": return attachSecondaryCategoricalLineCursor(svg, s.opts) as CursorDriver;
    case "band": return attachSecondaryBandCursor(svg, s.opts) as CursorDriver;
    case "histogram": return attachSecondaryHistogramCursor(svg, s.opts) as CursorDriver;
    case "line": return attachSecondaryLineCursor(svg, s.opts) as CursorDriver;
  }
}
