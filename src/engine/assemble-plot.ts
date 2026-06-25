// assemblePlot: the generic, chart-type-agnostic step. Takes a chart type's mark
// layers plus the computed axes and assembles the full Plot in the correct paint
// order — band underlay → gridlines → x-axis → zero baseline → reference markers →
// line overlay — then returns the SVG with margin metadata stamped on for the
// crosshair/overlay layers to read.
import { Plot } from "./vendor";
import { TBL, TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT } from "./theme";
import { tblPlotDefaults, gridAndYLabels, paneTitleMark } from "./axes";
import type { PaneTitleCell } from "./axes";
import {
  collapseFacetChrome,
  collapseFacetChromeY,
  collapseFacetGridChrome,
  GRIDLINE_CLASS,
  ZERO_BASELINE_CLASS,
  X_TICK_LABEL_CLASS,
  X_AXIS_LABEL_CLASS,
  ANNOTATION_LINE_CLASS,
} from "./facet-chrome";
import { makeTickFormatter } from "./scales";
import { tblColorScale, resolveColor } from "./palette";
import type { ChartSpec } from "../spec/types";
import type { XOpts } from "./x-adapter";
import type { MarkLayers } from "./marks/index";

// A fixed class name makes Plot's generated class + clip-path ids deterministic, so
// repeated renders are byte-identical (the golden-SVG locking gate depends on this).
// When a pane suffix is supplied (multi-pane figures), append it so each pane's Plot
// class + clip-path ids are unique-but-deterministic; absent → exactly "tblchart".
const PLOT_CLASS = "tblchart";

export interface AssembleOptions {
  layers: MarkLayers;
  yDomain: [number, number];
  yTicks: number[];
  units: string;
  xOpts: XOpts;
  seriesNames: string[];
  colors: Map<string, string>;
  spec: ChartSpec;
  width?: number;
  height?: number;
  marginRight?: number;
  /** Headless rendering: the document Plot should build into (jsdom in tests). */
  document?: Document;
  /** Optional pane suffix: when set, the Plot className becomes `tblchart-${suffix}`,
   *  giving each pane in a multi-pane figure unique-but-deterministic clip-path ids.
   *  Absent → className stays exactly "tblchart" (byte-identical single-chart output). */
  classNameSuffix?: string;
  /** Shared-mode small multiples: override the plot's LEFT margin (default TBL_MARGIN_LEFT).
   *  Applied to tblPlotDefaults marginLeft, the gridline insetLeft / y-label dx (gridAndYLabels),
   *  and the zero-baseline insetLeft so the plot area, gridlines and (when shown) labels all use
   *  the same margin. The leftmost (labeled) pane passes TBL_MARGIN_LEFT (=default); label-less
   *  columns pass a small margin so they don't reserve the label gutter. Absent → TBL_MARGIN_LEFT
   *  (byte-identical single-chart + per-pane output). Vertical (line) charts only — shared mode is
   *  line-only, so this never collides with the horizontal-bar `layers.marginLeft` gutter. */
  marginLeft?: number;
  /** Optional SHARED-mode small-multiples faceting. When present, assemblePlot builds ONE
   *  Plot with a 2-D facet grid (`fx` = columns, `fy` = rows) sharing the single `yDomain`,
   *  then collapses the repeated per-facet chrome to the Style-Guide grid look (y-tick
   *  labels on the leftmost column only, x-axis labels on the bottom row only, per-pane
   *  gridlines + pane titles kept). Absent → behavior is EXACTLY as today (single frame).
   *
   *  The layer's marks must already carry `fx`/`fy` channels bound to the per-row grid-index
   *  fields (`fx: "_fxCol"`, `fy: "_fyRow"` — String column/row indices the orchestrator adds
   *  to each data row). assemblePlot drives Plot's `fx`/`fy` scale domains from `columns`/
   *  `rows` so cell order is deterministic, adds one pane title per cell, and collapses the
   *  repeated chrome. */
  facet?: FacetOptions;
  /** Shared-mode small multiples, non-leftmost columns: emit the y gridlines (so the plot
   *  area stays aligned with the left column) but SKIP the y-tick label text marks. The left
   *  margin is unchanged so every pane is the same width. Default/absent → labels emitted
   *  (byte-identical single-chart + leftmost-pane output). Ignored for horizontal bars (their
   *  value axis runs along x). */
  hideYAxisLabels?: boolean;
}

