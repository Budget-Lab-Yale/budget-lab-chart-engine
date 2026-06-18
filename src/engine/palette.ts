// Categorical palette + color-name resolution, driven by the generated tokens.
//
// Slots 1-7 are the categorical base hues (in `position` order). Slots 8-14 reuse the
// derived light tier of the same hue (two tonal steps lighter), so a 9th series is a
// lighter blue, a 10th a lighter amber, etc. The light tier is computed in
// sync-theme.mjs from each hue's tonal scale — see theme/tokens.ts.
import { tokens } from "../theme/tokens";

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
NAMED.black = tokens.structural.mark_black;
NAMED.grey = tokens.structural.text_muted;
NAMED.gray = tokens.structural.text_muted;
NAMED.navy = tokens.brand.navy;

export const TBL_COLORS: Readonly<Record<string, string>> = NAMED;

/** A known color name → its hex; anything else (a raw "#hex" or unknown) is returned
 * unchanged. Undefined/empty passes through so callers can `?? fallback`. */
export function resolveColor(value: string | undefined): string | undefined {
  if (!value) return value;
  return TBL_COLORS[value] ?? value;
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
