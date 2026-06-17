// Pure chart engine entry point. The ported tbl-chart.js primitives + buildLineMarks /
// assemblePlot land here in engine steps 2-3. Headless-safe: no Date.now / Math.random /
// locale formatting in the render path; interaction lives in render-live.ts.
import type { ChartSpec } from "../spec/types";
import type { TidyRow } from "../data/index";

/** Inputs to a render: a validated spec, normalized data, and sizing. */
export interface RenderOptions {
  width?: number;
  height?: number;
}

/**
 * Placeholder for the core entry point. Implemented in engine steps 2-3 by porting
 * buildLineChart (split into buildLineMarks + assemblePlot) from the tracker.
 */
export declare function renderChart(
  spec: ChartSpec,
  data: TidyRow[],
  opts?: RenderOptions,
): SVGSVGElement;
