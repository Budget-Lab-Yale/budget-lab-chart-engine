// assemblePlot: the generic, chart-type-agnostic step. Takes a chart type's mark
// layers plus the computed axes and assembles the full Plot in the correct paint
// order — band underlay → gridlines → x-axis → zero baseline → reference markers →
// line overlay — then returns the SVG with margin metadata stamped on for the
// crosshair/overlay layers to read.
import { Plot } from "./vendor";
import { TBL, TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, TBL_MARGIN_TOP } from "./theme";
import { tblPlotDefaults, gridAndYLabels, paneTitleMark } from "./axes";
import type { PaneTitleCell } from "./axes";
import {
  collapseFacetChrome,
  collapseFacetChromeY,
  collapseFacetGridChrome,
  GRIDLINE_CLASS,
  ZERO_BASELINE_CLASS,
  X_TICK_LABEL_CLASS,
  X_TICK_LABEL_TOP_CLASS,
  X_AXIS_LABEL_CLASS,
  ANNOTATION_LINE_CLASS,
  X_ANNOTATION_LINE_CLASS,
} from "./facet-chrome";
import { makeTickFormatter } from "./scales";
import { tblColorScale, resolveColor } from "./palette";
import { resolveAnnotations, filterAnnotationsByFacet, substituteValueToken } from "../spec/annotations";
import type { ChartSpec, PointCallout, XAxisMarker } from "../spec/types";
import type { XOpts } from "./x-adapter";
import type { MarkLayers } from "./marks/index";

// A fixed class name makes Plot's generated class + clip-path ids deterministic, so
// repeated renders are byte-identical (the golden-SVG locking gate depends on this).
// When a pane suffix is supplied (multi-pane figures), append it so each pane's Plot
// class + clip-path ids are unique-but-deterministic; absent → exactly "tblchart".
const PLOT_CLASS = "tblchart";

// A subtle white halo behind annotation text (paint-order: stroke → the white stroke paints
// behind the fill) so labels stay legible over annotation lines, bands, and dense data.
const LABEL_HALO = { stroke: "#FFFFFF", strokeWidth: 3, paintOrder: "stroke" } as const;

export interface AssembleOptions {
  layers: MarkLayers;
  yDomain: [number, number];
  yTicks: number[];
  units: string;
  xOpts: XOpts;
  seriesNames: string[];
  colors: Map<string, string>;
  spec: ChartSpec;
  /** Point callouts with any series-snap `y` already resolved (index.ts has the data). When
   *  present, used instead of spec.annotations.points so the snap values render. */
  points?: PointCallout[];
  /** Numeric extent [min,max] of the parsed x values (ms for dates) — used to estimate label px
   *  positions for annotation-label collision avoidance. Absent → no auto-stagger. */
  xExtent?: [number, number];
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
  /** Small multiples: this pane's facet value — scopes `annotations.xAxis`/`yAxis` markers that
   *  carry a `facet` key to this pane only (see `filterAnnotationsByFacet`). Absent (single
   *  chart, or a faceted call that omits it) → every marker renders, unchanged from today. */
  paneFacetValue?: string;
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
  points,
  xExtent,
  width,
  height,
  marginRight,
  document,
  classNameSuffix,
  marginLeft,
  facet,
  hideYAxisLabels,
  paneFacetValue,
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
  // Annotation LABEL text marks are collected here and pushed LAST (after every band rect, gridline,
  // axis rule, data overlay and reference line), because Plot paints in array order — a line pushed
  // after a label would paint over it, and the white halo can't rescue text drawn under a later
  // stroke. "All lines/rects, then all annotation text" keeps every label legible.
  const labelMarks: unknown[] = [];
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
  // Small multiples: scope xAxis/yAxis markers with a `facet` key to THIS pane (bands/points pass
  // through unaffected). Undefined paneFacetValue (single chart) returns the resolved set
  // unchanged, so non-faceted output stays byte-identical.
  const ann = filterAnnotationsByFacet(resolveAnnotations(spec), paneFacetValue);

