/** The class of every transparent full-SVG hover hit rect crosshair.ts appends, one per attach
 *  family (line/area, band, histogram, categorical line/dot/dumbbell). A leaf module so that
 *  render-live, the embed stylesheet and crosshair.ts read one list: each place that needs "the
 *  hover overlay" must reach ALL of them, and a partial list silently leaves one chart type broken
 *  (the categorical-line overlay was missing from two such lists). Keep in sync with the
 *  `hit.classList.add` calls in crosshair.ts. */
export const CROSSHAIR_HIT_CLASSES = [
  "tbl-crosshair-hit",
  "tbl-band-crosshair-hit",
  "tbl-hist-hover-hit",
  "tbl-catline-hit",
] as const;

/** `CROSSHAIR_HIT_CLASSES` as one selector. */
export const CROSSHAIR_HIT_SELECTOR: string = CROSSHAIR_HIT_CLASSES.map((c) => `.${c}`).join(", ");
