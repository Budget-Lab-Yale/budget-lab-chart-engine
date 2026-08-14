// Categorical palette + color-name resolution, driven by the generated tokens.
//
// Slots 1-7 are the categorical base hues (in `position` order). Slots 8-14 reuse the
// derived light tier of the same hue (two tonal steps lighter), so a 9th series is a
// lighter blue, a 10th a lighter amber, etc. The light tier is computed in
// sync-theme.mjs from each hue's tonal scale — see theme/tokens.ts.
import { tokens } from "../theme/tokens";
import { d3 } from "./vendor";

const BASE = tokens.categorical.map((c) => c.base);
const LIGHT = tokens.categorical.map((c) => c.light);

/** N palette colors: base hues first, then the light tier of the same hues. */
export function tblColorScale(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i < BASE.length) {
      out.push(BASE[i] as string);
    } else {
      out.push(LIGHT[(i - BASE.length) % LIGHT.length] as string);
    }
  }
  return out;
}

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

/** A known color name → its hex; anything else (a raw "#hex" or unknown) is returned
 * unchanged. Undefined/empty passes through so callers can `?? fallback`. */
export function resolveColor(value: string | undefined): string | undefined {
  if (!value) return value;
  return TBL_COLORS[value] ?? value;
}

/** `resolveColor` with a default: the shape almost every caller wants, since a color ref is
 *  optional nearly everywhere in the spec. Relies on resolveColor's contract — a raw "#hex" or an
 *  unknown name comes back unchanged, undefined/empty comes back falsy — so this is the whole rule. */
export function resolveColorOr(value: string | undefined, fallback: string): string {
  return resolveColor(value) || fallback;
}

// Every tonal tier, LIGHTEST-first, so a positive step along the array is a step darker.
const TONAL_TIERS = ["50", "100", "200", "300", "400", "500", "600", "700"] as const;

/** Reverse lookup from a tonal-scale hex back onto its ramp: which hue family it belongs to, that
 *  family's tiers lightest-first, and this hex's index within them. Lets a caller that has only a
 *  resolved colour (the engine resolves everything to hex before it reaches the marks) step along
 *  the same hue instead of guessing in colour space — see hatch.ts `defaultHatchStroke`.
 *  Keyed upper-case; the generated tokens are upper-case hex. */
export const TONAL_BY_HEX: ReadonlyMap<string, { family: string; tiers: string[]; index: number }> =
  (() => {
    const m = new Map<string, { family: string; tiers: string[]; index: number }>();
    for (const [family, scale] of Object.entries(
      tokens.scales as Record<string, Record<string, string>>,
    )) {
      const tiers = TONAL_TIERS.map((t) => scale[t]).filter((hex): hex is string => !!hex);
      tiers.forEach((hex, index) => {
        // First writer wins: a hex shared between two ramps keeps its first family, which is
        // arbitrary but deterministic.
        if (!m.has(hex.toUpperCase())) m.set(hex.toUpperCase(), { family, tiers, index });
      });
    }
    return m;
  })();

/** Which hue ramp a non-tier colour belongs to. The canonical categorical hues and their `-light`
 *  variants are NEAR-MISSES for their own tiers (`blue` is #0072B2; `blue-400` is #0070AF), so an
 *  exact-hex lookup finds nothing for exactly the colours authors name most often. `navy` and `sky`
 *  are brand blues with no ramp of their own, so they borrow blue's. */
const FAMILY_BY_HEX: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of tokens.categorical) {
    m.set(c.base.toUpperCase(), c.key);
    m.set(c.light.toUpperCase(), c.key);
  }
  m.set(tokens.brand.navy.toUpperCase(), "blue");
  m.set(tokens.brand.sky.toUpperCase(), "blue");
  return m;
})();

