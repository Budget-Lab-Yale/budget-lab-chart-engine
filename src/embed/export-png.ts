// Pure SVG composition + rasterization for PNG export
// Port of C:\dev\GitHub\budget-lab-interactives\tools\ai-labor-market-tracker\export-image.js

import type { ChartSpec } from "../spec/types.js";
import type { RenderHooks } from "../spec/hooks.js";
import { resolveSelections, resolveTitleText } from "../spec/title.js";
import type { TidyRow } from "../data/index.js";
import { renderChart, renderFigure } from "../engine/index.js";
import { normalizeSpec } from "../engine/util.js";
import type { FigureRenderResult, LegendItem } from "../engine/index.js";
import { horizontalBarChartHeight, figurePaneHeight, growsWithRows } from "../engine/figure.js";
import { timelineHeight, timelineExportFrame } from "../engine/marks/timeline.js";
import { treemapHeight } from "../engine/marks/treemap.js";
import { resolveAccentColor } from "../engine/palette.js";
import { SHAPE_LEGEND_COLOR } from "../engine/theme.js";
import type { SeriesHatch } from "../engine/hatch.js";
import { ICON_BOX, iconFromLegendItem, legendRowMarkupSvg, iconSvgGroup, iconWidth } from "../engine/icon.js";
import type { IconSpec } from "../engine/icon.js";
import {
  LEGEND_COLUMN_WIDTH,
  LEGEND_GAP,
  LEGEND_RIGHT_MIN_CARD_WIDTH,
  legendInRightColumn,
  orderForRightLegend,
} from "../engine/legend-layout.js";
import { timelineTextWidth } from "../engine/timeline-text.js";
import {
  W,
  H,
  MARGIN,
  INNER_W,
  SCALE,
  W_BODY,
  W_SEMI,
  FONT,
  NAVY,
  BODY,
  AXIS,
  HEADING,
  SVG_NS,
  textEl as textElDoc,
  measureText,
  wrapText,
  drawLines as drawLinesDoc,
  createExportRoot,
  composeTopChrome,
  titleFitsBesideLogo,
  bottomChromeHeight,
  composeBottomChrome,
} from "./figure-chrome.js";

// ---------------------------------------------------------------------------
// Document-bound wrappers (this module always draws into the global `document`).
// ---------------------------------------------------------------------------

function textEl(
  x: number,
  y: number,
  str: string,
  opts: { size: number; weight?: number; fill?: string; anchor?: string },
): SVGElement {
  return textElDoc(document, x, y, str, opts);
}

function drawLines(
  root: SVGElement,
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  opt: { size: number; weight?: number; fill?: string; anchor?: string },
): number {
  return drawLinesDoc(document, root, lines, x, firstBaseline, lineHeight, opt);
}

// Small-multiples figure layout tokens. Per-pane chart height comes from figurePaneHeight
// (engine/figure.ts) — the single source of truth shared with the live figure mount.
const PANE_TITLE_H = 18; // per-pane title band height, for a title on one line
const PANE_TITLE_LINE_H = 16; // a wrapped pane title's line pitch (live: 11px at line-height 1.5)
/** Width in px of a pane title (Figtree 700 at 11px, as live and export draw it), from the committed
 *  Figtree advance table rather than canvas `measureText`: whether a title wraps decides the grid's
 *  geometry, so it must not depend on the measuring backend (without a canvas, `measureText` guesses
 *  8px a character and wrapped titles the browser fits on one line). */
const paneTitleWidth = (text: string): number => timelineTextWidth(text, 11, 700);

/** `title` broken at word boundaries into lines no wider than `maxWidth` by paneTitleWidth (a single
 *  word wider than that keeps its own line, as the live title does); a title that fits is returned
 *  whole, exactly as written. */
