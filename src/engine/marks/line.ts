// Line chart mark builder. Produces the chart-type-specific marks (confidence-band
// areas + the line(s)); the generic chrome (gridlines, axes, zero baseline, reference
// markers) is added by assemblePlot. Split out of the tracker's monolithic
// buildLineChart so other chart types can register their own builder (marks/index.ts).
import { Plot } from "../vendor";
import { TBL } from "../theme";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

export function buildLineMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, colors } = ctx;

  // Underlay: confidence-band areas, painted behind the gridlines.
  const underlay: unknown[] = [];
  for (const band of spec.confidence_bands ?? []) {
    const bandColor = colors.get(band.series) || TBL.color.blue;
    underlay.push(
      Plot.areaY(
        data.filter(
          (r) => r.series === band.series && Number.isFinite(r._lo) && Number.isFinite(r._hi),
        ),
        { x: xField, y1: "_lo", y2: "_hi", fill: bandColor, fillOpacity: 0.18 },
      ),
    );
  }

  // Group series into dashed vs solid so each is a single Plot.line call (z: "series").
  // Dashed paints first so solid lines paint over them where paths cross.
  const dashedNames = new Set<string>();
  for (const [s, st] of Object.entries(spec.series_styles ?? {})) {
    if (st?.dashed) dashedNames.add(s);
  }
  const dashedData = data.filter((r) => dashedNames.has(r.series));
  const solidData = data.filter((r) => !dashedNames.has(r.series));

  const overlay: unknown[] = [];
  if (dashedData.length) {
    overlay.push(
      Plot.line(dashedData, {
        x: xField,
        y: "_y",
        z: "series",
        stroke: "series",
        strokeWidth: TBL.strokeWidth.dashed,
        strokeDasharray: TBL.dashArray,
        defined: (r: PreparedRow) => Number.isFinite(r._y),
      }),
    );
  }
  if (solidData.length) {
    overlay.push(
      Plot.line(solidData, {
        x: xField,
        y: "_y",
        z: "series",
        stroke: "series",
        strokeWidth: TBL.strokeWidth.solid,
        defined: (r: PreparedRow) => Number.isFinite(r._y),
      }),
    );
  }

  // Series encounter order within each line group, so post-render path tagging maps
  // each <path data-series> correctly even when dashed+solid groups share a color.
  const encounterOrder = (rs: PreparedRow[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rs) if (!seen.has(r.series)) { seen.add(r.series); out.push(r.series); }
    return out;
  };
  const groupOrders: string[][] = [];
  if (dashedData.length) groupOrders.push(encounterOrder(dashedData));
  if (solidData.length) groupOrders.push(encounterOrder(solidData));

  return { underlay, overlay, groupOrders, dashedNames };
}
