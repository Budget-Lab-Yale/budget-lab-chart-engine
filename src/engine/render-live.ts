// Live-render layer: mounts a fully interactive chart card into a container element and
// wires the pure engine (renderChart) to the DOM-only live primitives (legend, crosshair,
// source line). Scaling is copied from the tracker's createChartController: the chart is
// RE-RENDERED at the container's width (the x-axis compresses; height stays fixed) down to a
// minimum width, below which a horizontal scroll wrapper takes over and a sticky y-axis
// overlay keeps the value labels pinned at the left. No viewBox/CSS scaling.
import type { ChartSpec } from "../spec/types.js";
import type { RenderHooks } from "../spec/hooks.js";
import { resolveColumns } from "../spec/columns.js";
import { rowsInSectionOrder } from "../spec/section-key.js";
import {
  LEGEND_COLUMN_WIDTH,
  LEGEND_GAP,
  LEGEND_RIGHT_MIN_CARD_WIDTH,
  MIN_CHART_WIDTH,
  legendInRightColumn,
  resolveLegendPosition,
} from "./legend-layout.js";
import { resolveSelections } from "../spec/title.js";
import type { TidyRow } from "../data/index.js";
import type { FigureRenderResult } from "./figure.js";
import { renderChart } from "./index.js";
import { resolveTimelineOrientation, timelineHeight, timelineLegendRowCount } from "./marks/timeline.js";
import { TL_GEOM } from "./timeline-layout.js";
import { treemapHeight } from "./marks/treemap.js";
import { TM_GEOM } from "./treemap-layout.js";
import { normalizeSpec } from "./util.js";
import { renderFigure, horizontalBarChartHeight, figurePaneHeight, growsWithRows } from "./figure.js";
import { renderLegend } from "./legend.js";
import type { LegendHandle } from "./legend.js";
import { CROSSHAIR_HIT_SELECTOR } from "./hover-classes.js";
import { resolveAccentColor } from "./palette.js";
import { resolveTooltipIcons } from "./icon.js";
import type { HighlightPillsHandle, BandHoverCtx, HoverDetach } from "./crosshair.js";
import { renderSourceLine } from "./source-line.js";
import { LiveLifecycle } from "./live/lifecycle.js";
import { buildFigureHeader } from "./live/title-select.js";
import { buildDownloadActions } from "./live/downloads.js";
import { type OverlayEl, appendAxisTitleEl, appendXAxisTitle, attachYAxisOverlay } from "./live/axis-chrome.js";
import { CLICK_TO_PIN_SVGS, resolveRugAnnotationAtPoint, rugStripTop, wireClickToPin } from "./live/hit-test.js";
import { createRestackController } from "./live/area-restack.js";
import { createLegendSlots } from "./live/legend-layout-dom.js";
import {
  attachPlanPills,
  attachPrimaryHover,
  attachSecondaryHover,
  buildHoverPlan,
  type CursorDriver,
  type HoverInputs,
} from "./live/hover-options.js";

// Moved to live/hover-options.ts with the rest of the hover option building; re-exported so
// existing importers keep working.
export { formatValue } from "./live/hover-options.js";
// Moved to live/title-select.ts; re-exported so existing importers keep working.
export { buildFigureHeader, type TitleSelectorWiring } from "./live/title-select.js";

export interface MountOptions {
  spec: ChartSpec;
  rows: TidyRow[];
  /** Initial render width (used before the container is measured). */
  width?: number;
  height?: number;
  /** Eyebrow line above the title (e.g. "Figure 1"). A property of the article/embed context,
   *  not the chart itself — supplied at mount time. Passing a value shows it; omitting hides it. */
  eyebrow?: string;
  /** Override the Data/Image download filename slug. Normally derived from the URL (the chart's
   *  folder); pass this when several charts share one page (e.g. a gallery) so each still gets its
   *  own name instead of all resolving to the shared page's slug. */
  downloadName?: string;
  /** Fires when the user changes an inline title selector (see spec.title_selectors), with the
   *  selector key and the newly-active option id. A bubbling `tbl-title-select` CustomEvent
   *  (same detail shape) also dispatches from the card root, for standalone bundles with no
   *  host callback wired up. No-op when the spec has no title_selectors. */
  onSelect?: (change: { id: string; value: string }) => void;
  /** Initial active option id per title-selector key (host re-mount state restore). Precedence:
   *  `selections[key]` > `title_selectors[key].default` > that selector's first option. */
  selections?: Record<string, string>;
  /** Programmatic render hooks (see spec/hooks.ts). Passed to every renderChart/renderFigure call
   *  in the mount + resize paths, and to the Image download's export — so a static hook's output
   *  cannot diverge between the screen and the downloaded PNG. */
  hooks?: RenderHooks;
  /** Fires with the hovered category and its per-series values whenever a categorical bar/stacked
   *  crosshair (standalone or a small-multiples pane) resolves one, and with `null` when the hover
   *  ends — on pointer-leave, and when a redraw or teardown ends the hovered chart's wiring under a
   *  still pointer — so a consumer drawing its own hover card knows when to clear it. Values come
   *  straight from the crosshair's own resolver (`resolveCategorySeriesValues` in crosshair.ts) —
   *  never re-derived here — and fire even when `chrome.tooltip: false` suppresses the engine's
   *  own card, or the pane is a coordinated small-multiples pane with no card of its own: the
   *  engine still hit-tests and this reports what it resolved either way. A bubbling `tbl-hover`
   *  CustomEvent (same detail) also dispatches from the card root. Not yet wired for other chart
   *  types (line, scatter, histogram, dotplot, dumbbell, categorical-line) — see crosshair.ts's
   *  `attachBandCrosshair`, the only attach function this reaches. */
  onHover?: (ctx: BandHoverCtx | null) => void;
  /** Fires after every (re-)render of the chart body: once at mount, once after each width-driven
   *  resize redraw, once after a title-selector change forces a redraw (for its color accent),
   *  and once after an area chart's legend-driven click-to-restack forces its own redraw
   *  (`phase: "restack"` — pinning/unpinning a series moves it to the bottom of the stack and
   *  re-renders; guarded by `suppressRestack` so the focus hand-back inside that redraw does not
   *  re-enter this branch and double-fire; a reselect that drops a pinned series restacks too, so
   *  it fires "reselect" then "restack"). A small-multiples figure fires once PER PANE (each
   *  call's `svg` is that pane's own), rather than once for the figure — there is no single
   *  wrapping SVG to report; small multiples has no restack feature, so `"restack"` never reaches
   *  that path. A bubbling `tbl-render` CustomEvent (same detail) also dispatches from the card
   *  root. */
  onRender?: (ctx: { svg: SVGSVGElement; phase: "mount" | "resize" | "reselect" | "restack" }) => void;
  /** Fires whenever the legend's active highlight set changes — a pin (click), a hover, focus/
   *  blur, or the reset button — with the full active series set. A bubbling `tbl-legend-select`
   *  CustomEvent (same detail) also dispatches from the card root. Distinct from `onSelect`,
   *  which is the title-selector callback — this is the legend's own pin/dim gesture. No-op on a
   *  chart with no legend. Pins are carried across the mount's own redraws; a redraw whose legend
   *  no longer has a pinned row drops it and fires this once with what remains. */
  onLegendSelect?: (ctx: { active: string[] }) => void;
  /** Reparent the floating hover-tooltip card into this element instead of the default
   *  `container.ownerDocument.body`. Opt-in, not the default: the card is positioned
   *  `position: fixed` at the cursor's viewport coordinates, and a container with
   *  `overflow: hidden` or a CSS `transform` on it (or an ancestor) would clip it or throw off
   *  that positioning — `document.body` is the one place that never does either. Pass this only
   *  when the target element is known to have neither. Threaded down to every crosshair/hover
   *  attach call (see crosshair.ts's `getSharedTooltip`, keyed per-parent so two mounts with
   *  different containers never share one tooltip element). Must be a STABLE element across the
   *  mount's lifetime — a fresh element passed in on every re-render leaves the previous one's
   *  empty `.tbl-tooltip` div behind, since `getSharedTooltip` keys its cache by this reference. */
  tooltipContainer?: HTMLElement;
}