export interface FacetOptions {
  /** Grid columns. Plot `fx` domain becomes ["0".."columns-1"]. */
  columns: number;
  /** Grid rows. Plot `fy` domain becomes ["0".."rows-1"]. */
  rows: number;
  /** One entry per pane: its (col,row) cell + display title. Drives the per-cell pane titles
   *  (and documents the orchestrator's `_fxCol`/`_fyRow` assignment). */
  cells: PaneTitleCell[];
}

export function assemblePlot({
  layers,
  yDomain,
  yTicks,
  units,
  xOpts,
  seriesNames,
  colors,
  spec,
  width,
  height,
  marginRight,
  document,
  classNameSuffix,
  marginLeft,
  facet,
  hideYAxisLabels,
}: AssembleOptions): SVGSVGElement {
  const effMarginRight = marginRight ?? TBL_MARGIN_RIGHT;
  // Shared-mode small multiples override the left margin; absent → default TBL_MARGIN_LEFT.
  // Used for the plot defaults, the gridline insetLeft / y-label dx, and the zero-baseline.
  const effMarginLeft = marginLeft ?? TBL_MARGIN_LEFT;
  // SHARED-mode small-multiples grid: a 2-D fx×fy facet sharing the single yDomain. The
  // layer's marks already carry fx/fy channels; here we drive the fx/fy scale domains and
  // (after render) collapse the repeated per-facet chrome to the grid look.
  const gridFaceted = facet != null;

  // Grid faceting (fx/fy small-multiples) of GROUPED bars is a later task (B8): a grouped-bar
  // layer ALSO claims `fx` (its category group scale) and supplies `fxScaleOpts`, which would
  // collide with the grid's own `fx` column scale — Plot would render into the wrong/empty
  // cells and the chrome-collapse `else-if` chain (which prefers the `faceted` branch when
  // `xScaleField === "fx"`) would skip `collapseFacetGridChrome` entirely. Rather than render
  // silently-wrong output, fail loud until B8 implements it properly.
  if (gridFaceted && (layers.xScaleField === "fx" || layers.fxScaleOpts != null)) {
    throw new Error(
      "grid faceting of grouped-bar charts is not yet supported (the grouped-bar `fx` " +
        "category scale collides with the grid `fx` column scale; planned for task B8)",
    );
  }

  const marks: unknown[] = [];
  // Horizontal bars (layer owns the y band scale): the value axis runs along x, so the
  // chrome flips — vertical gridlines + x value-tick labels + a vertical zero baseline,
  // and the layer supplies its own category labels on the y band via xAxisMarks.
  const horizontal = layers.yScaleOpts != null;
  // Faceted (vertical grouped bars): categories live on the `fx` group scale, so Plot
  // repeats the chrome per facet. We tag the chrome marks with findable classNames ONLY in
  // this case so the post-render collapse pass can find them; non-faceted output stays
  // byte-identical (Plot omits the class attribute entirely when className is undefined).
  const faceted = layers.xScaleField === "fx";
  // Faceted HORIZONTAL grouped bars: categories live on the `fy` row-facet scale, so Plot
  // repeats the VALUE chrome (vertical gridlines + value-tick labels + vertical zero rule)
  // per row facet. Same className-tagging discipline; collapsed by collapseFacetChromeY.
  const fyFaceted = layers.fyScaleOpts != null;

  // 0. Shaded x-bands (e.g. recession indicators): vertical regions painted at the very back,
  //    behind gridlines + data. Spans the full y-domain; x edges parsed via the adapter (numeric
  //    / temporal only — markerToX returns null for a categorical band scale).
  for (const band of spec.xAxisPolicy?.bands ?? []) {
    const x1 = xOpts.markerToX({ x: band.start });
    const x2 = xOpts.markerToX({ x: band.end });
    if (x1 == null || x2 == null) continue;
    marks.push(
      Plot.rect([{ x1, x2, y1: yDomain[0], y2: yDomain[1] }], {
        x1: "x1",
        x2: "x2",
        y1: "y1",
        y2: "y2",
        fill: band.color || TBL.color.annotationDim,
        fillOpacity: 0.1,
      }),
    );
  }

  // 1. Band underlay (behind everything).
  marks.push(...layers.underlay);

  if (horizontal) {
    // 2h. Vertical gridlines + x value-tick labels (skip 0 from the light grid; baseline
    //     is painted darker below).
    const xTickFmt = makeTickFormatter(yTicks, units);
    marks.push(
      Plot.ruleX(
        yTicks.filter((t) => t !== 0),
        {
          stroke: TBL.color.gridline,
          strokeWidth: 1,
          // Faceted (fy): tag so the collapse pass can find + stretch the per-facet copies.
          ...(fyFaceted ? { className: GRIDLINE_CLASS } : {}),
        },
      ),
      Plot.text(yTicks, {
        x: (d: number) => d,
        text: xTickFmt,
        frameAnchor: "bottom",
        dy: 12,
        textAnchor: "middle",
        fill: TBL.color.axis,
        fontSize: TBL.size.axis,
        fontWeight: 500,
        ...(fyFaceted ? { className: X_TICK_LABEL_CLASS } : {}),
      }),
    );
    // 3h. Category labels (single-stack: y band; grouped: fy group facets) — layer-supplied.
    marks.push(...(layers.xAxisMarks ?? []));
    // 4h. Vertical zero baseline.
    marks.push(
      Plot.ruleX([0], {
        stroke: TBL.color.axisStroke,
        strokeWidth: 1,
        ...(fyFaceted ? { className: ZERO_BASELINE_CLASS } : {}),
      }),
    );
  } else {
    // 2. Gridlines + y-tick labels. 3. X-axis. (extend across both label columns so the
    //    chart edges sit flush with the canvas.)
    marks.push(
      ...gridAndYLabels(yTicks, {
        yTickFormat: makeTickFormatter(yTicks, units),
        marginLeft: effMarginLeft,
        marginRight: effMarginRight,
        ...(faceted ? { gridlineClassName: GRIDLINE_CLASS } : {}),
        // Shared-mode small multiples, non-leftmost panes: keep gridlines, drop the y-tick
        // label text so only the left column shows values (left margin stays for alignment).
        ...(hideYAxisLabels ? { hideYLabels: true } : {}),
      }),
    );
    // X-axis labels: a mark layer that re-homes the category band (grouped bars label the
    // `fx` group scale) supplies its own axis marks; use those instead of the adapter's.
    marks.push(...(layers.xAxisMarks ?? xOpts.axisMarks));

    // 4. Zero baseline (darker rule painted over the light gridlines) — ONLY when 0 is within
    //    the y-domain. Drawing it for a domain that excludes 0 (e.g. an index/percent range
    //    starting at 1%) leaves a stray dark rule (most visible per-pane in small multiples).
    if (yDomain[0] <= 0 && yDomain[1] >= 0) {
      marks.push(
        Plot.ruleY([0], {
          stroke: TBL.color.axisStroke,
          strokeWidth: 1,
          insetLeft: -effMarginLeft,
          insetRight: -effMarginRight,
          clip: false,
          // className tags the wrapping <g> so the facet-chrome collapse pass can find the
          // per-facet zero-baseline copies — faceted charts only, so non-faceted output is
          // byte-identical.
          ...(faceted ? { className: ZERO_BASELINE_CLASS } : {}),
        }),
      );
    }
  }

  // 5. Reference markers (vertical rules, e.g. a treatment date).
  for (const m of spec.xAxisPolicy?.markers ?? []) {
    const mx = xOpts.markerToX(m);
    if (mx == null) continue;
    marks.push(
      Plot.ruleX([mx], {
        stroke: m.color || TBL.color.annotationDim,
        strokeDasharray: (m.style || "dashed") === "dashed" ? "3 2" : null,
        strokeWidth: m.strokeWidth || 1,
      }),
    );
  }

  // 6. Line overlay (on top).
  marks.push(...layers.overlay);

  // 6b. Horizontal reference lines (yAxisPolicy.markers): drawn over the data, each with an
  //     optional label. By DEFAULT lines + matched labels take categorical colors starting at
  //     amber (skipping the blue cat-1 slot, which data series usually use); an explicit
  //     marker.color overrides. The label color always matches its line.
  const markerList = spec.yAxisPolicy?.markers ?? [];
  // +1 so index 0 (blue) is skipped → markers start at amber, then violet, green, …
  const markerPalette = tblColorScale(markerList.length + 1);
  markerList.forEach((m, i) => {
    const markerColor = (m.color && (resolveColor(m.color) || m.color)) || markerPalette[i + 1] || TBL.color.annotationDim;
    marks.push(
      Plot.ruleY([m.y], {
        stroke: markerColor,
        strokeOpacity: 0.8,
        strokeDasharray: (m.style || "dashed") === "dashed" ? "4 3" : null,
        strokeWidth: m.strokeWidth || 1.25,
        insetLeft: -effMarginLeft,
        insetRight: -effMarginRight,
        clip: false,
        // Findable per-marker class so the fx-facet collapse can stretch the line to the full
        // plot width (otherwise a grouped/faceted bar repeats it per facet, stopping at each
        // facet's edge instead of running edge-to-edge like a line chart).
        className: `${ANNOTATION_LINE_CLASS}-${i}`,
      }),
    );
    if (m.label) {
      // On an fx-faceted chart (grouped bars), an unfaceted mark repeats in every facet — bind
      // the label to the appropriate end fx category so a single label renders once.
      const fxDomain = faceted ? (layers.fxScaleOpts?.domain as string[] | undefined) : undefined;
      const left = m.labelSide === "left";
      const labelFx =
        fxDomain && fxDomain.length ? (left ? fxDomain[0] : fxDomain[fxDomain.length - 1]) : undefined;
      marks.push(
        Plot.text([{ y: m.y, t: m.label, ...(labelFx != null ? { fx: labelFx } : {}) }], {
          y: "y",
          text: "t",
          ...(labelFx != null ? { fx: "fx" } : {}),
          frameAnchor: left ? "left" : "right",
          textAnchor: left ? "start" : "end",
          dx: m.labelDx != null ? m.labelDx : left ? 6 : -6,
          dy: m.labelDy != null ? m.labelDy : -7,
          fill: markerColor,
          fontSize: TBL.size.annotation,
          fontWeight: 600,
        }),
      );
    }
  });

  // 7. Pane titles (shared-mode small-multiples grid only): one per facet cell at the pane's
  //    top-left. The mark facets on both fx (=String(col)) and fy (=String(row)) so each
  //    title lands in its own (col,row) cell.
  if (gridFaceted && facet) {
    marks.push(...paneTitleMark(facet.cells));
  }

  const plotOpts: Record<string, unknown> = {
    ...tblPlotDefaults({
      marginBottom: xOpts.marginBottom,
      ...(height != null ? { height } : {}),
      ...(marginRight != null ? { marginRight } : {}),
      // Horizontal bars supply a responsive left gutter sized to their longest category
      // label (axes.horizontalLeftGutter); vertical charts leave it undefined → default. The
      // shared-mode small-multiples `marginLeft` override wins when present (the label-less
      // columns' small gutter); it applies to vertical panes (line/bar/stacked) — horizontal
      // bars carry a category gutter and aren't used in shared mode.
      ...(marginLeft != null
        ? { marginLeft }
        : layers.marginLeft != null
          ? { marginLeft: layers.marginLeft }
          : {}),
    }),
    ...(width ? { width } : {}),
    className: classNameSuffix ? `${PLOT_CLASS}-${classNameSuffix}` : PLOT_CLASS,
    // Vertical: y carries the value domain. Horizontal: the value domain moves to x and
    // the layer supplies a band y (yScaleOpts).
    y: horizontal
      ? { label: null, axis: null, grid: false, ...(layers.yScaleOpts ?? {}) }
      : { label: null, axis: null, grid: false, domain: yDomain },
    color: { domain: seriesNames, range: seriesNames.map((s) => colors.get(s)) },
    marks,
  };
  if (horizontal) {
    // x is the value (linear) axis; merge any layer x opts (none needed today) over the
    // computed value domain.
    plotOpts.x = { label: null, axis: null, grid: false, domain: yDomain, ...(layers.xScaleOpts ?? {}) };
  } else if (layers.xScaleOpts) {
    // X-scale opts: adapter supplies the base; a mark layer that owns the x-scale (bars)
    // merges over it (mark-layer wins on conflict). Line leaves xScaleOpts undefined, so
    // the original `plotOpts.x = xOpts.xPlotOpts` path is taken unchanged.
    plotOpts.x = { ...(xOpts.xPlotOpts ?? {}), ...layers.xScaleOpts };
  } else if (xOpts.xPlotOpts) {
    plotOpts.x = xOpts.xPlotOpts;
  }
  if (layers.fxScaleOpts) plotOpts.fx = layers.fxScaleOpts;
  if (layers.fyScaleOpts) plotOpts.fy = layers.fyScaleOpts;
  // Per-series marker symbols (line point markers). axis:null suppresses Plot's symbol legend
  // (the engine renders its own legend).
  if (layers.symbolScaleOpts) plotOpts.symbol = { ...layers.symbolScaleOpts, axis: null };
  // Shared-mode grid: drive the fx (columns) + fy (rows) facet scales from the layout. The
  // domains are the String column/row indices the marks reference; explicit so cell order is
  // deterministic. axis:null suppresses Plot's native facet-axis chrome (we supply our own
  // pane titles + collapsed engine chrome).
  if (gridFaceted && facet) {
    // paddingInner separates the panes so each (col,row) cell reads as a DISTINCT small
    // multiple sharing one y-scale — without a vertical gap the two stacked rows of a column
    // run together and look like a single tall chart with a doubled axis. Rows need a larger
    // gap (the shared y-axis repeats per row, so the boundary must be unmistakable).
    plotOpts.fx = {
      domain: Array.from({ length: facet.columns }, (_, i) => String(i)),
      axis: null,
      paddingInner: 0.08,
    };
    plotOpts.fy = {
      domain: Array.from({ length: facet.rows }, (_, i) => String(i)),
      axis: null,
      paddingInner: 0.22,
    };
  }
  if (document) plotOpts.document = document;

  const svg = Plot.plot(plotOpts) as SVGSVGElement;
  svg.dataset.marginLeft = String((plotOpts.marginLeft as number) ?? 0);
  svg.dataset.marginRight = String((plotOpts.marginRight as number) ?? 8);
  svg.dataset.marginTop = String((plotOpts.marginTop as number) ?? 18);
  svg.dataset.marginBottom = String((plotOpts.marginBottom as number) ?? 28);

  // Facet-aware chrome collapse: when the layer faceted the categories onto `fx` (grouped
  // bars), Plot repeated the gridlines / zero baseline / y-tick labels inside every facet.
  // Collapse them to continuous full-width gridlines + one left y-axis. No-op for all other
  // chart types (the pass only fires when xScaleField === "fx").
  if (faceted) {
    // Read width from the rendered SVG so the right plot edge is correct regardless of
    // whether an explicit width was passed (Plot defaults it otherwise).
    const svgWidth = Number(svg.getAttribute("width")) || (plotOpts.width as number) || 640;
    collapseFacetChrome(svg, { width: svgWidth });
  } else if (fyFaceted) {
    // Horizontal grouped: collapse the per-row-facet value chrome to continuous full-height
    // vertical gridlines + one value-axis tick-label row at the bottom.
    const svgHeight =
      Number(svg.getAttribute("height")) || (plotOpts.height as number) || 400;
    collapseFacetChromeY(svg, {
      height: svgHeight,
      marginTop: (plotOpts.marginTop as number) ?? 18,
      marginBottom: (plotOpts.marginBottom as number) ?? 24,
    });
  } else if (gridFaceted) {
    // Shared-mode small-multiples grid: Plot repeated the y-tick labels in every column and
    // the x-axis labels in every row. Keep the leftmost column's y-labels + the bottom row's
    // x-labels; drop the duplicates. Per-pane gridlines + pane titles are kept (correct).
    collapseFacetGridChrome(svg);
  }

  // Tag data-series for legend hover-dim. Each mark layer declares a selector + the series
  // order its matched elements appear in (DOM order); tag by index. For lines this is the
  // flat dashed-then-solid path order, matching the old per-group loop byte-for-byte.
  for (const { selector, seriesOrder, shapeOrder, categoryOrder } of layers.tagging) {
    svg.querySelectorAll(selector).forEach((el, i) => {
      if (i < seriesOrder.length) el.setAttribute("data-series", seriesOrder[i] as string);
      if (shapeOrder && i < shapeOrder.length) el.setAttribute("data-shape", shapeOrder[i] as string);
      if (categoryOrder && i < categoryOrder.length) el.setAttribute("data-category", categoryOrder[i] as string);
    });
  }

  return svg;
}
