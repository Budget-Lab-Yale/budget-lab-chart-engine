// assemblePlot: the generic, chart-type-agnostic step. Takes a chart type's mark
// layers plus the computed axes and assembles the full Plot in the correct paint
// order — band underlay → gridlines → x-axis → zero baseline → reference markers →
// line overlay — then returns the SVG with margin metadata stamped on for the
// crosshair/overlay layers to read.
import { Plot } from "./vendor";
import { TBL, TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT } from "./theme";
import { tblPlotDefaults, gridAndYLabels } from "./axes";
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

  // 1. Band underlay (behind everything).
  marks.push(...layers.underlay);

  // 2. Gridlines + y-tick labels. 3. X-axis. (extend across both label columns so the
  //    chart edges sit flush with the canvas.)
  marks.push(
    ...gridAndYLabels(yTicks, {
      yTickFormat: makeTickFormatter(yTicks, units),
      marginRight: effMarginRight,
    }),
  );
  marks.push(...xOpts.axisMarks);

  // 4. Zero baseline (darker rule painted over the light gridlines).
  marks.push(
    Plot.ruleY([0], {
      stroke: TBL.color.axisStroke,
      strokeWidth: 1,
      insetLeft: -TBL_MARGIN_LEFT,
      insetRight: -effMarginRight,
      clip: false,
    }),
  );

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
    y: { label: null, axis: null, grid: false, domain: yDomain },
    color: { domain: seriesNames, range: seriesNames.map((s) => colors.get(s)) },
    marks,
  };
  if (xOpts.xPlotOpts) plotOpts.x = xOpts.xPlotOpts;
  if (document) plotOpts.document = document;

  const svg = Plot.plot(plotOpts) as SVGSVGElement;
  svg.dataset.marginLeft = String((plotOpts.marginLeft as number) ?? 0);
  svg.dataset.marginRight = String((plotOpts.marginRight as number) ?? 8);
  svg.dataset.marginTop = String((plotOpts.marginTop as number) ?? 18);
  svg.dataset.marginBottom = String((plotOpts.marginBottom as number) ?? 28);

  // Tag <path data-series=…> for legend hover-dim. Plot.line with z:"series" emits one
  // path per unique series in data-encounter order; tag each line group's paths against
  // that group's own encounter order so dashed-then-solid splits stay mapped correctly.
  const groupOrders = layers.groupOrders;
  svg.querySelectorAll('g[aria-label="line"]').forEach((g, gi) => {
    const order = groupOrders[gi];
    if (!order) return;
    g.querySelectorAll("path").forEach((p, pi) => {
      if (pi < order.length) p.setAttribute("data-series", order[pi] as string);
    });
  });

  return svg;
}