// MIN_CHART_WIDTH (legend-layout.ts): below it the chart stops shrinking and the scroll wrapper
// takes over. Height is held constant as the width changes.
const FIXED_CHART_HEIGHT = 400;

/** Compute the live-mount height for a chart. Horizontal bars scale with the number of category
 *  band slots (grouped → nSeries bars per category; stacked/single → one), plus the fixed section
 *  gaps and taller rows for wrapped labels — via the shared engine helper `horizontalBarChartHeight`,
 *  so the single-chart and faceted-figure heights agree. Vertical / non-bar charts return the
 *  fixed default; a horizontal chart with few rows is shorter than it. */
export function computeChartHeight(spec: ChartSpec, rows: TidyRow[]): number {
  spec = normalizeSpec(spec);
  // Timeline height is content-derived (label rows, or the stacked vertical column); renderChart
  // computes it again at the real width, so this is only the pre-draw estimate.
  if (spec.chartType === "timeline") return timelineHeight(spec, rows, 720);
  // Treemap: the same pre-draw estimate; its height follows its width (spec §6).
  if (spec.chartType === "treemap") return treemapHeight(720);
  // Horizontal bar/stacked AND horizontal dumbbell grow their height with the category-row count
  // (one row per category — dumbbell is never grouped, so horizontalBarChartHeight sizes it the
  // same as a single-series horizontal bar, section gaps included).
  if (!growsWithRows(spec)) {
    // Waterfall carries long (often rotated) step labels under the plot — give it more room.
    return spec.chartType === "waterfall" ? 460 : FIXED_CHART_HEIGHT;
  }
  return horizontalBarChartHeight(spec, rows);
}

// Fixed width of the right-side legend column. Chosen to fit typical series labels at 12px
// Figtree; the exact value is tunable in the visual pass. The chart area is computed as
// (outerContainerWidth − LEGEND_COLUMN_WIDTH − LEGEND_GAP) so the ResizeObserver observes
// the OUTER card (stable), not the canvas box (which would shrink as the legend takes space →
// feedback loop).

// When the card is too narrow to fit both the chart floor and the legend column, fall back to
// the top legend so the chart remains usable: LEGEND_RIGHT_MIN_CARD_WIDTH (legend-layout.ts, shared
// with a framed PNG export).


/**
 * Mount a fully interactive chart card into `container`. Returns a teardown() that
 * disconnects the resize/scroll observers.
 *
 * Card structure (top-legend variant — default for line/bar and stacked with <5 series):
 *   div.figure-card
 *     div.figure-header            eyebrow + (title | logo) + subtitle
 *     div.figure-legend-slot       (top-legend lives here)
 *     div.figure-canvas-scroll     horizontal scroll wrapper (+ sticky y-axis overlay)
 *       div.figure-canvas          ← the re-rendered SVG goes here
 *     div.figure-meta              note + source + Data/Image download buttons
 *
 * Card structure (right-legend variant — stacked ≥5 series or explicit legendPosition:"right",
 * with legend rows to show):
 *   div.figure-card
 *     div.figure-header
 *     div.figure-body--legend-right  (flex row: canvas-side left, legend-column right)
 *       div.figure-canvas-scroll
 *         div.figure-canvas
 *       div.figure-legend-slot--right
 *         div.tbl-legend.tbl-legend--vertical
 *     div.figure-meta
 *
 * No-feedback-loop width computation for right-legend:
 *   The ResizeObserver watches the OUTER card element (whose width is set by the layout
 *   column — stable). The chart width is computed as:
 *     cardWidth − LEGEND_COLUMN_WIDTH − LEGEND_GAP
 *   This means the legend column taking space does NOT narrow the observed element, so
 *   there is no resize feedback loop. (Same discipline as the existing canvasScroll
 *   observer for the SVG-widening case.)
 */
