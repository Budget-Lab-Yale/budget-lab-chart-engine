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
/** ClassName stamped on the value-axis tick-label text mark in the HORIZONTAL (fy) layout
 *  (assemble-plot) so the fy collapse can find the per-facet copies. */
export const X_TICK_LABEL_CLASS = "tbl-x-tick-label";

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

export interface CollapseFacetChromeYOptions {
  /** Outer SVG height in px (the bottom plot edge is height - marginBottom). */
  height: number;
  /** Top margin in px (the top plot edge). */
  marginTop: number;
  /** Bottom margin in px. */
  marginBottom: number;
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

/** Read the Y translation from a `transform="translate(tx,ty)"` attribute (ty defaults to
 *  0 when only one value is present, matching SVG semantics). Returns 0 if absent. */
function readTranslateY(el: SVGGElement): number {
  const t = el.getAttribute("transform") ?? "";
  const m = /translate\(\s*-?[\d.]+\s*[ ,]\s*(-?[\d.]+)/.exec(t);
  return m ? Number(m[1]) : 0;
}

/** A line collapses to a vertical full-height rule at a fixed x-pixel (the value-tick).
 *  We rewrite each line's y1/y2 (in the kept group's local frame) to span the full plot
 *  height. The shared x-scale puts every value tick at the same x-pixel in every facet, so
 *  reading the first facet's x is deterministic. */
function stretchLinesToFullHeight(
  group: SVGGElement,
  topLocalY: number,
  bottomLocalY: number,
): void {
  const lines = group.querySelectorAll<SVGLineElement>("line");
  for (const line of Array.from(lines)) {
    line.setAttribute("y1", String(topLocalY));
    line.setAttribute("y2", String(bottomLocalY));
  }
}

/**
 * Collapse the repeated per-facet chrome of an `fy`-faceted plot (horizontal grouped bars)
 * in place. Mirror of {@link collapseFacetChrome} with the axes swapped (fx→fy, x→y,
 * width→height):
 *
 * - Value-axis tick labels: Plot renders them once PER ROW facet (each at that facet's
 *   bottom). Keep exactly ONE set and re-translate it to sit just below the WHOLE plot
 *   (the bottom plot edge), then drop the duplicates → one value-axis row at the bottom.
 * - Gridlines + zero baseline: keep the FIRST facet's group, stretch each vertical line to
 *   span the full plot height (top plot edge → bottom plot edge) so the value gridlines
 *   read as continuous rules across all row groups; drop the duplicate per-facet groups.
 *
 * No-op-safe: callers gate on fy faceting; if no faceted groups are found this returns
 * without mutating anything.
 */
export function collapseFacetChromeY(
  svg: SVGSVGElement,
  { height, marginTop, marginBottom }: CollapseFacetChromeYOptions,
): void {
  const collapseDuplicateGroups = (className: string): SVGGElement[] => {
    const groups = Array.from(svg.querySelectorAll<SVGGElement>(`g.${className}`));
    if (groups.length <= 1) return groups;
    for (let i = 1; i < groups.length; i++) groups[i]?.remove();
    return groups.length ? [groups[0] as SVGGElement] : [];
  };

  const topAbs = marginTop;
  const bottomAbs = height - marginBottom;

  // 1. Value-axis tick labels: keep one set and move it to the bottom plot edge. The kept
  //    group is the FIRST facet's, translated by that facet's y origin (`translate(0,ty)`);
  //    its labels are positioned relative to the facet's bottom. Re-translate the group so
  //    its content lands at the whole plot's bottom: subtract the facet height implied by
  //    the gridlines, i.e. set the group's ty so its local frame bottom == bottomAbs. We
  //    read the facet's local bottom from its gridline span (top facet runs topLocalY..
  //    bottomLocalY) — but the label group's own local frame already aligns text to the
  //    facet bottom, so translating the group by (bottomAbs - facetBottomAbs) suffices.
  const labelGroups = Array.from(
    svg.querySelectorAll<SVGGElement>(`g.${X_TICK_LABEL_CLASS}`),
  );
  if (labelGroups.length) {
    const kept = labelGroups[0] as SVGGElement;
    // Drop the duplicates first.
    for (let i = 1; i < labelGroups.length; i++) labelGroups[i]?.remove();
    // The kept group is translated to the first facet's origin. Its text sits at the
    // facet's local bottom (frameAnchor:"bottom"). Re-translate it from the first facet's
    // bottom to the whole-plot bottom. The first facet's bottom (absolute) is its ty plus
    // the facet's inner height; we infer the inner height from the first gridline group's
    // local y2 (deterministic, shared y-scale). Fallback: span to bottomAbs directly.
    const ty = readTranslateY(kept);
    const firstGrid = svg.querySelector<SVGGElement>(`g.${GRIDLINE_CLASS}`);
    let facetBottomLocal = bottomAbs - ty; // fallback
    if (firstGrid) {
      const gl = firstGrid.querySelector<SVGLineElement>("line");
      if (gl) facetBottomLocal = Number(gl.getAttribute("y2") ?? facetBottomLocal);
    }
    const facetBottomAbs = ty + facetBottomLocal;
    const dy = bottomAbs - facetBottomAbs;
    if (dy !== 0) {
      const tx = readTranslateX(kept);
      kept.setAttribute("transform", `translate(${tx},${ty + dy})`);
    }
  }

  // 2 + 3. Gridlines and zero baseline: collapse to the first facet, then stretch its lines
  //         to full plot height in the kept group's local frame.
  for (const cls of [GRIDLINE_CLASS, ZERO_BASELINE_CLASS]) {
    const kept = collapseDuplicateGroups(cls);
    const group = kept[0];
    if (!group) continue;
    const ty = readTranslateY(group);
    stretchLinesToFullHeight(group, topAbs - ty, bottomAbs - ty);
  }
}
