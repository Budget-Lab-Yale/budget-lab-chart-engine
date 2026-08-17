// KEEP THIS FILE IMPORT-FREE. It holds one constant, split out of `validate.ts` — its only other
// plausible home — for a bundling reason, not a tidiness one.
//
// `validate.ts` instantiates Ajv at module scope, so importing ANY name from it drags the whole
// validator in. A single such import from anything reachable by `src/embed/standalone-entry.ts` —
// which `scripts/build.mjs` bundles into the browser IIFE — puts Ajv's schema walker into
// `dist/embed/live.js`: measured at +128 KB minified (+13 %) when `render-live.ts` took this set
// from `validate.ts`. That violates the invariant `scripts/build.mjs` states at its spec/data
// entry: the validator depends on ajv, an authoring/CLI concern, and is "not part of the browser
// engine bundle". Same shape as `src/engine/painted-fill.ts` and `src/spec/color-ref.ts`.
//
// Today `validate.ts` itself is the only non-test importer, so this split guards nothing DIRECTLY —
// the browser reaches neither file. It is kept because it makes the set safe for a browser-side
// consumer to import again (`render-live.ts` was one until 1.11.0), and because an import added
// here would fail silently: nothing breaks, the bundle just grows. What actually holds the line now
// is `test/standalone-bundle.test.ts` ("browser bundle contents"), which greps the built IIFE for
// ajv, `src/spec/validate.ts` and `src/spec/schema.ts` and fails if any is reachable.

/** Chart types whose marks are filled AREAS, and so can carry a `series_patterns` texture. A line's
 *  2px stroke and a dot's 8px disc are smaller than the 7px hatch period, so a texture there is
 *  noise rather than a channel — reject instead of rendering something illegible. */
export const FILLED_CHART_TYPES = new Set(["bar", "stacked", "area", "histogram", "waterfall"]);