export function mountChart(container: HTMLElement, opts: MountOptions): () => void {
  const unique = normalizeSpec(opts.spec);
  if (unique !== opts.spec) opts = { ...opts, spec: unique };
  // Small-multiples figures take a separate mount path (shared faceted SVG, or a responsive
  // per-pane grid) so the heavily-tuned single-chart controller below stays untouched.
  if (opts.spec.small_multiples) return mountFigure(container, opts);

  const { spec, rows, width: initialWidth } = opts;
  // Explicit height (callers / golden path) wins; otherwise horizontal bars grow taller
  // with the bar/row count and everything else uses the fixed default.
  const height = opts.height ?? computeChartHeight(spec, rows);
  // The engine chose the height, not the host (RenderOptions.heightFromModel).
  const heightFromModel = opts.height == null;
  const doc = container.ownerDocument;
  // See MountOptions.tooltipContainer for why body is the default rather than `container` itself.
  const tooltipContainer = opts.tooltipContainer ?? doc.body;

  const card = doc.createElement("div");
  // x-<xAxisType>: keys axis-shape-dependent CSS (e.g. the x-axis-title breathing-room fix,
  // styles.ts) to the axis type rather than the chart type — see .x-numeric there for why.
  card.className = `figure-card chart-${spec.chartType} x-${spec.xAxisType}`;

  // onHover: forwarded into attachBandCrosshair below as the crosshair's own notifier — see
  // BandCrosshairOptions.onHover. Fires the host callback then the bubbling `tbl-hover` event,
  // from whatever the crosshair already resolved (never re-derived here).
  // Its disposed flag is set by the returned teardown and checked by the deferred "mount" onRender
  // dispatch below — a synchronous mount-then-teardown (React StrictMode's dev double-invoke, or any
  // fast unmount) would otherwise fire onRender for a chart that has already been disposed.
  // "Disposed" is a logical contract state, not DOM detachment: teardown disconnects observers and
  // listeners but never removes the card from its container, so the svg the consumer would be
  // handed is still sitting exactly where it was mounted — the problem is that its owner considers
  // it torn down. Commit key: the chart width of the last successful draw.
  const life = new LiveLifecycle<number>(card);
  const hoverNotifier = life.hoverNotifier(opts.onHover);

  // Inline title selectors: the mount owns ONE selections object for its whole life. The
  // header's widget change handler mutates it in place, so the PNG download (below) and any
  // later reads see the live state; the header itself is built once and never rebuilt by the
  // resize draw() loop, so the control + its state survive the engine's own re-renders.
  const selections = resolveSelections(spec, opts.selections);

  // Color accent feed: a single-series chart driven by a
  // colored title selector adopts the active option's resolved color as its line color, so it
  // matches the selector's tinted label. `requestAccentRedraw` is assigned once `draw` exists
  // below (forward reference — only invoked later, from a user's selection, by which point the
  // assignment has already run); `draw()` itself recomputes the accent color from the live
  // `selections` on every call, so a selection change picks it up on the very next redraw.
  let requestAccentRedraw: (() => void) | undefined;
  // The accent for the live `selections` (palette.resolveAccentColor). renderChart only applies it
  // when the chart resolves to exactly one series (engine/index.ts) — a multi-series chart's
  // palette/series_colors stay untouched.
  const currentAccent = (): string | undefined => resolveAccentColor(spec, selections);

  // Header: eyebrow above a title row (title left, logo baseline-aligned top-right); subtitle
  // below. Shared with the figure card via buildFigureHeader so the two never diverge.
  const closeTitleSelectors = buildFigureHeader(
    card, doc, spec, opts.eyebrow,
    spec.title_selectors
      ? {
          selectors: spec.title_selectors,
          selections,
          onSelect: opts.onSelect,
          seriesColors: spec.series_colors,
          afterChange: () => requestAccentRedraw?.(),
          isDisposed: life.isDisposed,
        }
      : undefined,
  );

  // Legend slot above the canvas (used for top-legend; hidden/empty for right-legend).
  const legendSlot = doc.createElement("div");
  legendSlot.className = "figure-legend-slot";
  card.appendChild(legendSlot);

  // Y-axis title: a horizontal caption just above the plot (left-aligned), above the legend's
  // canvas. Coexists with the units subtitle.
  appendAxisTitleEl(card, doc, "figure-y-axis-title", spec.y_axis_title ?? null);

  // Scroll wrapper isolates horizontal overflow to the chart region; the canvas holds the
  // native-px SVG (which overflows below MIN_CHART_WIDTH).
  const canvasScroll = doc.createElement("div");
  canvasScroll.className = "figure-canvas-scroll";
  const canvas = doc.createElement("div");
  canvas.className = "figure-canvas";
  canvasScroll.appendChild(canvas);
  card.appendChild(canvasScroll);

  renderSourceLine(card, {
    note: spec.note,
    source: spec.source,
    actions: buildDownloadActions(doc, spec, rows, opts.downloadName, selections, opts.hooks),
  });

  container.appendChild(card);

  // --- chart controller: re-render at the container width on resize ---
  // The chart width of the last successful draw is `life`'s commit key. The hover attachments of the
  // current draw (treemap's included) are `life`'s detach handles: the card sits outside the svg,
  // so a redraw or unmount under a still pointer would otherwise strand it (Ruling 21; B2). The svg
  // CURRENTLY in the canvas is `life`'s svg 0, re-read (not captured) by the deferred "mount"
  // onRender dispatch below — see it for why. None between a failed render and the next successful
  // one: draw()'s catch replaces the canvas with a .figure-error and there is no live svg to report.
  //
  // The card width the last successful draw was given: where a redraw falls back to when the card
  // reports no width of its own (no layout, or a hidden tab). Not the commit key, which is the CHART
  // width — beside a right legend, the legend column narrower.
  let lastOuterWidth = 0;
  let currentOverlay: OverlayEl | null = null;
  let xTitleAdded = false;
  // Track the current effective legendPosition so we can rebuild layout on first call.
  let currentLegendPos: "top" | "right" | null = null;

  // Area click-to-restack (live/area-restack.ts). Non-area charts never touch any of this.
  const restack = createRestackController({
    life,
    canvas,
    getOnLegendSelect: () => opts.onLegendSelect,
  });

  // The top legend slot and the right-legend column (live/legend-layout-dom.ts).
  const legendDom = createLegendSlots(doc, card, canvasScroll, legendSlot);

  /** The width the chart is drawn at on a card `outerWidth` wide with the legend at `legendPos`. */
  const chartTarget = (outerWidth: number, legendPos: "top" | "right"): number => {
    // For right-legend, the chart width is computed from the OUTER card width (stable),
    // not from canvasScroll (which would shrink as the legend takes space → feedback loop).
    const chartAvail = legendPos === "right"
      ? outerWidth - LEGEND_COLUMN_WIDTH - LEGEND_GAP
      : outerWidth;
    // A timeline goes vertical instead of scrolling, so it renders at the real width down to a phone;
    // a treemap re-lays itself out at any width, down to its own 280px floor.
    const minW = spec.chartType === "timeline" ? TL_GEOM.minLiveWidth
      : spec.chartType === "treemap" ? TM_GEOM.minLiveWidth
      : MIN_CHART_WIDTH;
    return Math.max(minW, Math.round(chartAvail));
  };

  const draw = (
    outerWidth: number,
    legendPos: "top" | "right",
    renderPhase?: "mount" | "resize" | "reselect" | "restack",
  ): void => {
    const target = chartTarget(outerWidth, legendPos);
    if (life.isCommitted(target) && legendPos === currentLegendPos) return;
    life.runDetaches();
    // The detach can end a hover, and a consumer may unmount from that onHover(null) / tbl-hover,
    // synchronously. Drawing on would wire fresh hover onto a disposed mount.
    if (life.disposed) return;

    // Fresh on every draw() so a selection change picks it up immediately.
    const accentColor = currentAccent();

    // Spec §5.4: re-resolved on every width-driven redraw, on the width actually drawn (`target` —
    // beside a right legend that is the chart column, not the card).
    const timelineOrientation =
      spec.chartType === "timeline" ? resolveTimelineOrientation(spec, rows, target) : undefined;

    let built;
    try {
      built = renderChart(spec, rows, {
        width: target,
        height,
        ...(heightFromModel ? { heightFromModel: true } : {}),
        hooks: opts.hooks,
        ...(timelineOrientation ? { timelineOrientation } : {}),
        ...(restack.order ? { stackOrder: restack.order } : {}),
        ...(accentColor ? { accentColor } : {}),
      });
    } catch (e) {
      // Skipped when a hook (tickLabel, valueLabel, afterRender) tore the mount down. The commit is
      // invalidated, not merely left uncommitted: a resize back to the last GOOD width must not be
      // skipped as unchanged while the error is on screen. Any next width retries.
      life.failDraw(canvas, e, () => {
        // The last good draw's y-axis labels and legend describe a chart that is gone; left up, the
        // labels float over the message and the legend still pins against a detached svg. Its pins
        // are kept (life.legend) so a recovered draw carries them.
        currentOverlay?._ro?.disconnect();
        currentOverlay?.remove();
        currentOverlay = null;
        legendSlot.replaceChildren();
        legendDom.dropRightColumn();
      });
      return;
    }
    // renderChart runs the user's hooks (tickLabel, valueLabel, afterRender) synchronously; one may
    // have torn the mount down. Stop before touching the card again. Same after renderLegend below
    // (legendKey).
    if (life.disposed) return;
    life.commit(target);
    lastOuterWidth = outerWidth;
    const {
      svg, legendItems, seriesKeyRows, seriesLabels, seriesOrder, colors, valueAffixes,
      xAxisTitle, dataInScope, tooltipXParse, tooltipXFormat, legendVisualOrder, netMode,
      shapeLegendItems, colorLegendTitle, shapeLegendTitle, overlayTooltips, segmentLabelsDropped,
      symbolScale, shapeIsSeries, pointOrder,
    } = built;
    // Legend-highlight value pills: attached after the crosshair below, but the legend's
    // onHighlight closure (set when the legend is created) calls through this holder, so the
    // pill renderer just needs to exist by the time the user interacts.
    // ONE resolved icon per series, shared by every tooltip this chart attaches. Handing the attach
    // functions loose channels instead is what let a legend and a tooltip disagree. The fallback
    // covers a series the legend suppressed, so EVERY series resolves — which is what lets the
    // channels go away entirely rather than survive as a path only a lone series could reach.
    const seriesIcons = resolveTooltipIcons({ legendItems, keyRows: seriesKeyRows });
    restack.setSeries(seriesOrder);
    let pillDriver: HighlightPillsHandle | null = null;
    const onHighlight = (active: Set<string>): void => {
      pillDriver?.setActive(active);
      // teardown() leaves the legend on the page; a disposed mount restacks and reports nothing.
      if (life.disposed) return;
      // Area click-to-restack: pinned series move to the BOTTOM of the stack (in click order) so a
      // user can read them against zero; unpinning restores the default order. Driven off PINS
      // (not hover), so this only fires on an actual selection change. Re-renders the whole chart
      // via draw(), which carries the pins onto the freshly built legend.
      if (spec.chartType === "area") {
        restack.update(active, svg, () => {
          draw(card.clientWidth || lastOuterWidth, currentLegendPos ?? legendPos, "restack");
        });
        // A consumer may have torn the mount down from the restack draw's onRender.
        if (life.disposed) return;
      }
      // onLegendSelect: reports the active/dimmed set however it changed — a pin click, a hover,
      // focus/blur, or the reset button (legend.ts's applyHighlight runs onHighlight for all of
      // them; see its own comment). High-frequency: a bare mouse hover fires this, not only a
      // click, so a consumer wiring this up will likely want to debounce.
      life.notify("tbl-legend-select", { active: [...active] }, opts.onLegendSelect);
    };
    // Native px — no makeResponsive/viewBox: the SVG keeps its exact pixel width so it
    // overflows into the scroll wrapper below the floor instead of being CSS-scaled down.
    canvas.replaceChildren(svg);
    life.setSvgs([svg]);

    if (spec.chartType === "timeline") {
      // A timeline's title follows its ticks, which a resize can remove (a narrow vertical render
      // omits them) or bring back, so it is rebuilt on every draw rather than added once.
      canvasScroll.querySelector(":scope > .figure-x-axis-title")?.remove();
      appendXAxisTitle(canvasScroll, xAxisTitle);
    } else if (!xTitleAdded) { appendXAxisTitle(canvasScroll, xAxisTitle); xTitleAdded = true; }

    // --- Legend layout (live/legend-layout-dom.ts) ---
    // Read before the old legend leaves the DOM: focus falls to <body> once it does.
    const carried = life.carryLegend();
    const shapeOpts = {
      shapeItems: shapeLegendItems ?? undefined,
      colorTitle: colorLegendTitle,
      shapeTitle: shapeLegendTitle,
      state: carried?.state,
    };
    const legendHandle = legendDom.place({
      legendPos,
      currentLegendPos,
      legendItems,
      shapeLegendItems,
      legendVisualOrder,
      isTimeline: spec.chartType === "timeline",
      render: (slot, items) => renderLegend(slot, items, {
        svg,
        onHighlight,
        hooks: opts.hooks,
        ...shapeOpts,
        abandoned: life.isDisposed,
      }),
      isDisposed: life.isDisposed,
    });
    if (life.disposed) return; // legendKey tore the mount down

    // Expose the freshly built legend handle for the area-restack re-render path (onHighlight).
    const dropped = life.adoptLegend(legendHandle, carried);

    currentLegendPos = legendPos;

    // --- Hover: one plan per chart family, shared with every figure pane (live/hover-options.ts).
    // A band chart in pills hover mode drives its own coordinated cursor: `attachBandCrosshair` runs
    // hit-test-only (emitOnly), and the locally captured drivers below play the role the figure bus
    // plays for panes, minus the bus — full-band hover (horizontal: into the left label gutter;
    // vertical: stopping at the baseline), a one-row highlight that never covers a section gap, a
    // bolded hovered label (horizontal) / frosted category pill (vertical), and a bar-end value
    // pill. Attach order mirrors wireFigureSvg (crosshair → highlightPills → secondary cursor) so
    // `.tbl-coord` paints above the bars. The legend's onHighlight above calls through `pillDriver`,
    // so the pill renderer just needs to exist by the time the user interacts.
    let secondaryDriver: CursorDriver | null = null;
    const hover = buildHoverPlan("standalone", {
      spec,
      dataInScope,
      colors,
      seriesLabels,
      seriesOrder,
      valueAffixes,
      icons: seriesIcons,
      tooltipContainer,
      hooks: opts.hooks,
      tooltipXParse,
      tooltipXFormat,
      overlayTooltips,
      symbolScale,
      shapeIsSeries,
      pointOrder,
      netMode,
      segmentLabelsDropped: segmentLabelsDropped ?? false,
      treemapTiles: built.treemapTiles,
      onHover: hoverNotifier,
      onResolve: (cat) => {
        pillDriver?.setSuppressedCategory(cat as string | null);
        secondaryDriver?.(cat, true);
      },
    });
    if (hover.primary) life.addDetach(attachPrimaryHover(svg, hover.primary));
    pillDriver = attachPlanPills(svg, hover);
    if (hover.secondary) secondaryDriver = attachSecondaryHover(svg, hover.secondary);

    currentOverlay?._ro?.disconnect();
    currentOverlay?.remove();
    currentOverlay = spec.chartType === "timeline" || spec.chartType === "treemap" ? null : attachYAxisOverlay(canvasScroll, svg);

    // --- Reciprocal annotation highlight: hovering a rug block lights up its legend row and every
    // other chart element carrying the same key (its bands, its fills, its other blocks), and dims
    // the rest — the mirror image of hovering the legend row. Clicking pins it, so the highlight can
    // be held and works on touch. Wired on the SVG (events bubble up from the crosshair overlay), so
    // there is no z-order fight with that overlay.
    // Gated on the strip EXISTING, not merely on there being a legend: `resolveRugAnnotationAtPoint`
    // can only match inside `g.tbl-rug`, so without a strip these handlers could only ever return
    // null — while still paying a `document.elementsFromPoint` hit test (and the forced style/layout
    // it implies) on every pointermove of every interactive chart in the archive.
    const stripTop = rugStripTop(svg);
    if (legendHandle && stripTop != null) {
      const handle = legendHandle;
      // The crosshair's hit rect covers the WHOLE svg, so without this the strip would serve a value
      // tooltip ("Oct 2008: 0.73") on top of the annotation highlight — two answers to one hover.
      // Stop every hit area at the top of the strip so the crosshair hides as the pointer enters it.
      svg
        .querySelectorAll<SVGRectElement>(CROSSHAIR_HIT_SELECTOR)
        .forEach((el) => el.setAttribute("height", String(stripTop)));
      svg.addEventListener("pointermove", (evt) => {
        handle.hoverAnnotation(resolveRugAnnotationAtPoint(svg, evt as MouseEvent));
      });
      svg.addEventListener("pointerleave", () => { handle.hoverAnnotation(null); });
      svg.addEventListener("click", (evt) => {
        const key = resolveRugAnnotationAtPoint(svg, evt as MouseEvent);
        if (key) handle.toggleAnnotation(key);
      });
    }

    // --- Two-way selection: clicking a bar/segment/line PINS that series via the legend
    // handle (single source of truth). Only wire when an interactive legend exists; a
    // single-series no-legend chart has nothing to select. The crosshair attaches a
    // TRANSPARENT full-SVG hit rect on top of the marks (pointer-events:all), so a plain
    // click lands on that overlay, not the bar — hit-test THROUGH it with
    // elementsFromPoint and find the first [data-series] mark beneath the cursor.
    // Point charts (scatter / dotplot) take no click (`clickToPin: null`) — just markers + legend
    // (the color legend still drives hover-dim, which is independent of the crosshair).
    if (legendHandle && hover.clickToPin) {
      card.classList.add("is-selectable");
      wireClickToPin(svg, legendHandle, hover.clickToPin);
    } else {
      card.classList.remove("is-selectable");
    }

    // The carried state reached the new legend without its onHighlight: dim the marks added since
    // it was built (the hit paths above), and tell this draw's pill driver.
    const carriedActive = life.reapplyCarried(carried, legendHandle, (active) => pillDriver?.setActive(active));

    // onRender: at each of the four real re-render occasions this mount forces past draw()'s
    // same-width/same-legendPos guard above — mount/resize/reselect, and the area click-to-restack
    // redraw a few lines up ("restack"). The restack call passes its phase explicitly and is
    // guarded by its own try/finally there, so this fires exactly once per user-visible restack
    // (the carried pins and the focus hand-back never reach a NEW draw()).
    const fireRender = (): void => {
      if (renderPhase) {
        if (renderPhase === "mount") {
          // Deferred: this IS mountChart's own initial call, still executing inside mountChart's
          // own body — everything after it (requestAccentRedraw wiring, the scroll listener, the
          // ResizeObserver, and the RETURN of the teardown closure) is still to come. A function
          // cannot both let an exception propagate to its caller AND return a value to that same
          // caller, so a throwing onRender here — unlike resize/reselect, which have no follow-up
          // code in the closure that called draw(), and restack, which has its own try/finally
          // below — would otherwise make mountChart() itself throw: the caller would never receive
          // the teardown, and the ResizeObserver would never attach (chart rendered but left
          // un-tearable-down and non-resizable). Queuing the notify lets mountChart() finish and
          // return normally first; the throw still surfaces (uncaught, on its own microtask) rather
          // than being swallowed — it just arrives slightly later than the other three phases.
          //
          // Guarded on `life.disposed`: a caller that tears the mount down before this microtask runs
          // (a synchronous mount-then-teardown — React StrictMode's dev double-invoke does exactly
          // this) must not have onRender fire afterward for a chart already disposed of — a logical
          // contract state, not DOM detachment; teardown never removes the card from its container.
          // Checked INSIDE the microtask (not before scheduling it) since `disposed` is only known
          // at the time this callback actually runs.
          //
          // The svg is RE-READ from `life`'s svg 0 inside the microtask rather than captured with this
          // closure. Deferring means a synchronous re-render can land first — a host that changes a
          // title selector immediately after mountChart() returns reaches requestAccentRedraw, whose
          // draw() runs `canvas.replaceChildren(newSvg)` and notifies "reselect" synchronously — and
          // the svg this closure was created with is by then DETACHED. Handing a consumer that node
          // makes every DOM mutation its mount handler performs invisible: a silent no-op in the one
          // callback that exists so a consumer can decorate the chart it just mounted.
          //
          // RE-TARGET rather than skip: "mount" means "the first notification for this mounted
          // chart", and a consumer's one-time decoration must land SOMEWHERE or it never happens at
          // all for the life of the chart. (Whether the label is exactly right in that sequence is a
          // smaller complaint than never firing; a consumer that decorates on more than one phase is
          // already handed the same fresh svg twice per redraw and has to be idempotent regardless.)
          // Identity is read as `life`'s svg 0, the reference draw() assigns beside its own
          // replaceChildren: `svg.parentNode === canvas` would answer the same question here but not
          // in mountFigure, where each pane's svg lives in its own cell wrapper, and a draw counter
          // would need threading and keeping in step to say no more than the live reference does.
          // Deliberately NOT `svg.isConnected`: a mount into a detached container reports false on a
          // perfectly current svg (most of the test suite mounts exactly that way).
          life.deferMountRender(0, () => opts.onRender);
        } else {
          life.notify("tbl-render", { svg, phase: renderPhase }, opts.onRender);
        }
      }
    };

    // The drop is reported after onRender, which must be handed THIS draw's svg: on an area chart a
    // dropped pin changes the stack order, and onHighlight restacks with a draw of its own.
    life.finishRedraw(
      fireRender,
      dropped ? () => onHighlight(carriedActive) : null,
      // life.legend, not legendHandle: that restack may have replaced the legend again.
      () => { if (carried?.focus) life.legend?.focus(carried.focus); },
    );
  };

  // Initial draw: we don't know the series count yet, so render first to get legendItems,
  // then resolve legendPosition from the result. Use initialWidth or a fallback for the
  // very first render (before the ResizeObserver fires).
  const initialCardWidth = card.clientWidth || initialWidth || 720;
  // Quick pre-render to detect series count (width doesn't matter for position resolution). Its
  // SVG is discarded (never mounted), so `afterRender` is stripped from the hooks passed here —
  // else a real mount would fire a mutating, possibly side-effecting hook twice: once uselessly
  // on this throwaway probe, once more on the real draw() below. Every other hook is a pure
  // formatter, unaffected by running against output nobody sees.
  let prelimLegendItems: NonNullable<ReturnType<typeof renderChart>["legendItems"]> = [];
  let prelimShapeRows = 0;
  try {
    const prelimHooks = opts.hooks?.afterRender ? { ...opts.hooks, afterRender: undefined } : opts.hooks;
    // The accent too, as draw() passes it: without it a single series is painted its base colour,
    // which under a texture can be one the engine cannot read (validation accepts it wherever the
    // accent is always painted over it), and the throw would leave the legend placed with no rows.
    const prelimAccent = currentAccent();
    const prelim = renderChart(spec, rows, {
      width: initialCardWidth,
      height,
      ...(heightFromModel ? { heightFromModel: true } : {}),
      hooks: prelimHooks,
      ...(prelimAccent ? { accentColor: prelimAccent } : {}),
    });
    prelimLegendItems = prelim.legendItems ?? [];
    prelimShapeRows = prelim.shapeLegendItems?.length ?? 0;
  } catch {
    // Ignore — draw() will surface the error.
  }
  // The spec's legend position on a card `cardW` wide, by the export's rule (legendInRightColumn):
  // "right" only for a legend with rows to show. A legend with none — a single series,
  // `series_legend: false` with no other rows, a treemap's flat data — reserves no column, so the
  // plot takes the card's full width, as in the PNG. Legend rows do not depend on the chart's width
  // (pinned per row source in test/right-legend-no-rows.test.ts), so the probe's rows hold at
  // every width — except a timeline's: a resize can switch its
  // orientation, and with it whether drawn lanes replace the rows, so it is asked at the width the
  // column would leave.
  const specPos = (cardW: number): "top" | "right" => {
    if (spec.chartType !== "timeline") {
      return legendInRightColumn(spec, prelimLegendItems, prelimShapeRows, rows) ? "right" : "top";
    }
    // A timeline's position never depends on its row count (only a stacked chart's does), so this
    // check is cheap and skips the orientation layout for every timeline that is not "right".
    if (resolveLegendPosition(spec, 0, rows) !== "right") return "top";
    const orientation = resolveTimelineOrientation(spec, rows, chartTarget(cardW, "right"));
    return timelineLegendRowCount(spec, rows, orientation) > 0 ? "right" : "top";
  };
  // Fall back to top if the card is too narrow for the right-legend column.
  const resolvedPos = (): "top" | "right" => {
    const cardW = card.clientWidth || initialWidth || 720;
    const pos = specPos(cardW);
    if (pos === "right" && cardW < LEGEND_RIGHT_MIN_CARD_WIDTH) {
      return "top";
    }
    return pos;
  };

  draw(initialCardWidth, resolvedPos(), "mount");

  // Wire the accent-redraw hook (see its declaration above): a title-selector change forces
  // draw() past its same-width/same-legendPos early return, mirroring the area click-to-restack
  // pattern (`life.invalidate()` then a fresh draw() call at the current width/legendPos).
  requestAccentRedraw = () => {
    if (life.disposed) return;
    life.invalidate();
    draw(card.clientWidth || lastOuterWidth || initialCardWidth, currentLegendPos ?? resolvedPos(), "reselect");
  };

  // Single persistent scrollLeft → translateX for the sticky y-axis overlay.
  let scrollRaf: number | null = null;
  const onScroll = (): void => {
    if (scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (currentOverlay) currentOverlay.style.transform = `translateX(${canvasScroll.scrollLeft}px)`;
    });
  };
  canvasScroll.addEventListener("scroll", onScroll);

  // Re-render on width change. For right-legend, observe the OUTER card (stable width set by
  // layout column, unaffected by inner SVG widening → no feedback loop). For top-legend,
  // canvasScroll is equivalent, but we observe card uniformly so the legendPos computation
  // always has access to the full outer width.
  // Guard for environments without ResizeObserver (e.g. jsdom): the initial draw still ran.
  let resizeRaf: number | null = null;
  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        const cardW = card.clientWidth;
        // A hidden card (a collapsed tab) reports 0: drawing then would render at the minimum width
        // and move a right legend to the top, only to undo both when shown. The observer fires
        // again on the first non-zero width.
        if (!cardW) return;
        const pos = specPos(cardW);
        const effectivePos: "top" | "right" =
          pos === "right" && cardW < LEGEND_RIGHT_MIN_CARD_WIDTH ? "top" : pos;
        draw(cardW, effectivePos, "resize");
      });
    });
    ro.observe(card);
  }

  return () => {
    life.dispose();
    ro?.disconnect();
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    if (scrollRaf !== null) cancelAnimationFrame(scrollRaf);
    canvasScroll.removeEventListener("scroll", onScroll);
    currentOverlay?._ro?.disconnect();
    closeTitleSelectors();
  };
}

