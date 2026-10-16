// Series palette construction. Lives below index.ts so the chart renderers that need it (pane.ts,
// figure.ts, marks/timeline.ts, marks/treemap.ts) import it without importing the entry point.
import { tblColorScale, resolveColor } from "./palette";
import { ownValue } from "../spec/own-key";

/** Series → colour. The palette is assigned BY POSITION, and `paletteOrder` (small multiples: the
 *  figure's full series list) decides whose position counts — see RenderOptions.paletteSeries.
 *  Absent, or a series it doesn't name, falls back to the position in `seriesNames`. */
export function buildColorMap(
  seriesNames: string[],
  seriesColorsCfg?: Record<string, string>,
  paletteOrder?: string[],
): Map<string, string> {
  const order = paletteOrder ?? [];
  const palette = tblColorScale(Math.max(seriesNames.length, order.length));
  const m = new Map<string, string>();
  seriesNames.forEach((s, i) => {
    const override = resolveColor(ownValue(seriesColorsCfg, s));
    const at = order.indexOf(s);
    m.set(s, override || (palette[at >= 0 ? at : i] as string));
  });
  return m;
}
