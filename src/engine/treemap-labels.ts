// Treemap colour and label fitting (spec §4, §5). PURE: no DOM. Every width comes from the calibrated
// Figtree table (timelineTextWidth), so a label that fits here fits identically in the live mount, the
// PNG export and the jsdom goldens. Drawing (marks/treemap) consumes these results as-is.
import { tokens } from "../theme/tokens";
import { locateOnRamp } from "./palette";
import { timelineTextWidth } from "./timeline-text";
import { TM_GEOM } from "./treemap-layout";
import { d3 } from "./vendor";

/** Label text size (px), one per chart: `wide` on a chart at least `wideAt` px wide, else `narrow`.
 *  A tile label's name (700) and number (500) are both drawn at it. */
export const TM_LABEL_SIZES = { wide: 14, narrow: 12, wideAt: 600 } as const;

/** The one label text size for a chart `chartWidth` px wide. */
export function treemapLabelSize(chartWidth: number): number {
  return chartWidth >= TM_LABEL_SIZES.wideAt ? TM_LABEL_SIZES.wide : TM_LABEL_SIZES.narrow;
}

/** Text-layout constant shared with the drawing (marks/treemap), so what is measured here is what
 *  is drawn there: line height as a factor of the font size. */
export const TM_LINE_HEIGHT = 1.2;

/** Header strip height for strip text at `size` px: TM_GEOM.stripH (22px) at 12px text, scaled with
 *  the text and rounded to a whole pixel (26px at 14px), so the text keeps its proportions in it. */
export function treemapStripHeight(size: number): number {
  return Math.round((size * TM_GEOM.stripH) / 12);
}
const MAX_NAME_LINES = 3;

// Usable tiers darkest-first. 50 is excluded (too close to the white gutters); grouped tiles stop at
// 600 because 700 is the group's header strip.
const FLAT_TIERS = ["700", "600", "500", "400", "300", "200", "100"] as const;
const GROUPED_TIERS = ["600", "500", "400", "300", "200", "100"] as const;

/** Tier for rank r of n (spec §4): flat 700→100, grouped 600→100. Returns the tier key, e.g. "500". */
export function treemapTier(rank: number, n: number, grouped: boolean): string {
  const tiers = grouped ? GROUPED_TIERS : FLAT_TIERS;
  const k = tiers.length;
  const i = Math.round((rank * (k - 1)) / Math.max(1, n - 1));
  return tiers[Math.min(k - 1, Math.max(0, i))]!;
}

/** Fill hex for a tile: tonal tier of its group's hue family, or the group's base hex when shading "none".
 *  A base on no tonal ramp (a raw `series_colors` hex) is used flat for every tile: there is no
 *  palette step to take, and mixing towards white would put an off-palette colour on the chart. */
export function tileFill(hueBase: string, rank: number, n: number, grouped: boolean, shading: "size" | "none"): string {
  if (shading === "none") return hueBase;
  const ramp = locateOnRamp(hueBase);
  if (!ramp) return hueBase;
  const scale = (tokens.scales as Record<string, Record<string, string>>)[ramp.family];
  return scale?.[treemapTier(rank, n, grouped)] ?? hueBase;
}

/** Header strip fill: the hue family's 700 tier, or the base as-is when it is off every ramp
 *  (the same rule as tileFill). */
export function stripFill(hueBase: string): string {
  const ramp = locateOnRamp(hueBase);
  if (!ramp) return hueBase;
  return (tokens.scales as Record<string, Record<string, string>>)[ramp.family]?.["700"] ?? hueBase;
}

/** CSS4 space/slash syntax (`rgb(0 0 0 / 10%)`, `hsl(0 0% 0%)`) to the comma form d3.color reads
 *  (`rgba(0, 0, 0, 0.1)`); anything else is returned as-is. */
function commaColor(color: string): string {
  const m = /^\s*(rgb|hsl)a?\(\s*([^,()]*?)\s*\)\s*$/i.exec(color);
  if (!m) return color;
  const [body, alpha] = m[2]!.split("/").map((s) => s.trim());
  const parts = body!.split(/\s+/);
  if (parts.length !== 3) return color;
  if (alpha === undefined) return `${m[1]}(${parts.join(", ")})`;
  const a = alpha.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
  return `${m[1]}a(${parts.join(", ")}, ${a})`;
}