// --- Small-multiples figure mount ----------------------------------------------------------
// Below this pane width the grid reflows to fewer columns (3→2→1). Used by both modes.
const PANE_MIN_WIDTH = 240;
// Must match the column-gap in `.figure-grid` CSS so the per-pane width math lines up.
const GRID_GAP = 16;

/** Wire the hover + two-way selection onto one figure pane's mini-SVG (both modes draw one per
 *  pane), from the same per-family plan mountChart's draw() builds (live/hover-options.ts; the
 *  pane differences are listed there). Attach order: primary crosshair → click-to-pin (gated on
 *  `handle`: nothing to pin without an interactive legend) → legend-highlight pills → coordinated
 *  cursor. When `inputs.onResolve` is set (coordinated cursor), the primary emits its resolved key
 *  and the secondary-cursor driver is returned for the figure-level bus. */
function wireFigureSvg(
  svg: SVGSVGElement,
  handle: LegendHandle | null,
  inputs: HoverInputs,
  sinks: {
    /** Legend-highlight pills: the pane's value-pill handle is registered here so the figure-level
     *  legend can fire every pane's pills on highlight, and the coordinated cursor can suppress the
     *  hovered category's pills. */
    onPillDriver?: (handle: HighlightPillsHandle) => void;
    /** Receives this pane's hover detach handle (crosshair.ts `HoverDetach`); mountFigure runs every
     *  pane's before each redraw and on teardown, as mountChart does its own. */
    onHoverDetach: (detach: HoverDetach) => void;
  },
): CursorDriver | undefined {
  const hover = buildHoverPlan("pane", inputs);
  if (hover.primary) sinks.onHoverDetach(attachPrimaryHover(svg, hover.primary));
  if (handle && hover.clickToPin) wireClickToPin(svg, handle, hover.clickToPin);
  const pills = attachPlanPills(svg, hover);
  if (pills) sinks.onPillDriver?.(pills);
  return hover.secondary ? attachSecondaryHover(svg, hover.secondary) : undefined;
}

