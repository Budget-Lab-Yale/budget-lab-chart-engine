// Programmatic render hooks. NOT part of the spec: these are functions, and the publishing
// pipeline JSON-serialises spec + rows into the standalone HTML (src/cli/index.ts →
// buildStandaloneHtml), so a function cannot cross that boundary. They are for consumers that
// call mountChart / renderChart themselves.
//
// Every hook returns null for "engine default", so a caller can hook one case and leave the rest
// alone — and so passing `hooks: {}` renders byte-identically to passing nothing.
//
// The STATIC hooks (legendKey, tickLabel, valueLabel, afterRender) are guaranteed to be CALLED
// identically on screen and in the PNG export, because the export re-renders through the same
// builders with the same hooks object. `tickLabel`/`valueLabel` return plain text, so "called
// identically" also means "renders identically". `legendKey` returns MARKUP, and the two call
// sites are different media (live: an HTML button; export: an SVG <g>, rasterised via
// XMLSerializer -> Image -> canvas — see export-png.ts's rasterize()) — HTML nodes inside that
// SVG do not paint. `ctx.medium` tells the hook which vocabulary is safe to return; a hook that
// ignores it and always returns HTML will look right on screen and be silently missing from the
// download, which is the exact failure #30 exists to eliminate. `tooltip` is SCREEN-ONLY: a
// static PNG has no hover state, so there is nothing for it to be identical to.
//
// This file is a leaf: it imports nothing from `src/engine/*`, so `src/spec/*` stays a leaf layer
// (`grep -rn 'from "\.\./engine' src/spec/` must stay empty). A ctx field that would otherwise
// want an engine type restates its shape structurally instead.
import type { ValueAffixes } from "./types";

/** Screen-only (see module note above) — a static PNG has no hover state to be identical to.
 *  The hovered category's per-series values, plus the engine's own rendered card markup so a
 *  hook can wrap rather than replace it. `total` is present for stacked charts' Total row. */
export interface TooltipHookCtx {
  category: string;
  series: string[];
  facet?: string;
  values: Record<string, number>;
  total?: number;
  rendered: string;
}

/** One legend row. `rendered` is the engine's own key markup for THIS row, in `medium`'s
 *  vocabulary, so a hook can wrap rather than replace it. `color` is `undefined` for a row with
 *  no colour of its own — e.g. a cumulative stack's Total row, whose dot draws the neutral `net`
 *  ink instead — matching `LegendItem.color` (engine/index.ts), which the declared `string` here
 *  did not.
 *
 *  A RETURNED string must be written for `medium`, not merely echo `rendered` unchanged and hope:
 *  `"html"` (the live legend, an HTML button — `<span>`, `<b>`, etc. are fine) and `"svg"` (the
 *  PNG export's flat SVG — HTML elements are silently invisible there; return `<text>`/`<g>`/etc.
 *  in the SVG vocabulary, as `rendered` itself already is when `medium === "svg"`). Get this wrong
 *  and the row is correct on screen and missing from the download — invisible to anyone who only
 *  checks the screen, which is why this is spelled out rather than left to be discovered. */
export interface LegendKeyHookCtx {
  series: string;
  label: string;
  color: string | undefined;
  /** Which vocabulary `rendered` is written in, and which a RETURNED string must use too. */
  medium: "html" | "svg";
  rendered: string;
}

/** One axis's tick set, as passed to the engine's own formatter. `axis` names the
 *  quantitative/value axis this call is formatting — "y" for a vertical chart's value axis and
 *  for a horizontal chart's value axis too, even though a horizontal chart draws it along the
 *  screen's x direction (see assemble-plot.ts, where every `makeTickFormatter` call site formats
 *  `yTicks`/`valueAffixes` regardless of orientation). There is no genuine categorical/temporal
 *  "x tick" numeric formatter in the engine today; the "x" arm exists so this ctx does not need
 *  reshaping if one is added later. */
export interface TickLabelHookCtx {
  axis: "x" | "y";
  ticks: number[];
  affixes: ValueAffixes;
}

/** One in-mark value label (e.g. a stacked-bar segment's in-bar number). `rendered` is the
 *  engine's own formatted text. */
export interface ValueLabelHookCtx {
  series: string;
  category: string;
  value: number;
  facet?: string;
  rendered: string;
}

/** `phase` distinguishes the live mount from a PNG export re-render, so a consumer can do
 *  something only on screen (e.g. a live badge) or only in the download (e.g. a watermark).
 *  `facet` is set when called per-pane on a small-multiples figure. */
export interface AfterRenderCtx {
  phase: "live" | "export";
  facet?: string;
}

/** Programmatic render hooks — the tier above `chrome`'s declarative switches, for consumers
 *  calling `mountChart`/`renderChart` themselves (see module note above for why they can't reach
 *  CLI-published figures). Every field is optional; `hooks: {}` renders byte-identically to
 *  passing no `hooks` at all. */
export interface RenderHooks {
  /** Screen-only — see `TooltipHookCtx`. Replaces a band tooltip's content; the engine keeps
   *  hit-testing, positioning and the band highlight. */
  tooltip?: (ctx: TooltipHookCtx) => string | null;
  /** Replaces one legend row's key markup. */
  legendKey?: (ctx: LegendKeyHookCtx) => string | null;
  /** Rewrites one axis tick's text (e.g. thousands separators). Identical on screen and export. */
  tickLabel?: (value: number, ctx: TickLabelHookCtx) => string | null;
  /** Replaces one in-mark value label's text. Identical on screen and export. */
  valueLabel?: (ctx: ValueLabelHookCtx) => string | null;
  /** Escape hatch: runs against the assembled SVG, on both the live and export paths (`ctx.phase`
   *  distinguishes them). Mutates in place; returns nothing. */
  afterRender?: (svg: SVGSVGElement, ctx: AfterRenderCtx) => void;
}
