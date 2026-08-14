// KEEP THIS FILE IMPORT-FREE. It holds one constant, split out of `validate.ts` — its only other
// plausible home — for a bundling reason, not a tidiness one.
//
// `validate.ts` instantiates Ajv at module scope, so importing ANY name from it drags the whole
// validator in. `render-live.ts` needs this set and is reachable from `src/embed/standalone-entry.ts`,
// which `scripts/build.mjs` bundles into the browser IIFE — so a bare
// `import { FILLED_CHART_TYPES } from "./validate.js"` there is not free. It put Ajv's schema walker
// into `dist/embed/live.js` and cost +128 KB minified (+13%), measured. That violates the invariant
// `scripts/build.mjs` states at its spec/data entry: the validator depends on ajv, an authoring/CLI
// concern, and is "not part of the browser engine bundle". Same shape as `src/engine/painted-fill.ts`.
//
// Adding an import here re-opens that leak through both consumers at once, and it fails silently —
// nothing breaks, the browser bundle just grows.

/** Chart types whose marks are filled AREAS, and so can carry a `series_patterns` texture. A line's
 *  2px stroke and a dot's 8px disc are smaller than the 7px hatch period, so a texture there is
 *  noise rather than a channel — reject instead of rendering something illegible. */
export const FILLED_CHART_TYPES = new Set(["bar", "stacked", "area", "histogram", "waterfall"]);