function wrapPaneTitle(title: string, maxWidth: number): string[] {
  if (paneTitleWidth(title) <= maxWidth) return [title];
  const lines: string[] = [];
  let line = "";
  for (const word of title.split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (line && paneTitleWidth(trial) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [title];
}
const WRAP_LINE_H = 16; // a wrapped legend label's line pitch (the right-hand column's)
const COL_GAP = 20; // horizontal gap between per-pane grid cells
const ROW_GAP = 18; // vertical gap between per-pane grid rows
const AXIS_TITLE_LINE_H = 16; // a wrapped x-axis title's line pitch (the y-axis title's)
/** The least height a frame-filling chart, a framed treemap or a `fillPanes` pane is given, however
 *  little room the frame leaves; content that needs more comes out taller than the frame. */
const MIN_CHART_H = 160;

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/**
 * The export's `legendKey` call: the hook's markup for a row, or `null` to draw the default row.
 *
 * A hook that returns `ctx.rendered` unchanged counts as no hook. CONFIG-SPEC promises such a hook
 * changes nothing, and on screen it does — the live row's HTML wraps under CSS. Drawn as custom
 * markup here, the SVG twin is one unwrapped `<text>`: it skipped the export's own label wrapping,
 * reserved a single row in the right-hand column, and ran a long label off the frame in the
 * download only. Falling through to the default drawing is what makes the promise true.
 */
function exportLegendKey(
  item: { label: string; color: string | undefined; series?: string },
  icon: IconSpec,
  hooks: RenderHooks | undefined,
): string | null {
  if (item.series == null || !hooks?.legendKey) return null;
  const rendered = legendRowMarkupSvg(icon, item.label);
  const custom = hooks.legendKey({
    series: item.series,
    label: item.label,
    color: item.color,
    medium: "svg",
    rendered,
  });
  return custom === rendered ? null : custom;
}

function drawLegend(
  root: SVGElement,
  items: Array<{
    label: string;
    color: string | undefined;
    dashed: boolean;
    markerSymbol?: string;
    markerShape?: LegendItem["markerShape"];
    /** `series_patterns` texture, resolved upstream by the engine's legend builder. */
    hatch?: SeriesHatch;
    outlined?: boolean;
    colors?: string[];
    /** A dumbbell's hollow end — a ring, not a disc. It was absent from this type entirely, so a
     *  hollow series exported filled. */
    hollow?: boolean;
    /** Present for a genuine series/color-legend row; absent for the neutral SHAPE-legend rows
     *  (which have no series key and never invoke `legendKey`). */
    series?: string;
  }>,
  firstBaseline: number,
  leadingTitle?: string,
  /** Only `legendKey` is consumed here, and only for rows carrying `series` — see above. */
  hooks?: RenderHooks,
  /** Where a row wraps: the frame's right margin (a vertical timeline's portrait frame is narrower
   *  than `W`). */
  maxRight: number = MARGIN + INNER_W,
  /** Wrap a label too wide for a whole row onto several lines (Ruling 41). The portrait frame and a
   *  caller-given `frame` set it; frame-less output keeps such a label on one line, as before. */
  wrapLong = false,
): number {
  const legendFont = `${W_BODY} 13px ${FONT}`;
  const titleFont = `${W_SEMI} 12px ${FONT}`;
  const GAP = 6;
  const ITEM_GAP = 18;
  const ROW_H = 20;
  let x = MARGIN;
  let y = firstBaseline;

  // Optional group heading (point charts, dual encoding): a short label before the items.
  if (leadingTitle) {
    root.appendChild(textEl(x, y, leadingTitle, { size: 12, weight: W_SEMI, fill: AXIS }));
    x += measureText(leadingTitle, titleFont) + ITEM_GAP;
  }

  for (const item of items) {
    // ONE drawing. This branched nine ways and got five of them wrong against the live legend — a
    // `rect` was rounded like a chip, a `dot` had no branch at all (the stacked Total exported as a
    // navy bar), `hollow` was missing from the type so a dumbbell ring exported filled, `dashed` was
    // tested before `markerSymbol` so a dashed series with points exported unmarked, and every
    // symbol was drawn at one area. None of that could be caught by reading the export alone, which
    // is why it is no longer written here: engine/icon.ts draws it, the same call the legend makes.
    const icon = iconFromLegendItem(item);
    const swatchW = iconWidth(icon);
    // `rendered` is SVG markup (legendRowMarkupSvg draws from the same iconShapes(icon) the
    // group below does) -- NOT legend.ts's HTML string. `g` below is SVG-namespaced; setting its
    // innerHTML to an HTML string like legend.ts's `<span>`s creates XHTML-namespaced nodes that
    // the canvas rasterizer below (rasterize()) never paints -- correct on screen, invisible in
    // the download. `medium: "svg"` tells the hook which vocabulary is safe to return here.
    // `null`/no hook falls through to the untouched default drawing, and so does `ctx.rendered`
    // returned unchanged (see `exportLegendKey`).
    const custom = exportLegendKey(item, icon, hooks);
    // The wrap check below and the cursor advance at the end of this iteration both key off
    // `itemW` -- it must reflect what the hook ACTUALLY draws, not the untouched default, or a
    // hook that returns `ctx.rendered` plus a suffix (or otherwise-longer text) lays out fine in
    // the live flex legend but overlaps the next item here / runs off the right edge. An exact
    // box (`getBBox()`) isn't reachable: this SVG is built fully detached and only ever
    // serialized for rasterize()'s <img> load below, never inserted into `document` -- and jsdom,
    // this repo's own test DOM, has no `getBBox()` implementation at all, so that path could not
    // be exercised or verified here even if a real browser tolerated it. Re-measuring the hook's
    // OWN text content with the same canvas-metric approximation this function already uses
    // elsewhere (and that measureText() itself already degrades to a `text.length * 8` estimate
    // under jsdom) is the best measurement actually available in this constructor.
    let itemW = swatchW + GAP + measureText(item.label, legendFont);
    if (custom != null) {
      const probe = document.createElementNS(SVG_NS, "g");
      probe.innerHTML = custom;
      itemW = swatchW + GAP + measureText(probe.textContent ?? "", legendFont);
    }
    if (x > MARGIN && x + itemW > maxRight) {
      x = MARGIN;
      y += ROW_H;
    }
    const cy = y - 4;
    if (custom != null) {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("transform", `translate(${x},${cy - ICON_BOX / 2})`);
      g.setAttribute("color", NAVY);
      g.innerHTML = custom;
      root.appendChild(g);
    } else {
      const drawing = iconSvgGroup(document, icon);
      if (drawing) {
        // The primitives are in a box at the origin, so the group is placed by its top-left corner.
        drawing.setAttribute("transform", `translate(${x},${cy - ICON_BOX / 2})`);
        // A row with no colour of its own draws in `currentColor`, which the page supplies live and
        // the export has to supply itself — this frame carries no inherited text colour.
        drawing.setAttribute("color", NAVY);
        root.appendChild(drawing);
      }
      const style = { size: 13, weight: W_BODY, fill: BODY };
      if (wrapLong && itemW > maxRight - MARGIN) {
        // Wider than a whole row: its own rows, the label wrapped beside the swatch, and the next
        // item starts a row below the last line (the returned baseline reserves them).
        const lines = wrapToColumn(item.label, legendFont, maxRight - MARGIN - swatchW - GAP);
        y = drawLines(root, lines, x + swatchW + GAP, y, WRAP_LINE_H, style);
        x = maxRight;
        continue;
      }
      root.appendChild(textEl(x + swatchW + GAP, y, item.label, style));
    }
    x += itemW + ITEM_GAP;
  }
  return y;
}

/**
 * wrapText, plus a hard break for a single token wider than the column. `wrapText` only breaks
 * BEFORE a word, so a label that is one long token — an identifier, a URL — came back as one
 * over-wide line and ran past the column and the frame edge.
 */
function wrapToColumn(text: string, font: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const line of wrapText(text, font, maxWidth)) {
    if (measureText(line, font) <= maxWidth) {
      out.push(line);
      continue;
    }
    let cur = "";
    for (const ch of line) {
      if (cur && measureText(cur + ch, font) > maxWidth) {
        out.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [""];
}

/**
 * Draw a legend as a vertical COLUMN of rows, for the right-hand layout. Returns the baseline
 * below the last row.
 *
 * `root === null` MEASURES without drawing, returning the same baseline. The caller needs the
 * column's height before it can choose the chart's height, and a separate measuring routine would
 * be free to drift from the drawing one — a tall legend would then be laid over the note and source,
 * or off the bottom of the frame, exactly the class of bug the two-pass layout is meant to avoid.
 *
 * The horizontal `drawLegend` above flows items left to right and wraps at the frame; this one
 * gives each item its own row and wraps a long LABEL inside the column instead. Both draw their
 * swatch from `iconSvgGroup`, the same call the live legend makes, so a key cannot differ between
 * the two layouts or between the screen and the download.
 */
function drawLegendColumn(
  root: SVGSVGElement | null,
  items: readonly LegendItem[],
  x: number,
  firstBaseline: number,
  leadingTitle?: string,
  hooks?: RenderHooks,
  /** Resolved `legendKey` markup per row, shared between the measure and draw passes. The column is
   *  laid out twice — once to measure its height, once to draw it — and without this the hook fired
   *  twice per row where the live legend fires it once. A hook is documented as static, but one that
   *  is stateful or non-deterministic would see a different call count here, and could even return
   *  markup whose measured and drawn forms disagree. `buildExportSvg` already strips `afterRender`
   *  from its metadata pre-render for the same reason. */
  customCache?: Map<LegendItem, string | null>,
): number {
  const legendFont = `${W_BODY} 13px ${FONT}`;
  const GAP = 6;
  const ROW_GAP = 8;
  const LINE_H = 16;
  let y = firstBaseline;

  // The group heading a dual-encoding chart carries ("Colour", "Shape"): without it the exported
  // column loses the labels that say which dimension each block of rows stands for.
  if (leadingTitle) {
    if (root) root.appendChild(textEl(x, y, leadingTitle, { size: 12, weight: W_SEMI, fill: AXIS }));
    y += LINE_H + 2;
  }

  for (const item of items) {
    const icon = iconFromLegendItem(item);
    const swatchW = iconWidth(icon);
    let custom: string | null;
    if (customCache?.has(item)) {
      custom = customCache.get(item) ?? null;
    } else {
      custom = exportLegendKey(item, icon, hooks);
      customCache?.set(item, custom);
    }
    if (custom != null) {
      if (root) {
        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("transform", `translate(${x},${y - 4 - ICON_BOX / 2})`);
        g.setAttribute("color", NAVY);
        g.innerHTML = custom;
        root.appendChild(g);
      }
      y += LINE_H + ROW_GAP;
      continue;
    }
    const lines = wrapToColumn(item.label, legendFont, LEGEND_COLUMN_WIDTH - swatchW - GAP);
    if (root) {
      const drawing = iconSvgGroup(document, icon);
      if (drawing) {
        drawing.setAttribute("transform", `translate(${x},${y - 4 - ICON_BOX / 2})`);
        drawing.setAttribute("color", NAVY);
        root.appendChild(drawing);
      }
      drawLines(root, lines, x + swatchW + GAP, y, LINE_H, { size: 13, weight: W_BODY, fill: BODY });
    }
    // Advance past this row: the extra lines it wrapped onto, then a line's height and the gap.
    // Computed here rather than taken from `drawLines`' return, which is the LAST line's baseline —
    // for a single-line label that is the baseline we started at, so using it advanced each row by
    // the gap alone and thirty rows overlapped each other inside 8px apiece. One expression, used
    // whether we drew or only measured, so the two passes cannot disagree.
    y += (lines.length - 1) * LINE_H + LINE_H + ROW_GAP;
  }
  return y;
}

// ---------------------------------------------------------------------------
// buildExportSvg
// ---------------------------------------------------------------------------

/**
 * Output frame for `buildExportSvg`, in CSS px (the PNG rasterises it at 2x). Omitted, the export is
 * the default 1000×750 frame and its output is unchanged. A frame smaller than 320×240 throws, as
 * does a negative or non-finite `logoTop`. A frame too narrow for a title word to fit beside the
 * logo puts the logo on a row of its own (titleFitsBesideLogo).
 *
 * `height` is the TARGET frame, not a guarantee. A chart that fills the frame (a single line, bar-
 * column, area, scatter or similar chart; a figure with `fillPanes`; a row-sized chart with
 * `fitRows` that is taller than the frame) comes out at `height`. A chart that sizes to its content
 * can come out shorter: a figure without `fillPanes`, a row-sized horizontal bar/stacked/dumbbell
 * chart (with or without `fitRows`, which never expands), a treemap (whose height is capped by the
 * room the frame leaves it), a timeline. Content that needs more room than `height` leaves comes out
 * taller (many bar rows without `fitRows`, or more than its floor allows with it; `fillPanes` panes at
 * their 160px floor; a right-hand legend column taller than the plot; chrome that leaves a single
 * chart less than its 160px minimum). The output's height is the SVG's `height` attribute; the
 * caller decides what to do with a mismatch. A timeline keeps its own width and height
 * (timelineExportFrame, timelineHeight): of the frame it takes only `logoTop`, and the wrap of a long
 * x-axis title.
 */
export interface ExportFrame {
  width: number;
  height: number;
  /** Top padding above the logo/title baseline row; default MARGIN (40). Must be finite and ≥ 0. */
  logoTop?: number;
  /**
   * Small-multiples figures only: size every pane row equally so the grid fills the frame's
   * remaining height exactly, growing the panes past their own height or shrinking them below it,
   * but never below 160px. When the frame leaves less than that, the panes stay at 160px and the
   * output comes out taller than `height`. No effect on a single chart. `true`, `false` or absent;
   * anything else throws.
   */
  fillPanes?: boolean;
  /**
   * Row-sized single charts only (horizontal bar/stacked, horizontal dumbbell): when the chart is
   * taller than the room the frame leaves it, compress its row pitch so it fits that room exactly
   * (horizontalBarChartHeight's `maxHeight`). Margins and section gaps keep their size, and a chart
   * that already fits is unchanged, never expanded. The pitch stops at a floor that keeps labels
   * legible: 16px per category-label line (FIT_LABEL_LINE_PX), 15px per bar in the row
   * (FIT_MIN_PX_PER_BAR: a grouped row of three bars needs 45px), and the room the row's own marks
   * reach above and below it plus 3px clear (a dumbbell's dots, connector and gap label; a diverging
   * stack's net dot, 21px), whichever is largest. When the floor
   * binds the output comes out taller than `height`. No effect on any other chart or a figure.
   * `true`, `false` or absent; anything else throws.
   */
  fitRows?: boolean;
}

/**
 * What the two render passes of `buildExportSvg` take from the caller, resolved in two stages,
 * each at the point the export has always read it. Both passes derive their options from these
 * (`metaPassOpts`, `finalPassOpts`) rather than assembling them independently at each call, which
 * is how the metadata pass came to miss the accent (A1, fixed: both now take it).
 *
 * The stages are separate because hooks run during the metadata pass. A formatter that changes the
 * caller's `opts.selections` or replaces `opts.hooks` there is seen by everything read after the
 * pass and by nothing read before it (test/export-read-points.test.ts). Resolving the final pass's
 * inputs early would change what is drawn. So the accent is resolved once for each pass, from the
 * selections as they stand at that pass's read point: the same colour, unless a hook changes the
 * selections during the metadata pass.
 *
 * Geometry that depends on the metadata pass's result (the chart width beside a right-hand legend,
 * a timeline's budget width, a framed treemap's cap, a figure's pane sizes) is in neither: it is
 * computed from that result and added to the final pass at its call.
 */
interface ExportMetaInput {
  /** The frame's inner width: the width the metadata pass renders at. */
  width: number;
  /** The caller's hooks without `afterRender` — see `resolveExportMetaInput`. */
  metaHooks: RenderHooks | undefined;
  /** The accent for the selections as they stand before the pass (`resolveAccent`). The legend
   *  rows are read from this pass, so without it they key a single series in its palette colour
   *  while the final pass draws it in the accent (A1). */
  accentColor: string | undefined;
}

/** Read BEFORE the metadata pass. */
function resolveExportMetaInput(
  spec: ChartSpec,
  opts: { selections?: Record<string, string>; hooks?: RenderHooks },
  width: number,
): ExportMetaInput {
  // `afterRender` is stripped for the metadata pass only: its SVG(s) are discarded (only the
  // legend/title metadata is read), so calling a mutating, potentially side-effecting hook against
  // them would double-fire it per export — once on throwaway output, once more on the SVG that's
  // actually returned. Every other hook is a pure formatter (idempotent), so passing them through
  // unchanged there is harmless.
  const metaHooks = opts.hooks?.afterRender ? { ...opts.hooks, afterRender: undefined } : opts.hooks;
  return { width, metaHooks, accentColor: resolveAccent(spec, opts.selections) };
}

/** The accent for the caller's `selections` (`undefined` = spec defaults): the one the live mount
 *  shows for them, so a downloaded PNG matches what the user sees on screen. `renderFigure` (small
 *  multiples) takes it too, so a faceted chart's per-pane marks adopt it in the export just as they
 *  do live (see mountFigure in render-live.ts). */
function resolveAccent(spec: ChartSpec, selections: Record<string, string> | undefined): string | undefined {
  return resolveAccentColor(spec, selections ?? resolveSelections(spec));
}

/**
 * Read AFTER the metadata pass. The final hooks are not here: the export reads `opts.hooks` afresh
 * at each later use (each legend draw, the final render), and a `legendKey` run by an earlier draw
 * can replace it before a later one. They are passed to `finalPassOpts` at its call.
 */
interface ExportFinalInput {
  /** The caller's title-selector selections, as given (`undefined` = spec defaults). */
  selections: Record<string, string> | undefined;
  /** The active (or default) title-selector option's colour, palette-resolved; the live mount
   *  shows the same accent for these selections. */
  accentColor: string | undefined;
}

function resolveExportFinalInput(
  spec: ChartSpec,
  opts: { selections?: Record<string, string> },
): ExportFinalInput {
  const selections = opts.selections;
  return { selections, accentColor: resolveAccent(spec, selections) };
}

/** The metadata pass's options: legend items and axis titles are read from its result; its SVG is
 *  discarded. */
function metaPassOpts(
  input: ExportMetaInput,
): { width: number; hooks: RenderHooks | undefined; accentColor?: string } {
  return {
    width: input.width,
    hooks: input.metaHooks,
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
  };
}

/** The options every final-pass render shares; the caller adds its geometry. `hooks` is the
 *  caller's `opts.hooks`, read at the call (see `ExportFinalInput`). */
function finalPassOpts(
  input: ExportFinalInput,
  hooks: RenderHooks | undefined,
): { hooks: RenderHooks | undefined; phase: "export"; accentColor?: string } {
  return {
    hooks,
    phase: "export",
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
  };
}

/**
 * Build a self-contained export SVG for the given chart spec and data rows.
 * Pure — no canvas, no async, no external resources. The default frame is 1000×750 (4:3); `opts.frame`
 * (ExportFrame) sets another width/height, logo padding and pane fill. The chart
 * fills the height left after the title/subtitle/legend chrome. A timeline's frame height is its
 * content's, and a vertical timeline's frame is portrait: as wide as the timeline needs, at most
 * 640px (timelineExportFrame, E3), with every piece of chrome laid out at that width.
 * NOTE: the eyebrow is intentionally NOT drawn in the export — the figure number belongs to
 * the publication context, not to the standalone image.
 *
 * `selections` (active title-selector option ids, from the live mount) resolves any `{token}`
 * in the title to the ACTIVE option's label; omitted, tokens resolve with the spec defaults.
 * Either way the exported title is plain text — a raw braced token never prints.
 */
export function buildExportSvg(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: { selections?: Record<string, string>; hooks?: RenderHooks; frame?: ExportFrame } = {},
): SVGSVGElement {
  spec = normalizeSpec(spec);
  const frame = opts.frame;
  if (frame && (!(frame.width >= 320) || !(frame.height >= 240)))
    throw new Error(`export frame must be at least 320×240 (got ${frame.width}×${frame.height})`);
  if (frame?.logoTop !== undefined && !(Number.isFinite(frame.logoTop) && frame.logoTop >= 0))
    throw new Error(`export frame logoTop must be a finite number of at least 0 (got ${frame.logoTop})`);
  for (const key of ["fillPanes", "fitRows"] as const) {
    const v: unknown = frame?.[key];
    if (v !== undefined && typeof v !== "boolean")
      throw new Error(`export frame ${key} must be true, false or absent (got ${String(v)})`);
  }
  const FW = frame?.width ?? W;
  const FH = frame?.height ?? H;
  const FIW = FW - MARGIN * 2;
  const isFigure = spec.small_multiples != null;
  // A single chart whose height grows with its category rows: horizontal bar/stacked, and a
  // horizontal dumbbell — the same predicate computeChartHeight (render-live) asks before sizing
  // from horizontalBarChartHeight, so the download's row pitch matches the page's.
  const rowSized = !isFigure && growsWithRows(spec);
  const isTimeline = !isFigure && spec.chartType === "timeline";
  // A treemap has no portrait frame: frame height = content. Its legend (grouped data) takes the
  // ordinary top/right paths below; treemapExportChartWidth mirrors the width they leave it.
  const isTreemap = !isFigure && spec.chartType === "treemap";

  // Pre-render to read legend items + axis title (rendered for real again below at the
  // computed height). For a figure the legend + x-axis title come from renderFigure (the
  // figure-level legend), not from a single chart.
  const metaInput = resolveExportMetaInput(spec, opts, FIW);
  const meta = isFigure
    ? renderFigure(spec, rows, metaPassOpts(metaInput))
    : renderChart(spec, rows, metaPassOpts(metaInput));
  const legendItems = meta.legendItems ?? [];
  const shapeLegendItems = meta.shapeLegendItems ?? [];
  const hasShapeLegend = shapeLegendItems.length > 0;
  const colorLegendTitle = meta.colorLegendTitle ?? "";
  const shapeLegendTitle = meta.shapeLegendTitle ?? "";
  let xAxisTitle = meta.xAxisTitle ?? "";
  const yAxisTitle = spec.y_axis_title ?? "";

  // Read after the metadata pass — see ExportFinalInput.
  const finalInput = resolveExportFinalInput(spec, opts);
  // Title-selector tokens → the active (or default) option labels, as plain SVG text.
  const title = spec.title ? resolveTitleText(spec, finalInput.selections) : "";
  const subtitle = spec.subtitle ?? "";
  const note = spec.note ?? "";
  const source = spec.source ?? "";

  // A timeline's frame (width, chart width, legend side) is decided the SAME way `tbl-chart
  // validate` decides it — timelineExportFrame, no DOM render needed — so the two can never drift
  // apart (Ruling 17 / task-8 fix round 1). Every other chart keeps the fixed W frame.
  const tlFrame = isTimeline ? timelineExportFrame(spec, rows) : null;
  const frameW = tlFrame?.frameW ?? FW;
  const portrait = tlFrame?.budgetWidth !== undefined;

  const { root, bgRect } = createExportRoot(document, frameW, FH);

  // --- top chrome: title (+ logo), subtitle ---
  // A caller-given frame narrow enough that a title word cannot fit beside the logo (a 320px frame
  // leaves a 66px column) puts the logo on a row of its own, as the portrait frame always does.
  // The slide frames (640 and 1280 wide) keep the side-by-side layout for any ordinary title.
  const logoRow = portrait || (frame != null && !titleFitsBesideLogo(title, frameW));
  let cursor = composeTopChrome(document, root, { title, subtitle, width: frameW, logoRow, topPad: frame?.logoTop });

  // Legend POSITION, from the same decision the live card makes (engine/legend-layout.ts). The
  // export never consulted it, so a stacked chart with five or more series — or a diverging one —
  // showed its legend beside the chart on screen and above it in the download. A small_multiples
  // figure keeps the top layout: its legend is figure-level, and the live path never puts that in a
  // column either. The default frame is a fixed 1000px, so the live path's narrow-card fallback to
  // "top" cannot apply there — except in a vertical timeline's portrait frame, which is always that
  // narrow, so its legend always goes on top (timelineExportFrame). A narrow `frame` applies it below.
  // `legendItems || shapeLegendItems.length` mirrors render-live.ts's own gate. Testing only
  // `legendItems` missed a chart whose ONLY visible legend is the shape legend — `series_legend:
  // false`, or a lone scatter series, leaves `buildLegendItems` null while the shape rows remain —
  // so live laid it out on the right and the export drew it above a full-width plot: the very
  // divergence this file's legend work exists to remove.
  // A timeline takes both from `tlFrame` rather than from this call's own rendered legend metadata.
  // A caller-given `frame` can be as narrow as a live card, so it takes the live card's fallback
  // too: an inner width below LEGEND_RIGHT_MIN_CARD_WIDTH puts the legend on top (the frame's inner
  // width is the card width here: both leave the chart that width less the column and gap). A
  // timeline is exempt: its frame comes from timelineExportFrame, not from `frame`.
  const rightLegend =
    !isFigure &&
    (tlFrame
      ? tlFrame.rightLegend
      : legendInRightColumn(spec, legendItems, shapeLegendItems.length, rows) &&
        !(frame && FIW < LEGEND_RIGHT_MIN_CARD_WIDTH));
  const chartW = tlFrame ? tlFrame.chartW : rightLegend ? FIW - LEGEND_COLUMN_WIDTH - LEGEND_GAP : FIW;

  // The x-axis title wraps in a vertical timeline's portrait frame (Ruling 51b), and in any
  // caller-given `frame`, which can be much narrower than the title (a 640px slide frame); every
  // other export keeps one line. It wraps to the width it is centred in: the plot beside a right-hand
  // legend, else the frame's inner width.
  const wrapsXTitle = portrait || frame != null;
  const xTitleWrapW = portrait ? frameW - 2 * MARGIN : rightLegend ? chartW : frameW - 2 * MARGIN;
  const wrapXTitle = (t: string): string[] =>
    t && wrapsXTitle ? wrapToColumn(t, `${W_SEMI} 12px ${FONT}`, xTitleWrapW) : [t];
  // A framed chart that fills the frame must reserve the extra lines BEFORE its height is chosen, or
  // the output grows past the frame. A timeline's height is its content's, and its title can change
  // with its own render (below), so it reserves them at the end, as the portrait frame always has.
  const reserveXTitleEarly = frame != null && !isTimeline;

  // --- legend(s) + y-axis title (chart-specific chrome) ---
  // A label wider than a whole legend row wraps in the portrait frame and in any caller-given
  // `frame`, which can be narrow enough (a 640px slide, or a right legend fallen back on top) that
  // the label would run off the frame. Frame-less output keeps it on one line, as before.
  const wrapLongLegend = portrait || frame != null;
  if (legendItems.length && !rightLegend) {
    cursor = drawLegend(
      root, legendItems, cursor + 26, hasShapeLegend ? colorLegendTitle : undefined, opts.hooks, frameW - MARGIN,
      wrapLongLegend,
    );
  }
  // Point charts with dual encoding: a second, neutral-gray SHAPE legend below the color legend.
  if (hasShapeLegend) {
    const shapeRows = shapeLegendItems.map((s) => ({
      label: s.label,
      color: SHAPE_LEGEND_COLOR,
      dashed: false,
      markerShape: "point" as const,
      markerSymbol: s.markerSymbol,
    }));
    if (!rightLegend) {
      cursor = drawLegend(
        root, shapeRows, cursor + (legendItems.length ? 20 : 26), shapeLegendTitle || undefined, undefined, frameW - MARGIN,
        wrapLongLegend,
      );
    }
  }
  // Y-axis title: a left-aligned caption just above the plot (coexists with the units subtitle).
  if (yAxisTitle) {
    cursor = drawLines(root, wrapText(yAxisTitle, `${W_SEMI} 12px ${FONT}`, chartW), MARGIN, cursor + 18, 16, {
      size: 12,
      weight: W_SEMI,
      fill: AXIS,
    });
  }
  const chartTop = cursor + 14;

  // Reserve the bottom-chrome height so the chart fills the rest (total == H).
  let bottomH = bottomChromeHeight({ note, source, width: frameW });
  if (xAxisTitle) bottomH += 14;
  if (reserveXTitleEarly) bottomH += (wrapXTitle(xAxisTitle).length - 1) * AXIS_TITLE_LINE_H;

  // Chart region. `contentHeight` is the height occupied by the chart/figure body below
  // `chartTop`; a figure or a single horizontal bar/stacked/dumbbell chart can extend past the
  // fixed frame, everything else fills it.
  let contentHeight: number;
  // How far below `chartTop` the plot sits: nonzero only beside a taller right-hand legend column.
  let plotOffset = 0;
  if (!isFigure) {
    // Single chart: horizontal bar/stacked/dumbbell charts size from the shared intrinsic-height
    // helper (growing the export frame with row count); everything else fills the fixed 750 frame.
    // A framed treemap is capped by the frame's remaining height rather than the default 460px. The
    // SAME cap goes to renderChart below (treemapMaxHeight), so the tiles and their labels are laid
    // out in exactly the region reserved here.
    const treemapCap = isTreemap && frame ? Math.max(MIN_CHART_H, FH - chartTop - bottomH) : undefined;
    // `fitRows`: a row-sized chart taller than the room the frame leaves it compresses its row pitch
    // to fit, down to a legible floor (horizontalBarChartHeight's `maxHeight`). The room may be
    // fractional (chartTop can be), so a fitted chart lands on the frame height exactly.
    const rowsCap = rowSized && frame?.fitRows === true ? FH - chartTop - bottomH : undefined;
    contentHeight = rowSized
      ? horizontalBarChartHeight(spec, rows, rowsCap !== undefined ? { maxHeight: rowsCap } : {})
      : isTimeline
        ? timelineHeight(spec, rows, chartW, undefined, tlFrame?.budgetWidth)
        : isTreemap
          // Whole pixels: a fractional height would leave a sub-pixel gap or clip in the frame.
          ? Math.ceil(treemapHeight(chartW, treemapCap))
          : Math.max(MIN_CHART_H, FH - chartTop - bottomH);
    // The plot's own height. A right-hand legend never changes it: the live card keeps
    // computeChartHeight's height beside a taller legend column, so stretching the plot here moved
    // every row of the download away from the page (Ruling 71).
    const plotHeight = contentHeight;
    // A right-hand legend column is laid out beside the plot but is NOT bounded by it: enough
    // series, or enough wrapped labels, and it runs past the plot's bottom — over the x-axis
    // title, note and source, and then off the frame. Measure it first (same routine that draws
    // it, so the two cannot drift) and let the chart REGION be at least that tall, with the plot
    // centred in it as live centres it (below); `H_eff` grows the frame to match. Nothing published
    // takes this path today, so the arithmetic is here to keep a future many-series chart honest
    // rather than to fix a current figure.
    const colItems = rightLegend
      ? orderForRightLegend(legendItems, (meta as { legendVisualOrder?: string[] }).legendVisualOrder)
      : [];
    const shapeColItems: LegendItem[] = rightLegend && hasShapeLegend
      ? (shapeLegendItems.map((s) => ({
          label: s.label,
          color: SHAPE_LEGEND_COLOR,
          dashed: false,
          markerShape: "point" as const,
          markerSymbol: s.markerSymbol,
        })) as unknown as LegendItem[])
      : [];
    // One cache across BOTH passes, so a `legendKey` hook is invoked once per row rather than once
    // to measure and again to draw. A group heading only means something when there are two groups
    // AND rows above it, so an empty colour group takes none.
    const legendKeyCache = new Map<LegendItem, string | null>();
    const colTitle = hasShapeLegend && colItems.length ? colorLegendTitle : undefined;
    let legendColumnH = 0;
    if (rightLegend) {
      const COL_TOP_PAD = 12;
      let measured = COL_TOP_PAD;
      if (colItems.length) {
        measured = drawLegendColumn(null, colItems, 0, COL_TOP_PAD, colTitle, opts.hooks, legendKeyCache);
      }
      if (shapeColItems.length) {
        measured = drawLegendColumn(
          null, shapeColItems, 0, colItems.length ? measured + 8 : COL_TOP_PAD,
          shapeLegendTitle || undefined, undefined, legendKeyCache,
        );
      }
      legendColumnH = Math.ceil(measured);
    }
    const rendered = renderChart(spec, rows, {
      width: chartW,
      height: plotHeight,
      // The download takes no host height: a row-sized chart's is horizontalBarChartHeight's.
      ...(rowSized ? { heightFromModel: true } : {}),
      ...finalPassOpts(finalInput, opts.hooks),
      ...(tlFrame?.budgetWidth !== undefined ? { timelineBudgetWidth: tlFrame.budgetWidth } : {}),
      ...(treemapCap !== undefined ? { treemapMaxHeight: treemapCap } : {}),
    });
    const chartSvg = rendered.svg;
    chartSvg.setAttribute("x", String(MARGIN));
    chartSvg.setAttribute("width", String(chartW));
    // A timeline keeps its own layout height (its `plotHeight` is only the pre-draw estimate). A
    // treemap too: its own height is the layout height, and the frame is sized to its ceiling.
    if (!isTimeline && !isTreemap) chartSvg.setAttribute("height", String(plotHeight));
    // A timeline's x-axis title follows the ticks of THIS render, at `chartW`: the metadata pass ran
    // at INNER_W, and a vertical timeline can drop its ticks at the narrower right-legend width.
    if (isTimeline) {
      const title = rendered.xAxisTitle ?? "";
      if (!title !== !xAxisTitle) bottomH += title ? 14 : -14;
      xAxisTitle = title;
    }
    // Live centres the canvas (the plot, with its x-axis title directly under it) against a taller
    // right-hand legend column: `.figure-body--legend-right { align-items: center }` in styles.ts.
    // The PNG computes the same offset; the column itself stays at the region's top, where live's
    // taller column also sits. `contentHeight` stays the region less the title's 14px band, which
    // `bottomH` already holds.
    if (rightLegend) {
      const titleBand = xAxisTitle ? 14 : 0;
      const region = Math.max(contentHeight + titleBand, legendColumnH);
      plotOffset = (region - titleBand - contentHeight) / 2;
      contentHeight = region - titleBand;
    }
    chartSvg.setAttribute("y", String(chartTop + plotOffset));
    root.appendChild(chartSvg);
    if (rightLegend) {
      // Beside the plot, ordered top-to-bottom as the stack reads (orderForRightLegend) — the same
      // ordering the live column uses. A dual-encoding chart keeps its group headings here, as the
      // top layout does, and its shape rows follow the colour rows in the same column.
      const colX = MARGIN + chartW + LEGEND_GAP;
      const COL_TOP = chartTop + 12;
      const colY = colItems.length
        ? drawLegendColumn(root, colItems, colX, COL_TOP, colTitle, opts.hooks, legendKeyCache)
        : COL_TOP;
      if (shapeColItems.length) {
        drawLegendColumn(
          root, shapeColItems, colX, colItems.length ? colY + 8 : COL_TOP,
          shapeLegendTitle || undefined, undefined, legendKeyCache,
        );
      }
    }
  } else {
    // BOTH modes are per-pane compositions: lay the N mini-SVGs into a (cols × rows) grid,
    // each with a pane-title text above it. (Shared mode forces one y-domain across panes and
    // hides the y-tick labels on non-leftmost columns inside renderFigure; the export layout is
    // otherwise identical.) Render the panes at the exact cell width so they fill their column.
    const figMeta = meta as FigureRenderResult;
    const cols = figMeta.columns;
    const gridRows = figMeta.rows;
    // A horizontal bar, stack or dumbbell is never a figure (`columns.facet` is rejected on it,
    // spec/facet-groups.ts), so every pane takes figurePaneHeight's fixed height.
    // Every pane of a figure takes this one height (row-sized chart types are never figures), so
    // fillPanes sizes all grid rows equally to fill the frame, growing or shrinking them, but never
    // below MIN_CHART_H: there the panes stop and the output comes out taller than the frame. Without
    // a frame it is a no-op.
    const paneChartH0 = figurePaneHeight(spec);
    const fillPanes = frame?.fillPanes === true;
    const isShared = (spec.small_multiples?.mode ?? "shared") === "shared";
    // SHARED mode: unequal column widths (labeled col 0 wider, label-less cols narrower) sharing
    // one inner data width — renderFigure computes them with the live grid's helper
    // (sharedColumnWidths) and reports them as fig.columnWidths, so the export matches the live look.
    // PER-PANE mode: equal columns, unless `pane_widths` splits the row (see colWidth below).
    const equalPaneW = Math.floor((FIW - COL_GAP * (cols - 1)) / cols);
    const renderAt = (paneChartH: number, hooks: RenderHooks | undefined): FigureRenderResult =>
      isShared
        ? renderFigure(spec, rows, { gridWidth: FIW, gridGap: COL_GAP, height: paneChartH, columns: cols, ...finalPassOpts(finalInput, hooks) })
        : // `width` is each equal pane's width; `gridWidth`/`gridGap` are the row a per-pane
          // `pane_widths` is split across (perPaneColumnWidths). Without pane_widths renderFigure
          // reads only `width`, so equal per-pane figures are unchanged.
          renderFigure(spec, rows, { width: equalPaneW, gridWidth: FIW, gridGap: COL_GAP, height: paneChartH, columns: cols, ...finalPassOpts(finalInput, hooks) });
    // Pane titles wrap at word boundaries to their column, as the live grid's title block does; a
    // title that fits is drawn exactly as written. A grid row's title band is as tall as its
    // tallest title, so the panes of a row stay level. The column widths are the rendered figure's,
    // which do not depend on the pane height or on the hooks.
    const titleLinesOf = (f: FigureRenderResult): string[][] =>
      f.panes.map((pane, i) => wrapPaneTitle(pane.title, f.columnWidths?.[i % cols] ?? equalPaneW));
    const fillFor = (bands: number[]): { fillAvail: number; fillH: number; fills: boolean; paneChartH: number } => {
      const fillAvail = FH - chartTop - bottomH - bands.reduce((s, h) => s + h, 0) - (gridRows - 1) * ROW_GAP;
      const fillH = Math.floor(fillAvail / gridRows);
      const fills = fillPanes && fillH >= MIN_CHART_H;
      return { fillAvail, fillH, fills, paneChartH: fills ? fillH : fillPanes ? MIN_CHART_H : paneChartH0 };
    };
    // fillPanes sizes the panes to the room the title bands leave, and the bands are known only once
    // the figure reports its column widths. So with fillPanes the first render is a layout probe at
    // the one-line bands' height, rendered with no hooks (every hook must run once, on the panes
    // returned), and the figure is rendered again only when a wrapped title changes that height or
    // there are hooks to run. Without fillPanes it renders once, with its hooks, as before.
    const hasHooks = opts.hooks != null && Object.values(opts.hooks).some((h) => h != null);
    const layoutHooks = fillPanes && hasHooks ? undefined : opts.hooks;
    const oneLineFill = fillFor(Array.from({ length: gridRows }, () => PANE_TITLE_H));
    let fig = renderAt(oneLineFill.paneChartH, layoutHooks);
    const titleLines = titleLinesOf(fig);
    const titleBands = Array.from({ length: gridRows }, (_, r) => {
      let n = 1;
      for (let c = 0; c < cols; c++) n = Math.max(n, titleLines[r * cols + c]?.length ?? 1);
      return PANE_TITLE_H + (n - 1) * PANE_TITLE_LINE_H;
    });
    const { fillAvail, fillH, fills, paneChartH } = fillFor(titleBands);
    if (paneChartH !== oneLineFill.paneChartH || layoutHooks !== opts.hooks) fig = renderAt(paneChartH, opts.hooks);
    // Flooring per row leaves up to gridRows − 1 whole pixels unfilled; renderFigure draws every pane
    // at one height, so they go to the gaps between rows, one each (at most one per gap). Only the
    // sub-pixel remainder is left, as on a one-row figure.
    const extraGapPx = fills ? Math.min(gridRows - 1, Math.max(0, Math.floor(fillAvail - gridRows * fillH))) : 0;
    const rowGapAfter = (r: number): number => ROW_GAP + (r < extraGapPx ? 1 : 0);
    // Cell width per column: the width each pane was RENDERED at. A pane's viewBox is its rendered
    // width, so a cell of any other width rescales the whole pane: with `pane_widths` the bars came
    // out a different width in every pane. renderFigure reports the widths whenever they are not
    // equal columns (shared mode always; per-pane with pane_widths).
    const colWidth = (col: number): number => fig.columnWidths?.[col] ?? equalPaneW;
    // Cumulative left x per column (panes tile the row exactly, leaving COL_GAP between them).
    const colX: number[] = [];
    let acc = MARGIN;
    for (let c = 0; c < cols; c++) {
      colX.push(acc);
      acc += colWidth(c) + COL_GAP;
    }
    // Per-pane height: each pane's own rendered height (always set by renderFigure, to paneChartH).
    const paneH = (i: number): number =>
      Number((fig.panes[i]?.svg as SVGSVGElement | undefined)?.getAttribute("height")) || paneChartH;
    // Each grid ROW's height = the tallest pane in that row (every pane is paneChartH tall).
    const rowHeights: number[] = [];
    for (let r = 0; r < gridRows; r++) {
      let h = 0;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i < fig.panes.length) h = Math.max(h, paneH(i));
      }
      rowHeights.push(h);
    }
    // Cumulative top y for each row (title band + row height + gap between rows).
    const rowY: number[] = [];
    {
      let acc = chartTop;
      for (let r = 0; r < gridRows; r++) {
        rowY.push(acc);
        acc += titleBands[r]! + rowHeights[r]! + rowGapAfter(r);
      }
    }
    fig.panes.forEach((pane, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = colX[col]!;
      const w = colWidth(col);
      const y = rowY[row]!;
      const h = paneH(i);
      drawLines(root, titleLines[i]!, x, y + 12, PANE_TITLE_LINE_H, { size: 11, weight: W_SEMI, fill: HEADING });
      if (pane.svg) {
        const ps = pane.svg;
        ps.setAttribute("x", String(x));
        ps.setAttribute("y", String(y + titleBands[row]!));
        ps.setAttribute("width", String(w));
        ps.setAttribute("height", String(h));
        root.appendChild(ps);
      }
    });
    contentHeight = rowHeights.reduce((s, h, r) => s + titleBands[r]! + h, 0) + (gridRows - 1) * ROW_GAP + extraGapPx;
  }

  // Figures size to their CONTENT height (chrome + the pane grid), so a short figure (e.g. a
  // single row of panes) doesn't leave a big band of whitespace below. Single horizontal bar/
  // stacked/dumbbell charts do the same (their row count can outgrow the 750 frame); every other single
  // chart keeps the fixed 4:3 frame.
  // A right-hand legend taller than the plot grows the frame too, for the same reason a
  // horizontal bar chart does: the content genuinely needs the room, and clipping it would
  // silently drop legend rows from the download.
  // The wrapped x-axis title (wrapXTitle, above): a portrait frame's or a framed timeline's extra
  // lines are reserved here; a framed chart's were reserved before its height was chosen.
  const xAxisLines = wrapXTitle(xAxisTitle);
  if (wrapsXTitle && !reserveXTitleEarly) bottomH += (xAxisLines.length - 1) * AXIS_TITLE_LINE_H;
  const H_eff =
    isFigure || rowSized || isTimeline || isTreemap || chartTop + contentHeight + bottomH > FH
      ? Math.round(chartTop + contentHeight + bottomH)
      : FH;
  if (H_eff !== FH) {
    root.setAttribute("height", String(H_eff));
    bgRect.setAttribute("height", String(H_eff));
  }

  // --- bottom chrome: x-axis title (chart-specific), note, source ---
  let by = chartTop + contentHeight;
  if (xAxisTitle) {
    by += 14;
    // Centred on the PLOT, not the frame: a right-hand legend takes 176px off the right, so the
    // frame's centre is 88px right of the plot's and the title sat visibly off-axis. Directly under
    // the plot, so `plotOffset` above the region's bottom beside a taller legend column.
    const titleX = rightLegend ? MARGIN + chartW / 2 : frameW / 2;
    by = plotOffset + drawLines(root, xAxisLines, titleX, by - plotOffset, AXIS_TITLE_LINE_H, { size: 12, weight: W_SEMI, fill: AXIS, anchor: "middle" });
  }
  composeBottomChrome(document, root, by, { note, source, width: frameW });

  return root;
}

// ---------------------------------------------------------------------------
// rasterize + download
// ---------------------------------------------------------------------------

export async function rasterize(
  svgElement: SVGSVGElement,
  width: number,
  height: number,
): Promise<Blob> {
  const svgStr = new XMLSerializer().serializeToString(svgElement);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG image failed to load"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * SCALE);
    canvas.height = Math.round(height * SCALE);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context");
    ctx.scale(SCALE, SCALE);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Export the chart as a 2x-scale PNG download.
 * Builds the publishable export SVG, rasterizes it on an offscreen canvas,
 * and triggers a browser download.
 */
export async function exportChartPng(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: { filename?: string; selections?: Record<string, string>; hooks?: RenderHooks } = {},
): Promise<void> {
  const svgElement = buildExportSvg(spec, rows, { selections: opts.selections, hooks: opts.hooks });
  const width = parseInt(svgElement.getAttribute("width") ?? String(W), 10);
  const height = parseInt(svgElement.getAttribute("height") ?? String(H), 10);
  const blob = await rasterize(svgElement, width, height);
  // Fallback filename slug: resolve title-selector tokens (defaults) before slugifying, so the
  // name reads "…-by-sector" rather than the token key. Braces themselves could never survive
  // the non-alphanumeric strip either way.
  const filename =
    opts.filename ??
    (spec.title
      ? resolveTitleText(spec)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") + ".png"
      : "chart.png");
  triggerDownload(blob, filename);
}