/** WCAG 2 relative luminance of a colour as painted on the white card: a translucent fill is
 *  composited over white first. Null when the colour does not parse. */
function luminance(color: string): number | null {
  const c = d3.color(commaColor(color));
  if (!c) return null;
  const { r, g, b, opacity } = c.rgb();
  const a = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  // d3 parses "transparent" with NaN channels; at alpha 0 it is the white card whatever they are.
  const over = (v: number): number => (a === 0 ? 255 : a * v + (1 - a) * 255);
  const lin = (v0: number): number => {
    const v = over(v0);
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** White or navy, whichever has the higher WCAG contrast on `fill` (composited over white). Ties go
 *  to white; an unparseable colour gets navy. */
export function contrastText(fill: string): string {
  const white = tokens.structural.background;
  const navy = tokens.structural.text_heading;
  const lf = luminance(fill);
  if (lf === null) return navy;
  return contrast(lf, luminance(white)!) >= contrast(lf, luminance(navy)!) ? white : navy;
}

export type TileLabel =
  | { mode: "stacked"; size: number; nameLines: string[]; number: string | null }
  | { mode: "inline"; size: number; text: string; name: string; number: string }
  | { mode: "none" };

/** Greedy wrap at spaces to `width` (bold, `size`px). Null if a single word is wider than `width`. */
function wrapName(name: string, size: number, width: number): string[] | null {
  const lines: string[] = [];
  let line = "";
  for (const word of name.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (timelineTextWidth(next, size, 700) <= width) {
      line = next;
    } else {
      if (timelineTextWidth(word, size, 700) > width) return null;
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/** Fit name (+ number unless null) into the tile's inner box at exactly `size` px (spec §5); never
 *  a smaller size, never truncated. `w`/`h` are the tile's full size; the inner box is 6px in from
 *  each edge. Stacked: the name wrapped at spaces (700, ≤ 3 lines) above the number (500), all lines
 *  at `size`. Else inline: one line `text` = name + " " + number, measured as drawn — `name` at 700,
 *  then " " and `number` at 500; draw it as those two spans, not as `text` in one weight. Else none. */
export function fitTileLabel(name: string, number: string | null, w: number, h: number, size: number): TileLabel {
  const iw = w - 2 * TM_GEOM.pad;
  const ih = h - 2 * TM_GEOM.pad;
  if (iw <= 0 || ih <= 0 || name === "") return { mode: "none" };
  const lines = wrapName(name, size, iw);
  if (lines && lines.length <= MAX_NAME_LINES &&
    (number === null || timelineTextWidth(number, size, 500) <= iw) &&
    (lines.length + (number !== null ? 1 : 0)) * size * TM_LINE_HEIGHT <= ih) {
    return { mode: "stacked", size, nameLines: lines, number };
  }
  // Without a number this never fits: one line that fits already fit stacked.
  if (number !== null && size * TM_LINE_HEIGHT <= ih &&
    timelineTextWidth(name, size, 700) + timelineTextWidth(` ${number}`, size, 500) <= iw) {
    return { mode: "inline", size, text: `${name} ${number}`, name, number };
  }
  return { mode: "none" };
}

/** A tile as label fitting sees it: its text, its value, its full size. */
export interface LabelTile { name: string; number: string | null; value: number; w: number; h: number }

/** Every tile's label, in input (layout) order, all at the chart's one size (treemapLabelSize). A
 *  tile whose label does not fit at that size is unlabelled, never drawn smaller. */
export function fitTileLabels(tiles: LabelTile[], chartWidth: number): TileLabel[] {
  const size = treemapLabelSize(chartWidth);
  return tiles.map((t) => fitTileLabel(t.name, t.number, t.w, t.h, size));
}

export type StripLabel = { mode: "full"; name: string; share: string } | { mode: "name"; name: string } | { mode: "none" };

/** Header strip text at `size` px, the chart's tile label size: name (700) + " " + share (500), else
 *  the name alone, else nothing. Judges width only; whether the block is tall enough for a strip is
 *  the caller's call. */
export function fitStripLabel(name: string, share: string, blockWidth: number, size: number): StripLabel {
  const avail = blockWidth - 2 * TM_GEOM.stripPad;
  const nameW = timelineTextWidth(name, size, 700);
  if (nameW + timelineTextWidth(` ${share}`, size, 500) <= avail) return { mode: "full", name, share };
  if (nameW <= avail) return { mode: "name", name };
  return { mode: "none" };
}