/** A colour's position on a tonal ramp: the hue family, that family's tiers lightest-first, and the
 *  index of the tier this colour sits AT or nearest to in L*.
 *
 *  Locating by lightness rather than by exact hex is the point: it covers the tiers, the canonical
 *  hues, their `-light` variants, and the brand blues with one rule. Returns null for a colour on no
 *  ramp (a neutral, or a raw `#hex`), which callers handle perceptually instead. */
export function locateOnRamp(
  hex: string,
): { family: string; tiers: string[]; index: number } | null {
  const key = hex.toUpperCase();
  const exact = TONAL_BY_HEX.get(key);
  if (exact) return exact;
  const family = FAMILY_BY_HEX.get(key);
  if (!family) return null;
  const scale = (tokens.scales as Record<string, Record<string, string>>)[family];
  if (!scale) return null;
  // NOT guaranteed eight long: the filter drops any tier this family doesn't ship, so a returned
  // index is only meaningful against `tiers.length`, never against TONAL_TIERS. A type predicate
  // rather than the old `map(… as string).filter(Boolean)`, whose cast let that shortness reach
  // hatch.ts as an undefined colour.
  const tiers = TONAL_TIERS.map((t) => scale[t]).filter((hex): hex is string => !!hex);
  const target = lightness(hex);
  if (target == null) return null;
  let index = 0;
  for (let i = 1; i < tiers.length; i++) {
    const best = lightness(tiers[index] as string) ?? 0;
    const here = lightness(tiers[i] as string) ?? 0;
    if (Math.abs(here - target) < Math.abs(best - target)) index = i;
  }
  return { family, tiers, index };
}

/** CIE L* of a colour, or null if it doesn't parse. */
export function lightness(hex: string): number | null {
  const c = d3.color(hex);
  return c ? d3.lab(c).l : null;
}

/** Shift a colour's L* by `delta`, keeping its hue and chroma. For colours off every ramp, where
 *  there is no palette step to take. */
export function shiftLightness(hex: string, delta: number): string {
  const c = d3.color(hex);
  if (!c) return hex;
  const lab = d3.lab(c);
  const shifted = d3.lab(Math.max(0, Math.min(100, lab.l + delta)), lab.a, lab.b);
  return d3.rgb(shifted).formatHex();
}

// The 7 usable tiers, darkest-first (skip tier 50 per spec).
const MONO_TIERS = ["700", "600", "500", "400", "300", "200", "100"] as const;

/**
 * Returns `n` hex strings from a hue's tonal scale, darkest-first (bottom-of-stack →
 * top-of-stack). Intended for monochromatic stacked bars.
 *
 * - `base` may be a canonical hue key (`blue`, `amber`, `violet`, `green`, `red`,
 *   `rose`, `russet`) or a Style-Guide alias (`purple`→violet, `pink`→rose,
 *   `yellow`→amber, `brown`→russet).
 * - Tiers 100–700 are used (tier 50 is skipped — too pale). That yields 7 usable tiers;
 *   `n` is clamped to 7 (>7 mono segments is out of spec).
 * - For `n < 7`, the darkest tiers are kept and the lightest are dropped
 *   (e.g. n=4 → tiers 700,600,500,400).
 * - Throws if `base` does not resolve to one of the 7 known categorical hues.
 */
export function monoScale(base: string, n: number): string[] {
  if (!Number.isFinite(n) || n < 1) throw new RangeError(`monoScale: n must be a positive integer, got ${n}`);
  // Resolve aliases (purple → violet, etc.) the same way NAMED is built above.
  const canonical = (tokens.aliases as Record<string, string>)[base] ?? base;
  const scale = (tokens.scales as Record<string, Record<string, string>>)[canonical];
  if (!scale) {
    throw new Error(
      `monoScale: "${base}" is not a known categorical hue. ` +
      `Expected one of: ${Object.keys(tokens.scales).join(", ")} (or a Style-Guide alias).`
    );
  }
  const count = Math.min(n, MONO_TIERS.length);
  return MONO_TIERS.slice(0, count).map((tier) => scale[tier] as string);
}
