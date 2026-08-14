// What counts as a COLOR in a spec — the palette name table, plus the check that rejects a value
// the engine cannot paint.
//
// KEEP THIS FILE FREE OF `./vendor` (d3/Plot) AND OF `./validate`. It is imported from BOTH sides:
// `engine/palette.ts` takes the name table from here, and `spec/validate.ts` takes the check. Adding
// a d3 import would drag the 674 KB vendored Plot+d3 pair into `dist/spec/index.js` (a Node library
// entry that today is 46 KB and has no other use for them); importing `./validate` would drag Ajv
// into the browser bundle through palette.ts. Same shape, and the same reason, as
// `src/spec/filled-chart-types.ts` — see its header.
//
// WHY THE CHECK EXISTS: `resolveColor` returns an unknown name unchanged, and that string reaches
// Plot as a CONSTANT fill/stroke. Plot decides constant-vs-channel with its own `isColor`; a string
// that fails it is read as a COLUMN NAME, the channel resolves all-undefined, and the marks are
// DROPPED. A one-character typo in `bar_color` therefore publishes a chart frame with no bars in it,
// and every layer above stays quiet — `validateSpec` returned `valid: true`. 1.11.0 sharpened this
// by adding the 8 tonal tiers: `blue-800`, `blue-250` and `sky-300` are now plausible-looking names
// that do not exist.
import { tokens } from "../theme/tokens";

// Named colors config authors may use for `series_colors` (e.g. "blue", "amber-light",
// "navy", "black"). Built from the categorical hues + their light variants + the
// Style-Guide naming aliases (purple→violet, etc.) + a few structural neutrals.
const NAMED: Record<string, string> = {};
for (const c of tokens.categorical) {
  NAMED[c.key] = c.base;
  NAMED[`${c.key}-light`] = c.light;
}
for (const [alias, canonical] of Object.entries(tokens.aliases)) {
  const base = NAMED[canonical];
  const light = NAMED[`${canonical}-light`];
  if (base) NAMED[alias] = base;
  if (light) NAMED[`${alias}-light`] = light;
}
// Every TONAL TIER by name (`blue-200`, `violet-700`, …), for each hue and each of its aliases.
// The tiers are what a same-hue pair is built from — two steps apart on one ramp is the Style-Guide
// way to relate two related series — and without names an author had to paste the hex, which says
// nothing about which ramp or which step it is.
for (const [family, scale] of Object.entries(tokens.scales as Record<string, Record<string, string>>)) {
  const aliases = Object.entries(tokens.aliases)
    .filter(([, canonical]) => canonical === family)
    .map(([alias]) => alias);
  for (const [tier, hex] of Object.entries(scale)) {
    NAMED[`${family}-${tier}`] = hex;
    for (const alias of aliases) NAMED[`${alias}-${tier}`] = hex;
  }
}

NAMED.black = tokens.structural.mark_black;
NAMED.grey = tokens.structural.text_muted;
NAMED.gray = tokens.structural.text_muted;
NAMED.navy = tokens.brand.navy;
NAMED.sky = tokens.brand.sky;

export const TBL_COLORS: Readonly<Record<string, string>> = NAMED;

// ---------------------------------------------------------------------------
// Is this a color the engine can paint?
// ---------------------------------------------------------------------------

