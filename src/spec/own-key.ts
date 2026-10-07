/** `m[k]` when `k` is an OWN key of `m`, else `undefined`.
 *
 *  Every author-keyed map the engine reads by a name that comes from the DATA or from free author
 *  text (`series_colors`, `series_labels`, `series_styles`, `category_colors`, `x_labels`, …) must
 *  be read through this. A bare `m[k]` with `k` = "constructor", "toString", "__proto__", "valueOf"
 *  or "hasOwnProperty" returns the inherited Object.prototype member, so a series with that name
 *  painted a function as its colour and printed "function toString() { [native code] }" as its
 *  label. An own "__proto__" key (JSON.parse and the YAML loader both create one) still reads
 *  through, because its own data property shadows the inherited accessor. */
export function ownValue<T>(m: Readonly<Record<string, T>> | null | undefined, k: string): T | undefined {
  return m != null && Object.hasOwn(m, k) ? m[k] : undefined;
}