  // Substitute a `{value}` token in yAxis/xAxis/points labels with the annotation's own
  // coordinate value (per-annotation `value_format`, else the chart's y-tick format) BEFORE
  // anything below reads `.label` — both the auto-stagger geometry (which estimates label px
  // width from `label.length`) and the drawn text must see the SAME (substituted) string, or
  // the stagger would size its collision boxes from the short literal token instead of the
  // (usually longer) rendered number. Labels without the token are returned unchanged, so
  // charts that don't use it get byte-identical output.
  const yTickFallbackFmt = makeTickFormatter(yTicks, units);
  const yAxisAnn = ann.yAxis.map((m) =>
    m.label ? { ...m, label: substituteValueToken(m.label, m.y, m.value_format, yTickFallbackFmt) } : m,
  );
  const xAxisAnn = ann.xAxis.map((m) => {
    if (!m.label) return m;
    const xNum = Number(m.x);
    // Numerically formatted only when value_format is given AND x parses as a number;
    // otherwise the raw x string is substituted (dates/quarters/categories, or no format).
    const fmt = m.value_format != null && Number.isFinite(xNum) ? m.value_format : undefined;
    return { ...m, label: substituteValueToken(m.label, xNum, fmt, () => m.x) };
  });
  const pointsAnn = (points ?? ann.points).map((p) =>
    Number.isFinite(p.y as number)
      ? { ...p, label: substituteValueToken(p.label, p.y as number, p.value_format, yTickFallbackFmt) }
      : p,
  );

  // Auto-stagger for top-anchored annotation labels (vertical-marker + band labels): estimate each
  // label's px position/width and greedily push overlapping labels onto stacked rows so they don't
  // collide. Deterministic (no layout/getBBox), so it applies uniformly to live HTML, PNG, and SSR.
  // A marker with an explicit labelDy opts out (manual placement wins); bands are always auto.
  const LABEL_BASE_DY = 4;
  const LABEL_ROW_H = 13;
  const LABEL_GAP = 6;
  const LABEL_CHAR_PX = 6.2; // ~annotation font advance
  const staggerDy = new Map<string, number>();
  if (xExtent && xExtent[1] > xExtent[0] && width != null) {
    const innerW = width - effMarginLeft - effMarginRight;
    const toPx = (v: number | Date | null): number | null => {
      if (v == null) return null;
      const n = typeof v === "number" ? v : v.getTime();
      return effMarginLeft + ((n - xExtent[0]) / (xExtent[1] - xExtent[0])) * innerW;
    };
    type Iv = [number, number];
    // Two labels in the same stagger row collide when their px spans come within LABEL_GAP.
    const hit = (a: Iv, b: Iv): boolean => a[0] < b[1] + LABEL_GAP && b[0] < a[1] + LABEL_GAP;
    // Per-row occupied x-spans. Seeded FIRST with the y-axis reference-line labels: those sit at a
    // fixed data-y (they can't move), so the top-anchored x-marker / band labels flow AROUND them,
    // dropping to a lower row when they would otherwise overlap — e.g. a right-edge "Section 122
    // expiry" x-marker vs. a near-top right-anchored "Assumed ceiling" y-marker at the same corner.
    const rowsOcc: Iv[][] = [];
    const reserve = (row: number, iv: Iv): void => {
      while (rowsOcc.length <= row) rowsOcc.push([]);
      rowsOcc[row]!.push(iv);
    };
    // Vertical scale (needs height) → the stagger row each fixed y-marker label lands in.
    const innerHForRows = height != null ? height - TBL_MARGIN_TOP - xOpts.marginBottom : null;
    if (innerHForRows != null && innerHForRows > 0 && yDomain[1] > yDomain[0]) {
      for (const m of yAxisAnn) {
        if (!m.label) continue;
        const py = TBL_MARGIN_TOP + ((yDomain[1] - m.y) / (yDomain[1] - yDomain[0])) * innerHForRows;
        // Applied SVG dy = labelSide base (top -7 / middle 0 / bottom +6) minus labelDy (+ = UP).
        const relSide = m.labelSide ?? "top";
        const baseDy = relSide === "middle" ? 0 : relSide === "bottom" ? 6 : -7;
        const ly = py + baseDy - (m.labelDy ?? 0);
        const row = Math.max(0, Math.round((ly - TBL_MARGIN_TOP - LABEL_BASE_DY) / LABEL_ROW_H));
        const w = m.label.length * LABEL_CHAR_PX;
        const alongPos = m.labelPosition ?? "right";
        const left = alongPos === "left";
        const mid = alongPos === "middle";
        const dx = m.labelDx != null ? m.labelDx : mid ? 0 : left ? 6 : -6;
        const l = mid
          ? effMarginLeft + innerW / 2 + dx - w / 2
          : left
            ? effMarginLeft + dx
            : width - effMarginRight + dx - w;
        reserve(row, [l, l + w]);
      }
    }
    type L = { id: string; iv: Iv };
    const labels: L[] = [];
    ann.bands.forEach((b, i) => {
      if (!b.label) return;
      const px = toPx(xOpts.markerToX({ x: b.start }));
      if (px == null) return;
      const w = b.label.length * LABEL_CHAR_PX;
      labels.push({ id: `b${i}`, iv: [px + 6, px + 6 + w] });
    });
    xAxisAnn.forEach((m, i) => {
      // Only "top" labels live in the top band and auto-stagger; middle/bottom sit elsewhere.
      if (!m.label || (m.labelPosition ?? "top") !== "top") return;
      const px = toPx(xOpts.markerToX(m));
      if (px == null) return;
      const side = m.labelSide ?? "right";
      const anchor = side === "left" ? "end" : side === "middle" ? "middle" : "start";
      const dx = m.labelDx != null ? m.labelDx : anchor === "end" ? -4 : anchor === "middle" ? 0 : 4;
      const w = m.label.length * LABEL_CHAR_PX;
      const left = anchor === "end" ? px + dx - w : anchor === "middle" ? px + dx - w / 2 : px + dx;
      labels.push({ id: `m${i}`, iv: [left, left + w] });
    });
    labels.sort((a, b) => a.iv[0] - b.iv[0]);
    for (const l of labels) {
      let r = 0;
      while (rowsOcc[r]?.some((o) => hit(o, l.iv))) r++;
      reserve(r, l.iv);
      staggerDy.set(l.id, LABEL_BASE_DY + r * LABEL_ROW_H);
    }
  }

