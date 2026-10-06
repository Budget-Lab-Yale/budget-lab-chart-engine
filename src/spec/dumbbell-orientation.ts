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
