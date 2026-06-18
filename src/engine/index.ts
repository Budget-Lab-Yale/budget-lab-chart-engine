// Pure chart engine entry point: a validated spec + normalized tidy rows → an SVG plus
// the metadata the live layer (legend, crosshair) needs. Headless-safe — no Date.now /
// Math.random / locale formatting in the render path; interaction lives elsewhere.
//
// This is the tracker's buildLineChart, generalized: data prep + axis computation are
// chart-type agnostic here; the type-specific marks come from the marks/ registry, and
// the Plot is composed by assemblePlot.
import type { ChartSpec } from "../spec/types";
import type { TidyRow } from "../data/index";
import { tblColorScale, resolveColor } from "./palette";
import { computeYAxis } from "./scales";
import { makeXAdapter } from "./x-adapter";
import { markBuilderFor } from "./marks/index";
import type { PreparedRow } from "./marks/index";
import { assemblePlot } from "./assemble-plot";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, TBL_MARGIN_TOP } from "./theme";

export interface RenderOptions {
  width?: number;
  height?: number;
  marginRight?: number;
  /** Headless rendering: the document Plot should build into (jsdom in tests/SSR). */
  document?: Document;
}

export interface LegendItem {
  series: string;
  label: string;
  color: string | undefined;
  dashed: boolean;
}

export interface RenderResult {
  svg: SVGSVGElement;
  /** Legend rows (null for a single, unstyled series — no legend needed). */
  legendItems: LegendItem[] | null;
  seriesLabels: Record<string, string>;
  seriesOrder: string[];
  dashedNames: Set<string>;
  colors: Map<string, string>;
  units: string;
  xAxisTitle: string | null;
  /** Rows actually rendered (series-filtered), for the crosshair. */
  dataInScope: PreparedRow[];
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
}

function uniqueSeries(rows: PreparedRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) if (!seen.has(r.series)) { seen.add(r.series); out.push(r.series); }
  return out;
}

function buildColorMap(
  seriesNames: string[],
  seriesColorsCfg?: Record<string, string>,
): Map<string, string> {
  const palette = tblColorScale(seriesNames.length);
  const m = new Map<string, string>();
  seriesNames.forEach((s, i) => {
    const override = resolveColor(seriesColorsCfg?.[s]);
    m.set(s, override || (palette[i] as string));
  });
  return m;
}

function inferUnitsFromSubtitle(subtitle?: string): string {
  if (!subtitle) return "";
  const lower = subtitle.toLowerCase();
  if (lower.includes("percent") || lower.includes("percentage point")) return "%";
  return "";
}

export function renderChart(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
): RenderResult {
  const xType = spec.xAxisType;
  if (!xType) throw new Error("No xAxisType.");

  const adapter = makeXAdapter(xType, spec.xAxisPolicy);
  const seriesField = spec.series_field || "series";

  // Parse + validate rows into the engine's in-memory shape.
  const data: PreparedRow[] = rows
    .map((r) => {
      const row = {
        series: r[seriesField] as string,
        time: r.time,
        _y: r.value === "" ? null : +r.value,
      } as PreparedRow;
      (row as unknown as Record<string, unknown>)[adapter.xField] = adapter.parseX(r.time);
      for (const band of spec.confidence_bands ?? []) {
        if (r[seriesField] === band.series) {
          const lo = r[band.lower];
          const hi = r[band.upper];
          row._lo = lo !== "" && lo != null ? +lo : undefined;
          row._hi = hi !== "" && hi != null ? +hi : undefined;
        }
      }
      return row;
    })
    .filter((r) => adapter.validate(r as unknown as Record<string, unknown>));

  if (!data.length) throw new Error("No data.");

  // Series order + colors. When series_order is set it acts as both filter and order.
  const seriesNames =
    spec.series_order && spec.series_order.length
      ? spec.series_order.filter((s) => data.some((r) => r.series === s))
      : uniqueSeries(data);
  const seriesSet = new Set(seriesNames);
  const dataInScope = data.filter((r) => seriesSet.has(r.series));
  const colors = buildColorMap(seriesNames, spec.series_colors);

  // Y-axis: fold CI band bounds into the computed range when present.
  const yForAxis: Array<number | null | undefined> = [
    ...dataInScope.map((d) => d._y),
    ...dataInScope.map((d) => d._lo).filter(Number.isFinite),
    ...dataInScope.map((d) => d._hi).filter(Number.isFinite),
  ];
  const policy = spec.yAxisPolicy ?? {};
  let yMax = policy.max;
  if (policy.autoWiden && yMax != null) {
    const dataMax = Math.max(...(yForAxis.filter(Number.isFinite) as number[]));
    if (dataMax > yMax) {
      const step = policy.autoWiden.step || 1;
      yMax = Math.ceil(dataMax / step) * step;
    }
  }
  const hardDomain: [number, number] | null =
    policy.min != null && yMax != null ? [policy.min, yMax] : null;
  const tickCount = policy.tickCount ?? 5;
  const { domain: yDomain, ticks: yTicks } = computeYAxis(yForAxis, {
    includeZero: policy.includeZero === true,
    domain: hardDomain,
    tickCount,
  });

  const xOpts = adapter.buildXOpts(dataInScope);
  const units = inferUnitsFromSubtitle(spec.subtitle);

  // Approximate inner plot dimensions for bar-builder label-suppression logic.
  // Approximation: uses TBL_MARGIN_TOP (matches tblPlotDefaults default) and the adapter's
  // marginBottom; bar builders should treat these as rough guidance, not pixel-perfect.
  const effWidth = opts.width ?? 720;
  const effHeight = opts.height ?? 320;
  const plotWidth = effWidth - TBL_MARGIN_LEFT - TBL_MARGIN_RIGHT;
  const plotHeight = effHeight - TBL_MARGIN_TOP - xOpts.marginBottom;

  // Chart-type-specific marks, then assemble the Plot.
  const layers = markBuilderFor(spec.chartType)(dataInScope, spec, {
    xField: adapter.xField,
    colors,
    seriesNames,
    plotWidth,
    plotHeight,
  });

  const svg = assemblePlot({
    layers,
    yDomain,
    yTicks,
    units,
    xOpts,
    seriesNames,
    colors,
    spec,
    width: opts.width,
    height: opts.height,
    marginRight: opts.marginRight,
    document: opts.document,
  });

  // Legend: present when 2+ series OR any series carries a style override.
  const seriesLabels = spec.series_labels ?? {};
  const labelFor = (name: string): string => seriesLabels[name] ?? name;
  const hasDashOverrides = layers.dashedNames.size > 0;
  const legendItems: LegendItem[] | null =
    seriesNames.length > 1 || hasDashOverrides
      ? seriesNames.map((name) => ({
          series: name,
          label: labelFor(name),
          color: colors.get(name),
          dashed: spec.series_styles?.[name]?.dashed === true,
        }))
      : null;

  return {
    svg,
    legendItems,
    seriesLabels,
    seriesOrder: seriesNames,
    dashedNames: layers.dashedNames,
    colors,
    units,
    xAxisTitle: spec.x_axis_title ?? null,
    dataInScope,
    tooltipXParse: xOpts.tooltipXParse,
    tooltipXFormat: xOpts.tooltipXFormat,
  };
}
