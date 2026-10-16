// How annotations paint, in one place, for every reader that must agree with the paint: the marks
// (assemble-plot.ts bands and rug, marks/line.ts shading) and the legend chips that key them
// (annotation-legend.ts, which flattens each fill over white at the same opacity). A value restated
// as a literal on one side would silently mis-key the swatch. The shading default also lives in
// spec/defaults.ts, because validate.ts reads it and spec/ must not import engine/.
import { TBL } from "./theme";
import { resolveColor } from "./palette";
import { rugTrackColor } from "../spec/rug";

export { SHADE_FILL_OPACITY } from "../spec/defaults";

/** Fill opacity of an `annotations.bands` rect. */
export const BAND_FILL_OPACITY = 0.1;

/** A rug block's colour: its own `color`, else its source series' colour, else the annotation
 *  neutral. The strip (assemble-plot.ts) and the chip keying a rug-flagged fill
 *  (annotation-legend.ts) both resolve through here, so a block and its key cannot disagree. */
export function rugBlockColor(
  track: { color?: string | undefined; series?: string | undefined },
  colors: ReadonlyMap<string, string>,
): string {
  return rugTrackColor(track, (s) => colors.get(s), resolveColor, TBL.color.annotationDim);
}
