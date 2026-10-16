// Defaults read by BOTH the validator and the engine. They live in spec/ because the engine may
// import spec but spec must not import engine; a default restated as a literal on each side can drift
// silently (a validator counting points for one degree while the engine fits another).

/** Default `shading[].fillOpacity`. Shading is the subject of the chart, not chrome behind it, so it
 *  reads at half opacity rather than the confidence-band tint (0.18) it originally borrowed; two
 *  overlapping regions compound (0.5 over 0.5 renders as 0.75). Read by marks/line.ts (paint) and
 *  annotation-legend.ts (swatch tint) through engine/annotation-paint.ts, and by validate.ts (two
 *  derived chips at the same opacity collide). */
export const SHADE_FILL_OPACITY = 0.5;

/** Default `overlays[].degree` for `method: poly`. Read by engine/overlays.ts (the fit) and
 *  validate.ts (the degree + 1 points a fit needs). */
export const POLY_DEFAULT_DEGREE = 2;

/** The largest |yAxisPolicy.min| / |max| accepted (Ruling 74). A lone bound's open end is placed past
 *  it, clamped to ±Number.MAX_VALUE; this keeps that end strictly past the bound, so the axis ascends.
 *  schema.ts enforces it; validate.ts formats the error. */
export const Y_BOUND_LIMIT = 1e300;