/**
 * Mount a small-multiples figure. BOTH modes render into a responsive `.figure-grid` of
 * independent per-pane mini-chart SVGs (each its own y-scale or, in shared mode, a forced
 * common y-scale), reflowing columns by width. The top legend's highlight root is the GRID so
 * dimming/pinning spans every pane; each pane gets its own crosshair + click-to-select,
 * dispatched per pane by xAxisType (band for categorical, line for continuous).
 *
 * Shared vs. per-pane is now ENTIRELY a renderFigure concern: shared mode forces one y-domain
 * across panes and hides the y-tick labels on non-leftmost columns; the live wiring here is
 * identical for both. Both modes support line, bar, and stacked panes. A coordinated cursor
 * (on by default, `coordinated_cursor: false` to disable) echoes a secondary cursor on sibling
 * panes at the hovered x.
 */
function mountFigure(container: HTMLElement, opts: MountOptions): () => void {
  const { spec, rows } = opts;
  const sm = spec.small_multiples!;
  const doc = container.ownerDocument;
  // See MountOptions.tooltipContainer for why body is the default rather than `container` itself.
  const tooltipContainer = opts.tooltipContainer ?? doc.body;

  const card = doc.createElement("div");
  // x-<xAxisType>: same axis-keyed class as mountChart's card — see the comment there. A faceted
  // scatter never carried the chart-type class this replaces, so this is a fix, not just a rename.
  card.className = `figure-card x-${spec.xAxisType}`;
  // Its disposed flag is set by the returned teardown and checked by the deferred "mount" onRender
  // dispatch below — see mountChart's for why (a synchronous mount-then-teardown must not fire
  // onRender afterward for a chart that no longer exists). Commit key: the grid signature.
  // `life` also holds the pane svgs CURRENTLY in the grid, by pane index — re-read (not captured)
  // by the deferred "mount" onRender dispatch below; see mountChart's identical dispatch comment.
  // Emptied by a failed render, which replaces the grid with a .figure-error and leaves no live
  // pane at all. And it holds every pane's hover detach handle of the current draw, and the legend
  // of the current draw, read by the next one to carry its pins (see CarriedLegend).
  const life = new LiveLifecycle<string>(card);
  // onHover: same notifier shape as mountChart's, forwarded per pane through wireFigureSvg's ctx.
  const hoverNotifier = life.hoverNotifier(opts.onHover);
  // Inline title selectors — same single shared selections object discipline as mountChart.
  // `afterChange` re-renders the pane grid so a colored option's accent recolors every pane's bars
  // live (parity with mountChart's requestAccentRedraw). Forward-declared: assigned once draw()
  // exists below. See TitleSelectorWiring.afterChange.
  const selections = resolveSelections(spec, opts.selections);
  let requestFigureRedraw: (() => void) | undefined;
  const closeTitleSelectors = buildFigureHeader(
    card, doc, spec, opts.eyebrow,
    spec.title_selectors
      ? {
          selectors: spec.title_selectors,
          selections,
          onSelect: opts.onSelect,
          seriesColors: spec.series_colors,
          afterChange: () => requestFigureRedraw?.(),
          isDisposed: life.isDisposed,
        }
      : undefined,
  );

  const legendSlot = doc.createElement("div");
  legendSlot.className = "figure-legend-slot";
  card.appendChild(legendSlot);

  // Figure-level y-axis title: one caption above the whole grid (left-aligned).
  appendAxisTitleEl(card, doc, "figure-y-axis-title", spec.y_axis_title ?? null);

  // Body: BOTH modes use the responsive `.figure-grid` of independent per-pane mini-SVGs.
  // (Shared mode is no longer a single faceted SVG — it is the same per-pane composition with
  // one shared y-domain + y-labels only on the left column, all handled inside renderFigure.)
  // Variable-width figures never reflow to extra rows — they keep their columns and scroll
  // horizontally when narrow, so their grid lives inside a horizontal-scroll wrapper.
  const smCfg = spec.small_multiples!;
  const variableWidths = smCfg.pane_widths != null && smCfg.pane_widths !== "equal";
  const noStack = variableWidths;
  const grid = doc.createElement("div");
  grid.className = "figure-grid";
  if (noStack) {
    const scroll = doc.createElement("div");
    scroll.className = "figure-grid-scroll";
    scroll.appendChild(grid);
    card.appendChild(scroll);
  } else {
    card.appendChild(grid);
  }

  // Figure-level x-axis title: one centered caption below the whole grid.
  appendAxisTitleEl(card, doc, "figure-x-axis-title", spec.x_axis_title ?? null);

  renderSourceLine(card, {
    note: spec.note,
    source: spec.source,
    actions: buildDownloadActions(doc, spec, rows, opts.downloadName, selections, opts.hooks),
  });
  container.appendChild(card);

  // Distinct in-scope facet values (respecting pane_order) → the pane count. Used to clamp the
  // column count BEFORE computing paneW, so the per-pane render width matches the grid cell
  // width even when there are fewer panes than the reflow/config would allow.
  // Counted over the rows renderFigure draws: a pane holding only rows of a section section_order
  // leaves out is never rendered, so it must not take a grid column.
  const figCols = resolveColumns(spec, rows);
  const facetCol = figCols.facet;
  const sectionCol = figCols.section;
  const drawnRows = rowsInSectionOrder(rows, spec.section_order, sectionCol ? (r) => r[sectionCol] as string : null);
  const paneCount = (): number => {
    const distinct = new Set<string>();
    for (const r of drawnRows) {
      const v = facetCol ? r[facetCol] : undefined;
      if (typeof v === "string" && v !== "") distinct.add(v);
    }
    const n = sm.pane_order && sm.pane_order.length
      ? sm.pane_order.filter((v) => distinct.has(v)).length
      : distinct.size;
    return Math.max(1, n);
  };

  // Draw the responsive grid of independent per-pane mini-SVGs. Used by BOTH modes: renderFigure
  // returns a uniform panes[] grid (shared mode forces one y-domain + hides non-left y-labels
  // internally), so the live wiring is identical — each pane gets its own crosshair + selection,
  // and the legend's highlight root is the grid so dimming/pinning spans every pane.
  const isShared = (sm.mode ?? "shared") === "shared";

  // Point-chart panes (dot plots / scatters) carry only markers, so they read fine much narrower
  // than line/bar panes — use a smaller reflow floor so a configured column count (e.g. 3) still
  // fits at common widths instead of collapsing to 2.
  const isPointFigure = spec.chartType === "dotplot" || spec.chartType === "scatter";
  // Waterfall panes carry long step labels (often rotated) under the plot, so give them a wider
  // reflow floor (fewer, roomier columns) than a plain bar pane.
  const isWaterfallFig = spec.chartType === "waterfall";
  const paneMinWidth = isPointFigure ? 160 : isWaterfallFig ? 320 : PANE_MIN_WIDTH;
  // Categorical (band) figures whose hover is the shade + bar-end pill (like the standalone bar
  // chart), not the floating tooltip. Used to give a lone pane that treatment (see `coordinated`).
  const isCategoricalBarFig = spec.chartType === "bar" || spec.chartType === "stacked";
  // Dot-plot AND bar/stacked panes render ~33% taller (320); waterfall panes taller still (420) to
  // clear rotated step labels; line/scatter keep the default (240). Single source of truth shared
  // with the PNG export (export-png.ts) so the two paths can't drift. (A horizontal bar, stack or
  // dumbbell is never a figure: `columns.facet` is rejected on it, spec/facet-groups.ts.)
  const figHeight = figurePaneHeight(spec);

  const drawGrid = (outerWidth: number, renderPhase?: "mount" | "resize" | "reselect"): void => {
    const baseCols = sm.columns && sm.columns > 0 ? sm.columns : 0; // 0 → reflow-driven
    // Reflow: how many columns fit at >= paneMinWidth each, capped by config and pane count
    // (so renderFigure won't re-clamp and leave paneW mismatched against the grid cells).
    // NO-STACK figures (variable widths) never reduce columns for width — they keep the configured
    // columns (else a single row) and scroll horizontally instead.
    const fitCols = Math.max(1, Math.floor((outerWidth + GRID_GAP) / (paneMinWidth + GRID_GAP)));
    const cols = noStack
      ? Math.max(1, Math.min(baseCols || paneCount(), paneCount()))
      : Math.max(1, Math.min(baseCols || fitCols, fitCols, paneCount()));
    // No-stack: keep panes at a readable minimum and let the row overflow into the scroll wrapper.
    const naturalW = cols * paneMinWidth + (cols - 1) * GRID_GAP;
    const gridW = noStack ? Math.max(outerWidth, naturalW) : outerWidth;
    // Pass the TOTAL inner grid width + gap whenever renderFigure sizes explicit per-column widths
    // — SHARED mode (unequal labeled/label-less columns), or variable pane_widths in either mode.
    // Otherwise (equal per-pane) pass one shared pane width for 1fr columns.
    const useGridWidth = isShared || variableWidths;
    const paneW = Math.max(paneMinWidth, Math.floor((gridW - GRID_GAP * (cols - 1)) / cols));
    const sig = useGridWidth ? `s:${cols}:${gridW}` : `p:${cols}:${paneW}`;
    if (life.isCommitted(sig)) return;
    life.runDetaches();
    // As mountChart's draw(): a consumer may unmount from the onHover(null) the detach just sent.
    if (life.disposed) return;
    // Inline-selector accent (parity with mountChart's draw()): recolor every pane's bars to the
    // active option's color. renderFigure forwards accentColor to each pane's renderChart, which
    // applies it to single/no-series bars (category_colors still overrides; multi-series unchanged).
    // Gated on a resolvable colored option → figures without one pass nothing and stay byte-identical.
    const accentColor = resolveAccentColor(spec, selections);
    let fig: FigureRenderResult;
    try {
      fig = useGridWidth
        ? renderFigure(spec, rows, {
            gridWidth: gridW,
            gridGap: GRID_GAP,
            height: figHeight,
            columns: cols,
            hooks: opts.hooks,
            ...(accentColor ? { accentColor } : {}),
          })
        : renderFigure(spec, rows, {
            width: paneW,
            height: figHeight,
            columns: cols,
            hooks: opts.hooks,
            ...(accentColor ? { accentColor } : {}),
          });
    } catch (e) {
      // Skipped when a hook in a pane's render tore the mount down. Invalidated, as mountChart's
      // draw(): the failed width and the last good one both retry.
      // As mountChart's draw(): the legend goes with the panes it pinned; its pins are kept.
      life.failDraw(grid, e, () => legendSlot.replaceChildren());
      return;
    }
    // renderFigure runs the user's hooks synchronously for every pane; one may have torn the mount
    // down. Stop before touching the card again (as mountChart's draw(); also after renderLegend).
    if (life.disposed) return;
    life.commit(sig); // commit only after a successful render
    // Explicit per-column px widths (shared mode, or variable pane_widths in either mode): the
    // panes were rendered at those widths, so the grid template must match. Else equal 1fr columns.
    if (fig.columnWidths && fig.columnWidths.length) {
      grid.style.gridTemplateColumns = fig.columnWidths.map((w) => `${w}px`).join(" ");
    } else {
      grid.style.gridTemplateColumns = "";
    }
    grid.style.setProperty("--figure-cols", String(fig.columns));
    grid.replaceChildren();
    for (const pane of fig.panes) {
      const cell = doc.createElement("div");
      cell.className = "figure-pane";
      const title = doc.createElement("div");
      title.className = "figure-pane-title";
      title.textContent = pane.title;
      cell.appendChild(title);
      if (pane.svg) cell.appendChild(pane.svg);
      grid.appendChild(cell);
    }
    life.setSvgs(fig.panes.map((p) => (p.svg as SVGSVGElement | undefined) ?? undefined));
    // Read before the old legend leaves the DOM: focus falls to <body> once it does.
    const carried = life.carryLegend();
    legendSlot.replaceChildren();
    // Highlight root = the grid, so legend hover/pin dims [data-series] across EVERY pane SVG.
    // Each pane registers its value-pill driver here; the legend fires them all on highlight.
    const pillDrivers: HighlightPillsHandle[] = [];
    const hasFigShape = !!(fig.shapeLegendItems && fig.shapeLegendItems.length);
    const onHighlight = (active: Set<string>): void => {
      for (const d of pillDrivers) d.setActive(active);
      if (life.disposed) return;
      // onLegendSelect: same "however it changed" note as mountChart's identical dispatch —
      // fires on hover/focus/blur too, not only a pin click; high-frequency, debounce-worthy.
      life.notify("tbl-legend-select", { active: [...active] }, opts.onLegendSelect);
    };
    const handle = fig.legendItems || hasFigShape
      ? renderLegend(legendSlot, fig.legendItems ?? [], {
          svg: grid,
          onHighlight,
          hooks: opts.hooks,
          shapeItems: fig.shapeLegendItems ?? undefined,
          colorTitle: fig.colorLegendTitle,
          shapeTitle: fig.shapeLegendTitle,
          state: carried?.state,
          abandoned: life.isDisposed,
        })
      : null;
    if (life.disposed) return; // legendKey tore the mount down
    const dropped = life.adoptLegend(handle, carried);
    // Attach each pane's crosshair ALWAYS (single-series bar panes have no legend but still
    // need tooltips); selection click is gated on `handle` inside wireFigureSvg, and
    // `.is-selectable` is set below from the panes that were actually wired.

    // Coordinated cursor: hovering one pane echoes a secondary cursor on every OTHER pane at the
    // same x. Default on for multi-pane figures; `coordinated_cursor: false` disables. The bus
    // collects each pane's secondary-cursor driver; a pane's primary crosshair emits its resolved
    // x-key, which drives the others (and clears the source's own secondary).
    // Multi-pane figures coordinate cursors across panes. A SINGLE-pane bar/stacked figure (a
    // small_multiples chart whose facet resolves to one value) has nothing to coordinate, but it
    // should still get the in-place shade + bar-end value pill instead of falling back to the
    // legacy floating tooltip — i.e. behave like the standalone bar chart. So enable the same
    // path for a lone bar/stacked pane. Line/area figures keep the tooltip when standalone-like.
    const coordinated =
      sm.coordinated_cursor !== false && (fig.panes.length > 1 || isCategoricalBarFig);
    const drivers: Array<(key: unknown, active?: boolean) => void> = [];
    // Render EVERY pane at the hovered x: the source (hovered) pane gets active styling (heavier
    // labels + the x-axis value above); the rest get passive styling. null clears all.
    const emit = (sourceIdx: number, key: unknown): void => {
      for (let i = 0; i < drivers.length; i++) drivers[i]!(key, i === sourceIdx);
      // Hovering a category surfaces its per-category value pills (coordinated cursor) on every
      // pane; suppress that same category in the series-highlight pills so they don't double up.
      // A non-category key (line figures: a numeric x) or null clears the suppression.
      const cat = typeof key === "string" ? key : null;
      for (const d of pillDrivers) d.setSuppressedCategory(cat);
    };

    fig.panes.forEach((pane, idx) => {
      if (!pane.svg) { drivers.push(() => {}); return; }
      const driver = wireFigureSvg(pane.svg, handle, {
        spec,
        tooltipContainer,
        dataInScope: pane.dataInScope ?? [],
        colors: pane.colors ?? new Map(),
        seriesLabels: fig.seriesLabels,
        seriesOrder: pane.seriesOrder ?? [],
        valueAffixes: pane.valueAffixes ?? fig.valueAffixes,
        tooltipXParse: pane.tooltipXParse,
        tooltipXFormat: pane.tooltipXFormat,
        overlayTooltips: pane.overlayTooltips,
        symbolScale: pane.symbolScale,
        shapeIsSeries: pane.shapeIsSeries,
        pointOrder: pane.pointOrder,
        netMode: pane.netMode,
        symbolSeries: fig.seriesOrder,
        // One shared key for the whole figure, so every pane's tooltip agrees with it. The
        // fallback is per-PANE: per-pane mode resolves each pane's colours independently, and a
        // single-series figure has no legend rows to read at all.
        icons: resolveTooltipIcons({
          legendItems: fig.legendItems,
          keyRows: pane.seriesKeyRows,
        }),
        hooks: opts.hooks,
        facet: pane.value,
        onHover: hoverNotifier,
        ...(coordinated ? { onResolve: (key: unknown) => emit(idx, key) } : {}),
      }, {
        onPillDriver: (d) => pillDrivers.push(d),
        onHoverDetach: (d) => life.addDetach(d),
      });
      drivers.push(driver ?? (() => {}));
    });
    // Not `handle != null`: dot-plot and scatter panes get no click wiring (nor do their standalone
    // charts), so a legend alone would advertise a click that does nothing.
    card.classList.toggle(
      "is-selectable",
      fig.panes.some((pane) => pane.svg != null && CLICK_TO_PIN_SVGS.has(pane.svg)),
    );

    // As mountChart's draw(): the carried state reached the legend without its onHighlight.
    const carriedActive = life.reapplyCarried(carried, handle, (active) => {
      for (const d of pillDrivers) d.setActive(active);
    });

    // onRender: once PER PANE (there is no single wrapping SVG for a figure to report) at the
    // three real re-render occasions — mirrors mountChart's dispatch, gated the same way, INCLUDING
    // the "mount" deferral (mountFigure's own initial draw() call has the identical ResizeObserver/
    // teardown-construction-after-it shape mountChart's does — see that dispatch's comment).
    // Fired here, at the true end of drawGrid — after the legend is (re)built and every pane's
    // crosshair/coordinated-cursor DOM is wired — so every phase (mount/resize/reselect) sees the
    // SAME finished DOM shape mountChart's end-of-draw() dispatch sees. Firing earlier (right after
    // the pane SVGs were appended, before legendSlot.replaceChildren()) meant a synchronous
    // resize/reselect saw the PREVIOUS render's legend, and any DOM a consumer applied here was
    // wiped a few lines later.
    const fireRender = (): void => {
      if (renderPhase) {
        fig.panes.forEach((pane, i) => {
          if (!pane.svg) return;
          if (renderPhase === "mount") {
            // Guarded on `life.disposed`, and RE-READING the pane's live svg by index instead of
            // capturing this render's -- see mountChart's identical dispatch comment for both.
            life.deferMountRender(i, () => opts.onRender);
          } else if (!life.disposed) { // a consumer may tear down from an earlier pane's onRender
            life.notify("tbl-render", { svg: pane.svg, phase: renderPhase }, opts.onRender);
          }
        });
      }
    };

    life.finishRedraw(
      fireRender,
      dropped ? () => onHighlight(carriedActive) : null,
      () => { if (carried?.focus) handle?.focus(carried.focus); },
    );
  };

  const draw = (w: number, phase?: "mount" | "resize" | "reselect"): void => { drawGrid(w, phase); };

  const initialWidth = card.clientWidth || opts.width || 720;
  // On a selection change, re-render the grid so the accent tracks the active option. Reset the
  // width-keyed guard (sig is width-only) so the same-width re-render isn't skipped.
  requestFigureRedraw = () => {
    if (life.disposed) return;
    life.invalidate();
    draw(card.clientWidth || initialWidth, "reselect");
  };
  draw(initialWidth, "mount");

  let resizeRaf: number | null = null;
  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        // As mountChart's observer: a hidden card (width 0) waits for its first non-zero width.
        const w = card.clientWidth;
        if (w) draw(w, "resize");
      });
    });
    ro.observe(card);
  }

  return () => {
    life.dispose();
    ro?.disconnect();
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    closeTitleSelectors();
  };
}