// Observable Plot's own `isColor` (plot-0.6.16, `_o`), transcribed. This is the gate that decides
// whether a string is painted as a constant or read as a column name, so it — not d3.color — is the
// ground truth for "will this render". The two disagree in both directions and the differences are
// real: Plot takes `none` / `currentcolor` / `var(…)` / `oklch(…)`, which d3.color rejects, and Plot's
// list omits `yellowgreen`, which d3.color accepts and which therefore BLANKS a mark. Transcribed
// rather than imported because this file must stay free of the vendored bundles (see header); it is
// pinned to the vendored Plot version, so re-check it when Plot is upgraded.
const CSS_HEX_RE = /^#[0-9a-f]{3,8}$/;
const CSS_FUNCTION_RE =
  /^(?:url|var|rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(.*\)$/;
// Both @__PURE__ marks are load-bearing, and BOTH are needed (the `new Set` and the `.split` are
// separate calls): they let esbuild drop these 147 names from the browser bundle, which imports the
// table above from this file but never the check. Verified — the names appear in dist/embed/live.js
// three times (d3's and Plot's own copies) and not a fourth.
const CSS_NAMED = /* @__PURE__ */ new Set(
  /* @__PURE__ */ ("none,currentcolor,transparent,aliceblue,antiquewhite,aqua,aquamarine,azure,beige,bisque," +
    "black,blanchedalmond,blue,blueviolet,brown,burlywood,cadetblue,chartreuse,chocolate,coral," +
    "cornflowerblue,cornsilk,crimson,cyan,darkblue,darkcyan,darkgoldenrod,darkgray,darkgreen," +
    "darkgrey,darkkhaki,darkmagenta,darkolivegreen,darkorange,darkorchid,darkred,darksalmon," +
    "darkseagreen,darkslateblue,darkslategray,darkslategrey,darkturquoise,darkviolet,deeppink," +
    "deepskyblue,dimgray,dimgrey,dodgerblue,firebrick,floralwhite,forestgreen,fuchsia,gainsboro," +
    "ghostwhite,gold,goldenrod,gray,green,greenyellow,grey,honeydew,hotpink,indianred,indigo," +
    "ivory,khaki,lavender,lavenderblush,lawngreen,lemonchiffon,lightblue,lightcoral,lightcyan," +
    "lightgoldenrodyellow,lightgray,lightgreen,lightgrey,lightpink,lightsalmon,lightseagreen," +
    "lightskyblue,lightslategray,lightslategrey,lightsteelblue,lightyellow,lime,limegreen,linen," +
    "magenta,maroon,mediumaquamarine,mediumblue,mediumorchid,mediumpurple,mediumseagreen," +
    "mediumslateblue,mediumspringgreen,mediumturquoise,mediumvioletred,midnightblue,mintcream," +
    "mistyrose,moccasin,navajowhite,navy,oldlace,olive,olivedrab,orange,orangered,orchid," +
    "palegoldenrod,palegreen,paleturquoise,palevioletred,papayawhip,peachpuff,peru,pink,plum," +
    "powderblue,purple,rebeccapurple,red,rosybrown,royalblue,saddlebrown,salmon,sandybrown," +
    "seagreen,seashell,sienna,silver,skyblue,slateblue,slategray,slategrey,snow,springgreen," +
    "steelblue,tan,teal,thistle,tomato,turquoise,violet,wheat,white,whitesmoke,yellow").split(","),
);

/** True when the value is a CSS color Plot will paint as a constant (rather than read as a column
 *  name). Palette names are NOT included — resolve those first. */
function isCssColor(value: string): boolean {
  const v = value.toLowerCase().trim();
  return CSS_HEX_RE.test(v) || CSS_FUNCTION_RE.test(v) || CSS_NAMED.has(v);
}

/** True when a spec's color reference resolves to something paintable: a palette name, or a CSS
 *  color the engine passes through untouched. */
export function isColorRef(value: string): boolean {
  return value in TBL_COLORS || isCssColor(value);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Levenshtein distance. Only ever runs on the error path (once per rejected value, over ~350 short
 *  names), so the naive two-row matrix is fine. */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j] as number;
  }
  return prev[b.length] as number;
}

/** The palette name (or CSS keyword) closest to `value`, when one is within two edits. */
function nearestName(value: string): string | null {
  const v = value.toLowerCase();
  let best: string | null = null;
  let bestD = 3;
  for (const name of [...Object.keys(TBL_COLORS), ...CSS_NAMED]) {
    const d = editDistance(v, name);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** Tier names a hue family actually ships, in the documented order. */
function tiersOf(family: string): string[] | null {
  const canonical = (tokens.aliases as Record<string, string>)[family] ?? family;
  const scale = (tokens.scales as Record<string, Record<string, string>>)[canonical];
  return scale ? Object.keys(scale) : null;
}

/** A hint pointed at the likeliest mistake, or "" when nothing is obvious. The tier case gets its own
 *  branch because it is the one 1.11.0 created: `blue` and `blue-400` both exist, so `blue-450` looks
 *  like a name rather than a guess. */
function suggestion(value: string): string {
  const tierForm = /^([A-Za-z]+)-(\d+)$/.exec(value);
  if (tierForm) {
    const tiers = tiersOf(tierForm[1] as string);
    if (tiers) {
      return ` "${tierForm[1]}" ships tiers ${tiers.join(" ")} — there is no ${value}.`;
    }
  }
  const near = nearestName(value);
  return near ? ` Did you mean "${near}"?` : "";
}

/**
 * An error for a color-valued spec field whose value the engine cannot paint, or null when it can.
 *
 * `where` names the field as the author wrote it (`series_colors["gdp"]`, `annotations.bands[2].color`).
 * An absent value is fine everywhere (every color field is optional); an EMPTY one is not — `""` is
 * not a color, and on the `??` call sites (bar_color, the waterfall colors) it reaches Plot exactly
 * like an unknown name does and blanks the marks.
 */
export function colorRefError(where: string, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null; // wrong type — the JSON schema already said so
  if (value.trim() === "") {
    return `${where}: color is empty — omit the field to take the default`;
  }
  if (isColorRef(value)) return null;
  return (
    `${where}: ${JSON.stringify(value)} is not a known color name or a CSS color — an unresolvable ` +
    `name is read as a data COLUMN, so the marks it colors are dropped and the figure renders empty.` +
    `${suggestion(value)} Use a palette name (blue, amber, …), a tonal tier (blue-500), or a CSS ` +
    `color ("#1A1A2E")`
  );
}

/** `barStack.mono.base` is not a color reference but a HUE key: the mono stack pulls that hue's whole
 *  tonal scale, so a hex (or any name off the seven categorical ramps) has no scale to pull and
 *  `monoScale` throws mid-render. Mirrors that throw's wording. */
export function monoBaseError(where: string, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  if (tiersOf(value)) return null;
  const families = Object.keys(tokens.scales).join(", ");
  const aliases = Object.keys(tokens.aliases).join(", ");
  return (
    `${where}: ${JSON.stringify(value)} is not a known categorical hue — a mono stack is built from a ` +
    `hue's tonal scale, so a raw color has no scale to pull. Expected one of: ${families} ` +
    `(or a Style-Guide alias: ${aliases})`
  );
}
