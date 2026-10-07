// KEEP THIS FILE IMPORT-FREE, for the reason `filled-chart-types.ts` states: the browser bundle
// imports it (figure layout, the live mount), and `validate.ts` imports it too.

/** Whether a spec is a dumbbell drawn HORIZONTAL (categories on screen-y). A dumbbell is horizontal
 *  unless `orientation: "vertical"` — CONFIG-SPEC "Dumbbell options" documents horizontal as the
 *  default — whereas every other chart type defaults to vertical. The single source for that
 *  default: the mark, figure layout, live mount, export and validation all ask here, so an omitted
 *  orientation cannot be drawn one way and laid out another. */
export function isHorizontalDumbbell(spec: { chartType?: unknown; orientation?: unknown }): boolean {
  return spec.chartType === "dumbbell" && spec.orientation !== "vertical";
}

/** Whether the chart's VALUE axis runs along screen-x: a horizontal bar or stack, or a horizontal
 *  dumbbell (orientation omitted included). Every other chart type ignores `orientation`. There a
 *  value-axis reference line is an `annotations.xAxis` marker; an `annotations.yAxis` one would sit
 *  on the categorical y scale and draw nothing, so validation rejects it and renderPane never folds
 *  it into the value domain (Ruling 78). */
export function valueAxisIsX(spec: { chartType?: unknown; orientation?: unknown }): boolean {
  return (
    ((spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal") ||
    isHorizontalDumbbell(spec)
  );
}
