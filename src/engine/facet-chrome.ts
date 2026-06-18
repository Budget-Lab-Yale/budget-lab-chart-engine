// Facet-aware chrome collapse. Plot's `fx` faceting (grouped bars) repeats the engine's
// chrome marks inside EVERY facet frame: the gridlines + zero baseline become segmented
// per group, and the y-tick labels render once PER facet instead of once at the left
// margin. The Style-Guide requires CONTINUOUS gridlines spanning the full plot and y-tick
// labels ONCE at the left edge.
//
// In the vendored Plot 0.6.16 the clean Plot-native "render once" path is not available
// (`facet:"super"` is rejected for y-scaled marks; `facet:null` does not suppress the
// per-facet repetition — see task A6.5). So this module does a deterministic post-render
// DOM pass: it operates on the known Plot output structure (per-facet translated <g>s,
// tagged via findable classNames) with no Date.now / Math.random, so repeated renders stay
// byte-identical.
//
// Reusable for B3 (fx+fy small-multiples grids): `collapseFacetChrome` takes the facet
// geometry (column count now; a `rows` dimension is the documented extension point below).

/** ClassName stamped on the light-gridline ruleY mark (assemble-plot / axes). */
export const GRIDLINE_CLASS = "tbl-gridline";
/** ClassName stamped on the zero-baseline ruleY mark (assemble-plot). */
export const ZERO_BASELINE_CLASS = "tbl-zero-baseline";
/** ClassName already carried by the y-tick-label text mark (axes.gridAndYLabels). */
export const Y_TICK_LABEL_CLASS = "tbl-y-tick-label";

export interface CollapseFacetChromeOptions {
  /** Outer SVG width in px (the right plot edge is width - marginRight). */
  width: number;
  /** Right margin in px. */
  marginRight: number;
  // Extension point for B3 (fx+fy grids): the `fy` row dimension. A faceted grid repeats
  // the y-chrome once per (column,row) cell. For the single-row `fx` case handled here,
  // every facet shares one y-scale and one row, so we keep the FIRST cell's chrome and
  // stretch gridlines to full width. B3 will add a `rows` count + per-row y-pixel handling
  // (each row band has its own y-scale origin) and keep one column's chrome per row.
}

/** A line collapses to a horizontal full-width rule at a fixed y-pixel. We read the
 *  rendered y from the first facet's lines (deterministic — the shared y-scale puts every
 *  tick at the same y-pixel in every facet). */
function stretchLinesToFullWidth(
  group: SVGGElement,
  leftLocalX: number,
  rightLocalX: number,
): void {
  const lines = group.querySelectorAll<SVGLineElement>("line");
  for (const line of Array.from(lines)) {
    line.setAttribute("x1", String(leftLocalX));
    line.setAttribute("x2", String(rightLocalX));
  }
}

/**
 * Collapse the repeated per-facet chrome of an `fx`-faceted plot in place.
 *
 * - Y-tick labels: keep exactly ONE set (the leftmost facet's, already positioned at the
 *   SVG left edge via the `dx: -marginLeft` offset); remove the duplicate sets.
 * - Gridlines + zero baseline: keep the leftmost facet's group, stretch each line to span
 *   the full plot width (left gridline extension → right plot edge), and remove the
 *   duplicate per-facet groups so the lines read as continuous rules under the group gaps.
 *
 * No-op-safe: callers gate on faceting; if no faceted groups are found this returns
 * without mutating anything.
 */
export function collapseFacetChrome(
  svg: SVGSVGElement,
  { width, marginRight }: CollapseFacetChromeOptions,
): void {
  // Collapse the repeated label/rule groups identified by className. For each class, the
  // matched groups are the per-facet copies in left-to-right facet order (DOM order, which
  // Plot emits in fx-domain order). We keep the first and drop the rest.
  const collapseDuplicateGroups = (className: string): SVGGElement[] => {
    const groups = Array.from(
      svg.querySelectorAll<SVGGElement>(`g.${className}`),
    );
    if (groups.length <= 1) return groups;
    for (let i = 1; i < groups.length; i++) groups[i]?.remove();
    return groups.length ? [groups[0] as SVGGElement] : [];
  };

  // 1. Y-tick labels: one set at the left margin.
  collapseDuplicateGroups(Y_TICK_LABEL_CLASS);

  // 2 + 3. Gridlines and zero baseline: collapse to the leftmost facet, then stretch its
  // lines to full plot width.
  for (const cls of [GRIDLINE_CLASS, ZERO_BASELINE_CLASS]) {
    const kept = collapseDuplicateGroups(cls);
    const group = kept[0];
    if (!group) continue;

    // The kept group is the leftmost facet's; it is translated by the facet's x origin
    // (`transform="translate(tx,0)"`). Lines are in that local frame. We want them to span
    // from the current left extent (x1, which already includes the left gridline-extension
    // inset) to the right plot edge in absolute coords. Convert the right edge to the
    // group's local frame by subtracting the group's tx.
    const tx = readTranslateX(group);
    const firstLine = group.querySelector<SVGLineElement>("line");
    const leftLocalX = firstLine ? Number(firstLine.getAttribute("x1") ?? "0") : 0;
    const rightEdgeAbs = width - marginRight;
    const rightLocalX = rightEdgeAbs - tx;
    stretchLinesToFullWidth(group, leftLocalX, rightLocalX);
  }
}

/** Read the X translation from a `transform="translate(tx,ty)"` attribute. Deterministic
 *  parse of Plot's emitted transform; returns 0 if absent/unparseable. */
function readTranslateX(el: SVGGElement): number {
  const t = el.getAttribute("transform") ?? "";
  const m = /translate\(\s*(-?[\d.]+)/.exec(t);
  return m ? Number(m[1]) : 0;
}
