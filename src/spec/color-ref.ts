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

/** Whether `value` is a palette name: an OWN key of TBL_COLORS. `in` and plain indexing also reach
 *  Object.prototype, so "constructor", "toString" or "__proto__" passed as palette names and
 *  resolved to a function or an object (Ruling 44). Every lookup by an author's string goes
 *  through this. */
export function isPaletteName(value: string): boolean {
  return Object.hasOwn(TBL_COLORS, value);
}

// ---------------------------------------------------------------------------
// Is this a color the engine can paint?
// ---------------------------------------------------------------------------

// Observable Plot's own `isColor` (plot-0.6.16, `_o`), transcribed, then NARROWED to what a browser
// paints. Plot's test decides whether a string is painted as a constant or read as a column name, so
// nothing outside it may pass. But it is loose: `#` plus 3 to 8 hex digits, and any of these function
// names around ANY parentheses. A 5-digit hex or `rgb(foo)` reaches the SVG as written and the browser
// drops it, so a filled mark inherits the chart's `currentColor` and a line is not drawn. Hence the hex
// length and the contents of rgb()/hsl() (cssColorArgPatterns below) are checked too. Plot and d3.color
// disagree in both directions and the differences are real: Plot takes `none` / `currentcolor` /
// `var(…)` / `oklch(…)`, which d3.color rejects, and Plot's list omits `yellowgreen`, which d3.color
// accepts and which therefore BLANKS a mark. Transcribed rather than imported because this file must
// stay free of the vendored bundles (see header); it is pinned to the vendored Plot version, so
// re-check it when Plot is upgraded.
const CSS_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const CSS_FUNCTION_RE =
  /^(url|var|rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\((.*)\)$/;

// CSS Color 4 argument lists for rgb()/rgba() and hsl()/hsla() (the `a` forms are aliases), matched
// against the lowercased value. Both the legacy comma form and the modern space form, since a browser
// paints both: a legacy rgb() takes three numbers or three percentages, never a mix, and a legacy
// hsl() a hue and two percentages; the space form mixes freely, takes `none`, and puts the alpha
// after `/`. Built on first use, not at load: the browser bundle imports this file for the name table
// and never runs the check, and esbuild cannot drop a top-level `new RegExp` or template literal.
let cssColorArgs: Record<"rgb" | "hsl", RegExp[]> | undefined;
function cssColorArgPatterns(): Record<"rgb" | "hsl", RegExp[]> {
  if (cssColorArgs) return cssColorArgs;
  const ws = "[ \\t\\n\\r\\f]*";
  const gap = "[ \\t\\n\\r\\f]+";
  const num = "[+-]?(?:\\d+|\\d*\\.\\d+)(?:e[+-]?\\d+)?";
  const pct = `${num}%`;
  const hue = `${num}(?:deg|grad|rad|turn)?`;
  const alpha = `${num}%?`;
  const channel = `${num}%?|none`;
  const args = (body: string): RegExp => new RegExp(`^${ws}${body}${ws}$`);
  const commaList = (...parts: string[]): string =>
    parts.map((p) => `(?:${p})`).join(`${ws},${ws}`) + `(?:${ws},${ws}(?:${alpha}))?`;
  const spaceList = (...parts: string[]): string =>
    parts.map((p) => `(?:${p})`).join(gap) + `(?:${ws}/${ws}(?:${alpha}|none))?`;
  return (cssColorArgs = {
    rgb: [
      args(commaList(num, num, num)),
      args(commaList(pct, pct, pct)),
      args(spaceList(channel, channel, channel)),
    ],
    hsl: [args(commaList(hue, pct, pct)), args(spaceList(`${hue}|none`, channel, channel))],
  });
}

/** Whether the contents of `rgb(…)` / `hsl(…)` (or their `a` aliases) are a CSS argument list a
 *  browser paints. A nested function (`var()`, `calc()`) or a relative color (`rgb(from …)`) is
 *  passed unchecked: both are valid CSS this grammar does not model, and rejecting them would fail a
 *  spec that renders. */
function cssColorArgsOk(fn: "rgb" | "hsl", body: string): boolean {
  // A CSS comment separates tokens like whitespace does.
  const args = body.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (args.includes("(") || /^[ \t\n\r\f]*from[ \t\n\r\f]/.test(args)) return true;
  return cssColorArgPatterns()[fn].some((re) => re.test(args));
}
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
  if (CSS_HEX_RE.test(v) || CSS_NAMED.has(v)) return true;
  const fn = CSS_FUNCTION_RE.exec(v);
  if (!fn) return false;
  const name = fn[1] as string;
  const body = fn[2] as string;
  if (name === "rgb" || name === "rgba") return cssColorArgsOk("rgb", body);
  if (name === "hsl" || name === "hsla") return cssColorArgsOk("hsl", body);
  return true;
}

