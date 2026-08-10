// Shared, versioned browser assets: one copy of the runtime and stylesheet for a whole site,
// instead of inlining both into every page. Two invariants, either of which breaks
// already-published pages if violated:
//
//   1. Filenames carry the engine version, because a page published against 1.9.0 asks for
//      engine-1.9.0.js forever. Changing an asset's contents therefore needs a version bump.
//   2. Pages reference assets by RELATIVE URL, which is what keeps a built page working from
//      `file://` (how the thumbnail screenshotter loads it) and under a /pr-preview/pr-N/ prefix.
//
// The font stays a base64 @font-face, now inside the shared stylesheet rather than duplicated into
// every page. A separate font file would be smaller still, but fonts are always fetched in CORS
// mode and a `file://` page has a null origin, so Chromium blocks the request — which would leave
// thumbnails and any saved-to-disk page rendering in a fallback face. A `data:` URL is exempt, so
// this keeps one copy per site AND identical rendering over http:// and file://.

import { FIGTREE_FONT_FACE } from "./assets.js";

/** Filename of the shared browser runtime (the IIFE bundle) for a given engine version. */
export function runtimeAssetName(version: string): string {
  return `engine-${version}.js`;
}

/** Filename of the shared stylesheet (chart CSS + the font) for a given engine version. */
export function stylesAssetName(version: string): string {
  return `chart-${version}.css`;
}

export interface SharedAssetRefs {
  /** URL the page uses for the runtime <script src>. */
  runtime: string;
  /** URL the page uses for the stylesheet <link href>. */
  styles: string;
}

/**
 * Join an asset base prefix and a filename with exactly one separating slash. An empty base
 * yields the bare filename (assets sitting beside the page).
 */
export function joinAssetUrl(base: string, name: string): string {
  if (base === "") return name;
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
}

/** The URLs a page needs, given the base prefix its assets live under. */
export function sharedAssetRefs(base: string, version: string): SharedAssetRefs {
  return {
    runtime: joinAssetUrl(base, runtimeAssetName(version)),
    styles: joinAssetUrl(base, stylesAssetName(version)),
  };
}

/** The full contents of the shared stylesheet: the font's @font-face, then the chart CSS. */
export function buildSharedStylesheet(css: string): string {
  return `${FIGTREE_FONT_FACE}\n${css}`;
}
