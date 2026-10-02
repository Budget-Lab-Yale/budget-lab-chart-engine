// Treemap colour and label fitting (spec §4, §5). PURE: no DOM. Every width comes from the calibrated
// Figtree table (timelineTextWidth), so a label that fits here fits identically in the live mount, the
// PNG export and the jsdom goldens. Drawing (marks/treemap) consumes these results as-is.
import { tokens } from "../theme/tokens";
import { locateOnRamp } from "./palette";
import { timelineTextWidth } from "./timeline-text";
import { TM_GEOM } from "./treemap-layout";
import { d3 } from "./vendor";

/** Tile label sizes (px). A label's name (700) and number (500) are drawn at the same size, and the
 *  size is chosen per chart, never per tile alone (fitTileLabels). "uniform": one size for every tile,
 *  `uniformWide` on a chart at least `uniformWideAt` wide, else `uniformNarrow`. "stepped": two sizes,
 *  `steppedLarge` for the largest tiles, `steppedSmall` for the rest. */
export const TM_LABEL_SIZES = { uniformWide: 14, uniformNarrow: 12, uniformWideAt: 600, steppedLarge: 18, steppedSmall: 13 } as const;
/** Chart-level label sizing. INTERNAL: an A/B switch (RenderOptions.treemapSizing), not in the spec. */
export type TreemapSizing = "uniform" | "stepped";
/** The key's leading text, drawn bold (700); wrapKey's first line starts with it. */
export const TM_KEY_PREFIX = "Not labelled above:";

/** Text-layout constants shared with the drawing (marks/treemap), so what is measured here is what
 *  is drawn there. Line height is a factor of the font size. */
export const TM_LINE_HEIGHT = 1.2;
export const TM_STRIP_TEXT = 12;
export const TM_KEY_TEXT = 12;
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
  | { mode: "inline"; size: number; text: string; name: string; number: string | null }
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

/** A tile as label sizing sees it: its text, its value (for "stepped"), its full size. */
export interface LabelTile { name: string; number: string | null; value: number; w: number; h: number }

/** Every tile's label, in input (layout) order, sized per chart so that size never misleads:
 *  - "uniform": every tile at one size, TM_LABEL_SIZES.uniformWide on a chart at least
 *    uniformWideAt px wide, else uniformNarrow. A tile whose label does not fit is unlabelled.
 *  - "stepped": tiles by value, largest first (ties: input order). The longest run of them that
 *    each fit at steppedLarge take it; every tile after the first that does not uses steppedSmall,
 *    or is unlabelled if it does not fit at that either. So no tile has smaller text than a tile of
 *    smaller value. */
export function fitTileLabels(tiles: LabelTile[], chartWidth: number, sizing: TreemapSizing): TileLabel[] {
  const fit = (t: LabelTile, size: number): TileLabel => fitTileLabel(t.name, t.number, t.w, t.h, size);
  const S = TM_LABEL_SIZES;
  if (sizing === "uniform") {
    const size = chartWidth >= S.uniformWideAt ? S.uniformWide : S.uniformNarrow;
    return tiles.map((t) => fit(t, size));
  }
  const order = tiles.map((_, i) => i).sort((a, b) => tiles[b]!.value - tiles[a]!.value || a - b);
  const out: TileLabel[] = new Array(tiles.length);
  let large = true;
  for (const i of order) {
    if (large) {
      const l = fit(tiles[i]!, S.steppedLarge);
      if (l.mode !== "none") {
        out[i] = l;
        continue;
      }
      large = false;
    }
    out[i] = fit(tiles[i]!, S.steppedSmall);
  }
  return out;
}

export type StripLabel = { mode: "full"; name: string; share: string } | { mode: "name"; name: string } | { mode: "none" };

/** Header strip text at 12px (spec §5): name (700) + " " + share (500), else the name alone, else
 *  nothing. Judges width only; whether the block is tall enough for a strip is the caller's call. */
export function fitStripLabel(name: string, share: string, blockWidth: number): StripLabel {
  const avail = blockWidth - 2 * TM_GEOM.stripPad;
  const nameW = timelineTextWidth(name, TM_STRIP_TEXT, 700);
  if (nameW + timelineTextWidth(` ${share}`, TM_STRIP_TEXT, 500) <= avail) return { mode: "full", name, share };
  if (nameW <= avail) return { mode: "name", name };
  return { mode: "none" };
}

/** Key text entries in order: strip-less groups first ("Other spending: 1.1%"), then unlabelled tiles
 *  ("Medicare (Mandatory) 2.0%" grouped, "Education 2.0%" flat). */
export function keyEntries(args: { groups: Array<{ name: string; share: string; strip: boolean }>;
  tiles: Array<{ group: string | null; name: string; number: string; labelled: boolean }> }): string[] {
  return [
    ...args.groups.filter((g) => !g.strip).map((g) => `${g.name}: ${g.share}`),
    ...args.tiles.filter((t) => !t.labelled)
      .map((t) => (t.group !== null ? `${t.name} (${t.group}) ${t.number}` : `${t.name} ${t.number}`)),
  ];
}

/** Wrap key entries into lines of ≤ width at 12px. Line 0 opens with TM_KEY_PREFIX, one atomic unit
 *  drawn (and measured) at 700; everything else is measured at 500. Whole entries follow, joined by
 *  " · " while they fit; at a break the separator is dropped, so no line starts or ends with it. Only
 *  an entry wider than a whole line breaks, at its own spaces, starting on a fresh line; a single word
 *  wider than a whole line is cut into chunks that each fit (no hyphen is added). Nothing is
 *  truncated. Only the atomic prefix can overflow, and only at a width below its own (~110px). */
export function wrapKey(entries: string[], width: number): string[] {
  if (entries.length === 0) return [];
  const lines: string[] = [];
  const fits = (text: string): boolean => {
    const bold = lines.length === 0 ? TM_KEY_PREFIX : "";
    return timelineTextWidth(bold, TM_KEY_TEXT, 700) + timelineTextWidth(text.slice(bold.length), TM_KEY_TEXT, 500) <= width;
  };
  /** Starts `word` on a fresh line. A word wider than the line is cut, by code point, into the
   *  longest chunks that fit (at least one character each); the last chunk is returned as the
   *  line in progress. */
  const hardBreak = (word: string): string => {
    let rest = Array.from(word);
    while (rest.length > 1 && !fits(rest.join(""))) {
      let n = 1;
      while (n < rest.length - 1 && fits(rest.slice(0, n + 1).join(""))) n++;
      lines.push(rest.slice(0, n).join(""));
      rest = rest.slice(n);
    }
    return rest.join("");
  };
  let line = TM_KEY_PREFIX;
  for (const entry of entries) {
    const next = `${line}${lines.length === 0 && line === TM_KEY_PREFIX ? " " : " · "}${entry}`;
    if (fits(next)) {
      line = next;
      continue;
    }
    lines.push(line);
    if (fits(entry)) {
      line = entry;
      continue;
    }
    // Wider than a whole line: wrap the entry at its own spaces, from this fresh line.
    line = "";
    for (const word of entry.split(" ")) {
      const joined = line ? `${line} ${word}` : word;
      if (fits(joined)) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = hardBreak(word);
    }
  }
  lines.push(line);
  return lines;
}