  ann.bands.forEach((band, bandIdx) => {
    const x1 = xOpts.markerToX({ x: band.start });
    const x2 = xOpts.markerToX({ x: band.end });
    if (x1 == null || x2 == null) return;
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
    if (band.label) {
      // Band label at the top of the region, just inside its left edge (auto-staggered). Deferred
      // to labelMarks so it paints over the axis rules that cross it.
      labelMarks.push(
        Plot.text([{ x: x1, y: yDomain[1], t: band.label }], {
          x: "x",
          y: "y",
          text: "t",
          frameAnchor: "top",
          textAnchor: "start",
          dx: 6,
          dy: staggerDy.get(`b${bandIdx}`) ?? 4,
          fill: TBL.color.axis,
          fontSize: TBL.size.annotation,
          fontWeight: 600,
          ...LABEL_HALO,
        }),
      );
    }
  });

  // 1. Band underlay (behind everything).
  marks.push(...layers.underlay);

  if (horizontal) {
    // 2h. Vertical gridlines + x value-tick labels (skip 0 from the light grid; baseline
    //     is painted darker below). Tick labels go at the bottom (default), top, or both.
    const xTickFmt = makeTickFormatter(yTicks, units);
    const xTicksMode = spec.x_axis_ticks ?? "bottom";
    const showBottomTicks = xTicksMode !== "top";
    const showTopTicks = xTicksMode === "top" || xTicksMode === "both";
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
    );
    if (showBottomTicks) {
      marks.push(
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
    }
    if (showTopTicks) {
      marks.push(
        Plot.text(yTicks, {
          x: (d: number) => d,
          text: xTickFmt,
          frameAnchor: "top",
          dy: -8,
          textAnchor: "middle",
          fill: TBL.color.axis,
          fontSize: TBL.size.axis,
          fontWeight: 500,
          ...(fyFaceted ? { className: X_TICK_LABEL_TOP_CLASS } : {}),
        }),
      );
    }
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

  // Shared xAxis-marker renderer: a vertical rule at `mx` (a plot x-coordinate: number, Date, or
  // — for the horizontal value-axis path below — a plain value number) + its optional label.
  // `topDy` is the SVG dy used for a "top" labelPosition (the vertical-chart caller passes the
  // auto-staggered row; the horizontal-value caller — which has no x-DATA extent to stagger
  // against — passes the fixed base offset). Used by BOTH: (a) vertical charts' treatment-line
  // markers (5, below) and (b) horizontal bars' value-axis markers (6a, below) — same color/dash
  // resolution and labelSide/labelPosition/labelDx/labelDy conventions either way.
  // `fyOpts` (grouped horizontal bars only — categories live on fy row facets, so an unfaceted
  // mark repeats per band): `ruleClassName` tags the rule so collapseFacetChromeY can keep one
  // copy + stretch it to the full plot height (same discipline as the gridlines/zero baseline),
  // and the label binds to an END fy category (chosen by labelPosition, mirroring the fx-bound
  // yAxis marker label in 6b) so it renders exactly once.
  const drawXAxisMarker = (
    mx: number | Date,
    m: XAxisMarker,
    topDy: number,
    fyOpts?: { ruleClassName: string; labelFy: string | undefined },
  ): void => {
    const mColor = (m.color && (resolveColor(m.color) || m.color)) || TBL.color.annotationDim;
    marks.push(
      Plot.ruleX([mx], {
        stroke: mColor,
        strokeDasharray: (m.style || "dashed") === "dashed" ? "3 2" : null,
        strokeWidth: m.strokeWidth || 1,
        ...(fyOpts ? { className: fyOpts.ruleClassName } : {}),
      }),
    );
    if (m.label) {
      const labelFy = fyOpts?.labelFy;
      // labelSide = which SIDE of the vertical line the label sits (its relation to the line):
      // left → left of the line, middle → centered on it, right → right of it (default).
      const side = m.labelSide ?? "right";
      const anchor = side === "left" ? "end" : side === "middle" ? "middle" : "start";
      // labelPosition places the label ALONG the vertical line, relative to the x-axis: top (top of
      // plot, auto-staggered) / middle (vertical center) / bottom (just above the x-axis). frameAnchor
      // supplies the vertical dimension (x channel keeps the horizontal). labelDy (+ = UP) nudges it.
      const pos = m.labelPosition ?? "top";
      const vAnchor = pos === "middle" ? "middle" : pos === "bottom" ? "bottom" : "top";
      // Base SVG dy (+ = down): top uses the caller's row/offset; bottom lifts up off the bottom edge.
      const baseDy = pos === "top" ? topDy : pos === "bottom" ? -6 : 0;
      const nudge = m.labelDy != null ? -m.labelDy : 0;
      labelMarks.push(
        Plot.text([{ x: mx, t: m.label, ...(labelFy != null ? { fy: labelFy } : {}) }], {
          x: "x",
          text: "t",
          ...(labelFy != null ? { fy: "fy" } : {}),
          frameAnchor: vAnchor,
          textAnchor: anchor,
          dx: m.labelDx != null ? m.labelDx : anchor === "end" ? -4 : anchor === "middle" ? 0 : 4,
          dy: baseDy + nudge,
          fill: mColor,
          fontSize: TBL.size.annotation,
          fontWeight: 600,
          ...LABEL_HALO,
        }),
      );
    }
  };

  // 5. Reference markers (vertical rules, e.g. a treatment date) + optional labels at the top.
  //    Labels auto-stagger to avoid collisions (an explicit labelDy opts out). VERTICAL charts
  //    only: `xOpts.markerToX` runs the marker's `x` through the x-axis adapter, which for
  //    horizontal bars is the CATEGORICAL y-band adapter (always returns null for a marker's raw
  //    value — it isn't one of the bar categories) — so this loop always no-op'd there anyway.
  //    Made explicit here so the horizontal VALUE-axis path (6a, below) is the only one that
  //    fires for horizontal bars.
  if (!horizontal) {
    xAxisAnn.forEach((m, markerIdx) => {
      const mx = xOpts.markerToX(m);
      if (mx == null) return;
      drawXAxisMarker(mx, m, staggerDy.get(`m${markerIdx}`) ?? 4);
    });
  }

  // 6. Line overlay (on top).
  marks.push(...layers.overlay);

  // 6a. HORIZONTAL bars: value-axis reference line(s) — a vertical rule drawn at a raw numeric
  //     `x` against the VALUE scale (which runs along x here; see `plotOpts.x` below). This is
  //     the horizontal analog of the vertical-chart marker above (reuses the same drawXAxisMarker
  //     — same color/dash resolution and label placement conventions), drawn AFTER the bars (like
  //     the yAxis "Total" reference line below does for vertical bars) so it stays visible over
  //     them. NEW capability: until now `annotations.xAxis` silently no-op'd on horizontal bars
  //     (the loop above, via the categorical y-band adapter's markerToX). Does NOT participate in
  //     the auto-stagger system above (that estimates label px from the x-DATA extent, which is
  //     meaningless on the value-axis coordinate space) — pass an explicit `labelDy` per marker to
  //     separate labels that would otherwise collide.
  if (horizontal) {
    // Grouped horizontal bars (categories on fy row facets): tag the rule per marker so the fy
    // chrome collapse keeps ONE copy stretched to the full plot height, and bind the label to the
    // fy category matching its labelPosition (top → first band, middle → middle band, bottom →
    // last band) so it renders once. Single-band horizontal charts pass no fyOpts (untagged,
    // unfaceted — byte-identical to a plain mark).
    const fyDomain = fyFaceted ? (layers.fyScaleOpts?.domain as string[] | undefined) : undefined;
    xAxisAnn.forEach((m, i) => {
      const vx = Number(m.x);
      if (!Number.isFinite(vx)) return;
      let fyOpts: { ruleClassName: string; labelFy: string | undefined } | undefined;
      if (fyFaceted) {
        const pos = m.labelPosition ?? "top";
        const labelFy =
          fyDomain && fyDomain.length
            ? pos === "bottom"
              ? fyDomain[fyDomain.length - 1]
              : pos === "middle"
                ? fyDomain[Math.floor(fyDomain.length / 2)]
                : fyDomain[0]
            : undefined;
        fyOpts = { ruleClassName: `${X_ANNOTATION_LINE_CLASS}-${i}`, labelFy };
      }
      drawXAxisMarker(vx, m, 4, fyOpts);
    });
  }

  // 6b. Horizontal reference lines (yAxisPolicy.markers): drawn over the data, each with an
  //     optional label. By DEFAULT lines + matched labels take categorical colors starting at
  //     amber (skipping the blue cat-1 slot, which data series usually use); an explicit
  //     marker.color overrides. The label color always matches its line.
  const markerList = yAxisAnn;
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
      // labelPosition = position ALONG the horizontal line: left / middle / right (default right).
      const alongPos = m.labelPosition ?? "right";
      const left = alongPos === "left";
      const mid = alongPos === "middle";
      const labelFx =
        fxDomain && fxDomain.length
          ? mid
            ? fxDomain[Math.floor(fxDomain.length / 2)]
            : left
              ? fxDomain[0]
              : fxDomain[fxDomain.length - 1]
          : undefined;
      // labelSide = which SIDE of the horizontal line (its relation to the line): top (default, sits
      // over the line) / middle (centered ON it) / bottom (under it). lineAnchor sets the vertical
      // baseline; baseDy the small gap; labelDy (+ = UP) nudges. "top" keeps the historical -7 (no
      // lineAnchor) so existing charts render byte-identically.
      const relSide = m.labelSide ?? "top";
      const lineAnchor = relSide === "middle" ? "middle" : relSide === "bottom" ? "top" : undefined;
      const baseDy = relSide === "middle" ? 0 : relSide === "bottom" ? 6 : -7;
      labelMarks.push(
        Plot.text([{ y: m.y, t: m.label, ...(labelFx != null ? { fx: labelFx } : {}) }], {
          y: "y",
          text: "t",
          ...(labelFx != null ? { fx: "fx" } : {}),
          frameAnchor: mid ? "middle" : left ? "left" : "right",
          textAnchor: mid ? "middle" : left ? "start" : "end",
          ...(lineAnchor ? { lineAnchor } : {}),
          dx: m.labelDx != null ? m.labelDx : mid ? 0 : left ? 6 : -6,
          // labelDy is + = UP → subtract it from the side's base SVG dy.
          dy: baseDy - (m.labelDy ?? 0),
          fill: markerColor,
          fontSize: TBL.size.annotation,
          fontWeight: 600,
          ...LABEL_HALO,
        }),
      );
    }
  });

  // 6c. Point callouts: a label at a data coordinate (x, y); y is explicit or resolved by index.ts
  //     (series-snap). With connector, draw a leader arrow from the label to the point — the label
  //     offset (dx/dy px) is converted to a second data coordinate via the x/y extents so the arrow
  //     lands exactly on the point. The arrowhead marks the point (no separate dot).
  const innerWForPx = width != null ? width - effMarginLeft - effMarginRight : null;
  const innerHForPx = height != null ? height - TBL_MARGIN_TOP - xOpts.marginBottom : null;
  for (const p of pointsAnn) {
    const px = xOpts.markerToX({ x: p.x });
    if (px == null || !Number.isFinite(p.y as number)) continue;
    const py = p.y as number;
    const pColor = (p.color && (resolveColor(p.color) || p.color)) || TBL.color.heading;
    // Default offset is larger when a connector is drawn, so the leader is visible. dy is + = UP,
    // so negate the user's value for SVG (defaults are already SVG-up: -6 / -28).
    const dx = p.dx != null ? p.dx : 0;
    const dy = p.dy != null ? -p.dy : p.connector ? -28 : -6;
    const anchor = dx < 0 ? "end" : dx > 0 ? "start" : "middle";
    const canLeader =
      p.connector && xExtent != null && xExtent[1] > xExtent[0] && innerWForPx != null && innerHForPx != null;
    if (canLeader) {
      // Label position in DATA space: shift the point by the px offset using the per-px data deltas.
      const dppx = (xExtent![1] - xExtent![0]) / innerWForPx!;
      const dppy = (yDomain[1] - yDomain[0]) / innerHForPx!;
      const baseN = typeof px === "number" ? px : px.getTime();
      const labelN = baseN + dx * dppx;
      const labelX = typeof px === "number" ? labelN : new Date(labelN);
      const labelY = py - dy * dppy;
      marks.push(
        Plot.arrow([{ x1: labelX, y1: labelY, x2: px, y2: py }], {
          x1: "x1",
          y1: "y1",
          x2: "x2",
          y2: "y2",
          stroke: pColor,
          strokeWidth: 1,
          headLength: 6,
          insetEnd: 4, // stop just short of the point
        }),
      );
    } else if (p.connector) {
      marks.push(Plot.dot([{ x: px, y: py }], { x: "x", y: "y", r: 3, fill: pColor }));
    }
    marks.push(
      Plot.text([{ x: px, y: py, t: p.label }], {
        x: "x",
        y: "y",
        text: "t",
        dx,
        dy,
        textAnchor: anchor,
        fill: pColor,
        fontSize: TBL.size.annotation,
        fontWeight: 600,
        ...LABEL_HALO,
      }),
    );
  }

  // 7. Pane titles (shared-mode small-multiples grid only): one per facet cell at the pane's
  //    top-left. The mark facets on both fx (=String(col)) and fy (=String(row)) so each
  //    title lands in its own (col,row) cell.
  if (gridFaceted && facet) {
    marks.push(...paneTitleMark(facet.cells));
  }

  // 8. Annotation labels LAST — on top of every band rect, gridline, axis rule, data line and
  //    reference line, so no later stroke paints over them.
  marks.push(...labelMarks);

  const plotOpts: Record<string, unknown> = {
    ...tblPlotDefaults({
      // Horizontal bars override marginBottom (the value-tick row is short; the inherited
      // categorical-label bottom margin would leave a big empty band under the axis).
      marginBottom: layers.marginBottom ?? xOpts.marginBottom,
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
      // Sectioned horizontal bars request extra top margin for the first section's header.
      ...(layers.marginTop != null ? { marginTop: layers.marginTop } : {}),
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
