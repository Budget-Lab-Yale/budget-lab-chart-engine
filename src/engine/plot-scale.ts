// Read a rendered Plot's own scales back out of the SVG.
//
// `Plot.plot()` attaches a `scale(name)` accessor to the element it returns. Going through it — rather
// than re-deriving a domain→pixel mapping from the data extent and the stamped margins — is what keeps
// overlays landing on the SAME geometry the marks were drawn against, whatever Plot decided about
// nice-rounding or padding. Shared by the crosshair (value→pixel for its guides and pills) and the
// x-axis rug (x→pixel for its interval blocks).
//
// PURE and layout-free: `scale()` returns plain numbers, so this works identically in the browser, in
// the PNG export, and in jsdom.

/** A value→pixel function for `axis`, or null when the scale is unusable: an SVG that didn't come
 *  from Plot, a band (categorical) scale, or a degenerate domain. Date domains coerce to epoch ms. */
export function readLinearScale(
  svgEl: SVGSVGElement,
  axis: "x" | "y",
): ((v: number) => number) | null {
  const scaleFn = (svgEl as unknown as { scale?: (n: string) => unknown }).scale;
  if (typeof scaleFn !== "function") return null;
  try {
    const s = scaleFn.call(svgEl, axis) as { domain?: unknown[]; range?: number[] } | undefined;
    const d = s?.domain;
    const r = s?.range;
    if (!d || !r || d.length < 2 || r.length < 2) return null;
    const d0 = Number(d[0]);
    const d1 = Number(d[1]);
    const r0 = r[0] as number;
    const r1 = r[1] as number;
    // A band scale's domain coerces to NaN here, which is the intended rejection.
    if (!Number.isFinite(d0) || !Number.isFinite(d1) || d0 === d1) return null;
    return (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  } catch {
    return null;
  }
}

/** The `[lo, hi]` domain Plot drew `axis` over (epoch ms for dates), or null on the same terms as
 *  `readLinearScale`. For hover code that maps pixels back to data: the drawn domain can be wider than
 *  the pane's own data (a shared small-multiples range, a marker past the data). */
export function readScaleDomain(svgEl: SVGSVGElement, axis: "x" | "y"): [number, number] | null {
  const scaleFn = (svgEl as unknown as { scale?: (n: string) => unknown }).scale;
  if (typeof scaleFn !== "function") return null;
  try {
    const d = (scaleFn.call(svgEl, axis) as { domain?: unknown[] } | undefined)?.domain;
    if (!d || d.length < 2) return null;
    const lo = Number(d[0]);
    const hi = Number(d[1]);
    return Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi ? [lo, hi] : null;
  } catch {
    return null;
  }
}