/** True when a spec's color reference resolves to something paintable: a palette name, or a CSS
 *  color the engine passes through untouched. */
export function isColorRef(value: string): boolean {
  return isPaletteName(value) || isCssColor(value);
}

// d3-color's `color()` parser (d3 7.9.0), transcribed: the grammar the engine READS a colour with.
// Deriving a hatch band walks the ground's tonal ramp, and every step of that (`lightness`,
// `shiftLightness` in engine/palette.ts) starts from `d3.color(ground)`. When that returns null the
// band comes back equal to the ground and `resolveHatch` throws, so this grammar is the rule a hatch
// ground has to meet, and the validator applies it rather than an approximation. Transcribed, not
// imported, for the reason in the header; `test/hatch-ground-agreement.test.ts` holds it to the real
// `d3.color` string by string, so a d3 upgrade cannot quietly reopen the validate-yes/render-no gap.
const D3_INT = "\\s*([+-]?\\d+)\\s*";
const D3_NUM = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*";
const D3_PCT = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*";
// Built on first use, like cssColorArgPatterns above and for the same reason.
let d3FunctionRes: RegExp[] | undefined;
const d3FunctionPatterns = (): RegExp[] =>
  (d3FunctionRes ??= [
    new RegExp(`^rgb\\(${D3_INT},${D3_INT},${D3_INT}\\)$`),
    new RegExp(`^rgb\\(${D3_PCT},${D3_PCT},${D3_PCT}\\)$`),
    new RegExp(`^rgba\\(${D3_INT},${D3_INT},${D3_INT},${D3_NUM}\\)$`),
    new RegExp(`^rgba\\(${D3_PCT},${D3_PCT},${D3_PCT},${D3_NUM}\\)$`),
    new RegExp(`^hsl\\(${D3_NUM},${D3_PCT},${D3_PCT}\\)$`),
    new RegExp(`^hsla\\(${D3_NUM},${D3_PCT},${D3_PCT},${D3_NUM}\\)$`),
  ]);

/** Whether `d3.color` parses `value`: a hex of 3, 4, 6 or 8 digits; comma-separated `rgb()` with
 *  whole-number or all-percentage channels, `rgba()` the same plus an alpha; comma-separated `hsl()` /
 *  `hsla()` with a unitless hue; a CSS colour name; or `transparent`. Not the space-separated forms,
 *  not `none` / `currentColor`, not the modern functions. d3's name table is Plot's minus `none`,
 *  `currentcolor` and `transparent` (which d3 matches on its own), plus `yellowgreen`. */
export function isReadableColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (CSS_HEX_RE.test(v) || d3FunctionPatterns().some((re) => re.test(v))) return true;
  return (CSS_NAMED.has(v) && v !== "currentcolor" && v !== "none") || v === "yellowgreen";
}

/** The subset of `isColorRef` that a HATCH can be grounded over — narrower, because PAINTING a colour
 *  and READING one are different jobs done by different code.
 *
 *  Plot paints `oklch(…)`, `lab(…)`, `color-mix(…)`, `var(…)`, `currentColor`, `none` and the
 *  space-separated `rgb(0 114 178)`, so `isColorRef` admits them all. Deriving a hatch band means
 *  parsing the ground (`isReadableColor`), and d3-color returns null for every one of those, so a spec
 *  pairing `series_patterns` with one validated clean and then THREW at render.
 *
 *  Scope: only consulted for values `isColorRef` already admits. `yellowgreen` is groundable but not in
 *  Plot's table, so it is refused earlier and never reaches here. */
export function isHatchGroundable(value: string): boolean {
  // A palette name resolves to a hex before any hatch is derived, so the name itself is groundable.
  return isPaletteName(value) || isReadableColor(value);
}

/** The error for a texture over a ground the band deriver cannot read. */
export function hatchGroundError(where: string, series: string, value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  // A value the engine cannot even PAINT is `colorRefError`'s to report, with the better message.
  if (!isColorRef(value) || isHatchGroundable(value)) return null;
  return (
    `${where}: ${JSON.stringify(value)} cannot carry a \`series_patterns\` texture. The hatch band is ` +
    `derived by walking the ground's own tonal ramp, which needs a colour the engine can PARSE, so ` +
    `series ${JSON.stringify(series)} would fail at render. Readable: a palette name (blue, blue-500), ` +
    `a hex, comma-separated rgb() with whole-number or all-percentage channels ("rgb(0,114,178)"), ` +
    `or comma-separated hsl() with a unitless hue ("hsl(200,50%,40%)"). Paintable but not readable: ` +
    `modern CSS syntaxes (oklch, lab, color-mix, …), the space-separated rgb()/hsl() forms, ` +
    `\`currentColor\`.`
  );
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
