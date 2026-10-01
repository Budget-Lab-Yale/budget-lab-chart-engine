// Treemap colour and label fitting (spec §4, §5). PURE: no DOM. Every width comes from the calibrated
// Figtree table (timelineTextWidth), so a label that fits here fits identically in the live mount, the
// PNG export and the jsdom goldens. Drawing (marks/treemap) consumes these results as-is.
import { tokens } from "../theme/tokens";
import { locateOnRamp } from "./palette";
import { timelineTextWidth } from "./timeline-text";
import { TM_GEOM } from "./treemap-layout";
import { d3 } from "./vendor";

/** Tile name sizes, largest first. The number is drawn at round(1.4 × s). */
export const TM_NAME_SIZES = [20, 17, 15, 13, 12, 11] as const;
/** The key's leading text, drawn bold (700); wrapKey's first line starts with it. */
export const TM_KEY_PREFIX = "Not labelled above:";

const LINE_HEIGHT = 1.2;
const MAX_NAME_LINES = 3;
const STRIP_TEXT = 12;
const KEY_TEXT = 12;

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

/** WCAG 2 relative luminance of a colour (an unparseable one reads as white). */
function luminance(color: string): number {
  const c = d3.color(color);
  if (!c) return 1;
  const { r, g, b } = c.rgb();
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** White or navy, whichever has the higher WCAG contrast on `fill`. Ties go to white. */
export function contrastText(fill: string): string {
  const white = tokens.structural.background;
  const navy = tokens.structural.text_heading;
  const lf = luminance(fill);
  return contrast(lf, luminance(white)) >= contrast(lf, luminance(navy)) ? white : navy;
}

export type TileLabel =
  | { mode: "stacked"; size: number; numberSize: number; nameLines: string[]; number: string | null }
  | { mode: "inline"; size: number; text: string }
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

/** Fit name (+ number unless null) into the tile's inner box (spec §5). Never truncates.
 *  `w`/`h` are the tile's full size; the inner box is 6px in from each edge.
 *  Stacked: the name wrapped at spaces (700, ≤ 3 lines) above the number (500, round(1.4 × s)).
 *  Inline: one line `text` = name + " " + number, measured as drawn — the name at 700, then " " and
 *  the number at 500, both at `size`. */
export function fitTileLabel(name: string, number: string | null, w: number, h: number): TileLabel {
  const iw = w - 2 * TM_GEOM.pad;
  const ih = h - 2 * TM_GEOM.pad;
  if (iw <= 0 || ih <= 0 || name === "") return { mode: "none" };
  for (const s of TM_NAME_SIZES) {
    const lines = wrapName(name, s, iw);
    if (!lines || lines.length > MAX_NAME_LINES) continue;
    const ns = Math.round(1.4 * s);
    if (number !== null && timelineTextWidth(number, ns, 500) > iw) continue;
    const height = lines.length * s * LINE_HEIGHT + (number !== null ? ns * LINE_HEIGHT : 0);
    if (height > ih) continue;
    return { mode: "stacked", size: s, numberSize: ns, nameLines: lines, number };
  }
  for (const s of TM_NAME_SIZES) {
    if (s * LINE_HEIGHT > ih) continue;
    const width = timelineTextWidth(name, s, 700) + (number !== null ? timelineTextWidth(` ${number}`, s, 500) : 0);
    if (width <= iw) return { mode: "inline", size: s, text: number !== null ? `${name} ${number}` : name };
  }
  return { mode: "none" };
}

export type StripLabel = { mode: "full"; name: string; share: string } | { mode: "name"; name: string } | { mode: "none" };

/** Header strip text at 12px (spec §5): name (700) + " " + share (500), else the name alone, else
 *  nothing. Judges width only; whether the block is tall enough for a strip is the caller's call. */
export function fitStripLabel(name: string, share: string, blockWidth: number): StripLabel {
  const avail = blockWidth - 2 * TM_GEOM.pad;
  const nameW = timelineTextWidth(name, STRIP_TEXT, 700);
  if (nameW + timelineTextWidth(` ${share}`, STRIP_TEXT, 500) <= avail) return { mode: "full", name, share };
  if (nameW <= avail) return { mode: "name", name };
  return { mode: "none" };
}

/** Key text entries in order: strip-less groups first ("G: 1.1%"), then unlabelled tiles ("G · Name 2.0%" / "Name 2.0%"). */
export function keyEntries(args: { groups: Array<{ name: string; share: string; strip: boolean }>;
  tiles: Array<{ group: string | null; name: string; number: string; labelled: boolean }> }): string[] {
  return [
    ...args.groups.filter((g) => !g.strip).map((g) => `${g.name}: ${g.share}`),
    ...args.tiles.filter((t) => !t.labelled)
      .map((t) => (t.group !== null ? `${t.group} · ${t.name} ${t.number}` : `${t.name} ${t.number}`)),
  ];
}

/** Wrap key entries ("Not labelled above: " + entries joined " · ") into lines of ≤ width at 12px.
 *  Breaks at spaces. Measured as drawn: TM_KEY_PREFIX at 700, everything else at 500. A single word
 *  wider than `width` takes a line of its own and overflows it (no truncation anywhere). */
export function wrapKey(entries: string[], width: number): string[] {
  if (entries.length === 0) return [];
  const text = `${TM_KEY_PREFIX} ${entries.join(" · ")}`;
  const boldEnd = TM_KEY_PREFIX.length;
  // A line is a substring of `text` starting at `start`; its bold part is whatever of the prefix it holds.
  const measure = (line: string, start: number): number => {
    const b = Math.max(0, Math.min(line.length, boldEnd - start));
    return timelineTextWidth(line.slice(0, b), KEY_TEXT, 700) + timelineTextWidth(line.slice(b), KEY_TEXT, 500);
  };
  const lines: string[] = [];
  let line = "";
  let start = 0;
  let pos = 0;
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, start) > width) {
      lines.push(line);
      line = word;
      start = pos;
    } else {
      line = next;
    }
    pos += word.length + 1;
  }
  lines.push(line);
  return lines;
}
