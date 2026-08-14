// The one walk that answers "what colour is this element ACTUALLY painted?". Kept in its own
// module (no engine deps) so the three layers that need the answer — the hatch grounding in
// `assemble-plot.ts`, the tooltip swatches in `crosshair.ts`, and the histogram swatch map in
// `render-live.ts` — share a single boundary rule instead of three hand-copied loops that drifted.
// They had already drifted: two of the three inspected the root `<svg>` and one did not, which is
// exactly the difference between a working fallback and an invisible texture (see below).

/**
 * The fill an element is ACTUALLY painted, or null when nothing on its chain declares one.
 *
 * WHY A WALK. Plot puts a CONSTANT fill on the mark's `<g>` and a CHANNEL fill on each element, so
 * neither place alone is authoritative: `bar_color: amber` lands on the group, while a per-series
 * or per-category fill (category_colors, mono stacks, highlight dimming, the title-selector accent)
 * lands on the `<rect>` itself. Climb from the element and take the first `fill` that is neither
 * absent nor `none`.
 *
 * WHY THE ROOT `<svg>` IS EXCLUDED. Plot stamps `fill="currentColor"` on the root unconditionally —
 * it is the default ink for text marks, not any mark's colour. Including the root therefore never
 * returns null, which silently kills every caller's "no fill found → fall back to the series colour
 * map" branch and hands them the literal string `"currentColor"` instead. `d3.color` cannot parse
 * that, so `resolveHatch("currentColor")` derives a band colour equal to its ground and paints a
 * texture that cannot be seen; a tooltip swatch built from it renders in the tooltip's text colour
 * rather than the series'. Stopping BEFORE the root is what makes those fallbacks reachable.
 *
 * WHY THE ATTRIBUTE AND NOT `getComputedStyle`. Do not "helpfully" switch this to computed style.
 * `series_patterns` textures are applied as `style.fill = url(#...)`, which beats Plot's `fill`
 * ATTRIBUTE without rewriting it — deliberately, so the flat colour survives underneath. Reading
 * the attribute is what lets a tooltip swatch show that flat colour, and what lets a re-render
 * re-ground a hatch from a real colour, instead of both getting back a `url(#tblhatch-…)`
 * paint-server reference.
 */
export function paintedFill(el: Element | null, svg: Element): string | null {
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const fill = n.getAttribute("fill");
    if (fill && fill !== "none") return fill;
  }
  return null;
}
