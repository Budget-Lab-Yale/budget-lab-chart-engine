// The order Plot 0.6.16 emits a mark's elements in. The post-render tagging pass (assemble-plot.ts)
// stamps `data-series` / `data-category` onto the elements a selector matches BY DOM INDEX, so every
// builder has to list its tags in exactly this order. Each builder used to predict it by hand, and
// three drifted (a sectioned dumbbell and sectioned grouped horizontal bars tagged in data order while
// Plot drew facet by facet; a line counted a series whose points were all undefined, which Plot draws
// no path for). These two functions state the order for the bar, stacked, dumbbell and line builders.
// point.ts, histogram.ts, waterfall.ts, area.ts and overlay.ts (`segCount`) still predict it by hand.

/**
 * The rows of a one-element-per-row mark (bar rects, dots), in the order Plot emits their elements.
 *
 * Faceted on the category band (`fx` / `fy` bound to the category), Plot draws facet by facet in the
 * facet DOMAIN's order, and within a facet in data-row order. Unfaceted (the category on a plain `x` /
 * `y` band), it draws in data-row order. Either way a row whose category is outside `domain` draws
 * nothing. The rows must already be the ones handed to the mark (a builder that filters undefined
 * values out of the mark's data passes that filtered list).
 */
export function rowEmissionOrder<R>(
  rows: readonly R[],
  categoryOf: (r: R) => string | undefined,
  domain: readonly string[],
  faceted: boolean,
): R[] {
  if (!faceted) {
    const inDomain = new Set(domain);
    return rows.filter((r) => inDomain.has(categoryOf(r) as string));
  }
  const byCategory = new Map<string, R[]>(domain.map((c) => [c, []]));
  for (const r of rows) byCategory.get(categoryOf(r) as string)?.push(r);
  return domain.flatMap((c) => byCategory.get(c) ?? []);
}

/**
 * The first row of each `z` group that Plot draws a path for (line), in the order it emits them: one
 * <path> per group, in the group's first-appearance order in the data, and NO path for a group none
 * of whose points is drawable. Plot 0.6.16 decides that from the scaled x/y channel values; the line
 * mark's `defined` option is inert (`defined: () => false` on finite data still draws). So `defined`
 * here must mirror Plot's own definedness test on the channels, not any option passed to the mark.
 */
export function groupEmissionOrder<R>(
  rows: readonly R[],
  zOf: (r: R) => string,
  defined: (r: R) => boolean,
): R[] {
  const first = new Map<string, R>();
  const drawn = new Set<string>();
  for (const r of rows) {
    const z = zOf(r);
    if (!first.has(z)) first.set(z, r);
    if (defined(r)) drawn.add(z);
  }
  return [...first].filter(([z]) => drawn.has(z)).map(([, r]) => r);
}
