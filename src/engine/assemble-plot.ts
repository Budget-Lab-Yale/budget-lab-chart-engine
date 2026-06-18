// assemblePlot: the generic, chart-type-agnostic step. Takes a chart type's mark
// layers plus the computed axes and assembles the full Plot in the correct paint
// order — band underlay → gridlines → x-axis → zero baseline → reference markers →
// line overlay — then returns the SVG with margin metadata stamped on for the
// crosshair/overlay layers to read.
import { Plot } from "./vendor";
import { TBL, TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT } from "./theme";
import { tblPlotDefaults, gridAndYLabels } from "./axes";
import { collapseFacetChrome, GRIDLINE_CLASS, ZERO_BASELINE_CLASS } from "./facet-chrome";
import { makeTickFormatter } from "./scales";
import type { ChartSpec } from "../spec/types";
import type { XOpts } from "./x-adapter";
import type { MarkLayers } from "./marks/index";

// A fixed class name makes Plot's generated class + clip-path ids deterministic, so
// repeated renders are byte-identical (the golden-SVG locking gate depends on this).
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
}: AssembleOptions): SVGSVGElement {
  const effMarginRight = marginRight ?? TBL_MARGIN_RIGHT;

  const marks: unknown[] = [];
  // Horizontal bars (layer owns the y band scale): the value axis runs along x, so the
  // chrome flips — vertical gridlines + x value-tick labels + a vertical zero baseline,
  // and the layer supplies its own category labels on the y band via xAxisMarks.
  const horizontal = layers.yScaleOpts != null;
  // Faceted (grouped bars): categories live on the `fx` group scale, so Plot repeats the
  // chrome per facet. We tag the chrome marks with findable classNames ONLY in this case so
  // the post-render collapse pass can find them; non-faceted output stays byte-identical
  // (Plot omits the class attribute entirely when className is undefined).
  const faceted = layers.xScaleField === "fx";

  // 1. Band underlay (behind everything).
  marks.push(...layers.underlay);

  if (horizontal) {
    // 2h. Vertical gridlines + x value-tick labels (skip 0 from the light grid; baseline
    //     is painted darker below).
    const xTickFmt = makeTickFormatter(yTicks, units);
    marks.push(
      Plot.ruleX(
        yTicks.filter((t) => t !== 0),
        { stroke: TBL.color.gridline, strokeWidth: 1 },
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
      }),
    );
    // 3h. Category labels on the y band (layer-supplied).
    marks.push(...(layers.xAxisMarks ?? []));
    // 4h. Vertical zero baseline.
    marks.push(
      Plot.ruleX([0], { stroke: TBL.color.axisStroke, strokeWidth: 1 }),
    );
  } else {
    // 2. Gridlines + y-tick labels. 3. X-axis. (extend across both label columns so the
    //    chart edges sit flush with the canvas.)
    marks.push(
      ...gridAndYLabels(yTicks, {
        yTickFormat: makeTickFormatter(yTicks, units),
        marginRight: effMarginRight,
        ...(faceted ? { gridlineClassName: GRIDLINE_CLASS } : {}),
      }),
    );
    // X-axis labels: a mark layer that re-homes the category band (grouped bars label the
    // `fx` group scale) supplies its own axis marks; use those instead of the adapter's.
    marks.push(...(layers.xAxisMarks ?? xOpts.axisMarks));

    // 4. Zero baseline (darker rule painted over the light gridlines).
    marks.push(
      Plot.ruleY([0], {
        stroke: TBL.color.axisStroke,
        strokeWidth: 1,
        insetLeft: -TBL_MARGIN_LEFT,
        insetRight: -effMarginRight,
        clip: false,
        // className tags the wrapping <g> so the facet-chrome collapse pass can find the
        // per-facet zero-baseline copies — faceted charts only, so non-faceted output is
        // byte-identical.
        ...(faceted ? { className: ZERO_BASELINE_CLASS } : {}),
      }),
    );
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

  const plotOpts: Record<string, unknown> = {
    ...tblPlotDefaults({
      marginBottom: xOpts.marginBottom,
      ...(height != null ? { height } : {}),
      ...(marginRight != null ? { marginRight } : {}),
    }),
    ...(width ? { width } : {}),
    className: PLOT_CLASS,
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
  if (layers.xScaleField === "fx") {
    // Read width from the rendered SVG so the right plot edge is correct regardless of
    // whether an explicit width was passed (Plot defaults it otherwise).
    const svgWidth = Number(svg.getAttribute("width")) || (plotOpts.width as number) || 640;
    collapseFacetChrome(svg, { width: svgWidth, marginRight: effMarginRight });
  }

  // Tag data-series for legend hover-dim. Each mark layer declares a selector + the series
  // order its matched elements appear in (DOM order); tag by index. For lines this is the
  // flat dashed-then-solid path order, matching the old per-group loop byte-for-byte.
  for (const { selector, seriesOrder } of layers.tagging) {
    svg.querySelectorAll(selector).forEach((el, i) => {
      if (i < seriesOrder.length) el.setAttribute("data-series", seriesOrder[i] as string);
    });
  }

  return svg;
}
