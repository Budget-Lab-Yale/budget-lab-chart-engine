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
