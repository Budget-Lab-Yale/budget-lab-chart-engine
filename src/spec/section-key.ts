// Row identity on a sectioned category axis (`columns.section`). A row is identified by section +
// category; its display text is still the category. So "Top 1%" under "Ranked by income" and
// "Top 1%" under "Ranked by net worth" are two rows that both read "Top 1%".
//
// Every chart type reads this through one point: renderPane's row prep (engine/index.ts
// `prepareRows`) rewrites `_xc` to the key, so the band domain, hover resolution and DOM tagging
// all see distinct rows without any per-mark code. Callers that read raw rows (figure heights,
// validation) key them through `sectionKeyer` too. Reader-facing text goes back through
// `categoryText`.
//
// A chart is keyed ONLY when some label actually repeats across sections. Without a repeat the key
// is the bare category, so every chart without one — sectioned or not — renders byte-identically.

/** Separator inside a key. A Private Use Area code point: no author label contains it, and it is
 *  legal XML, which matters because keys are stamped into `data-category` on the live SVG and the
 *  PNG export re-render. */
const SEP = "";

/** The internal key for a category within a section. */
export function sectionCategoryKey(section: string, category: string): string {
  return `${section}${SEP}${category}`;
}

/** The text a reader sees for a category key: the category. Identity on a bare category. */
export function categoryText(key: string): string {
  const i = key.indexOf(SEP);
  return i < 0 ? key : key.slice(i + SEP.length);
}

/** The section half of a `sectionCategoryKey` key. */
export function sectionOfKey(key: string): string {
  const i = key.indexOf(SEP);
  return i < 0 ? "" : key.slice(0, i);
}

/** Map each row to its category key. Keys are `sectionCategoryKey(section, category)` when any
 *  category appears under more than one section in `rows`, else the bare category. A blank
 *  category stays blank, so a row the engine drops for having no category is still dropped. */
export function sectionKeyer<R>(
  rows: readonly R[],
  categoryOf: (r: R) => string | null | undefined,
  sectionOf: (r: R) => string | null | undefined,
): (r: R) => string {
  const seen = new Map<string, string>();
  let repeats = false;
  for (const r of rows) {
    const c = categoryOf(r);
    if (c == null || c === "") continue;
    const s = sectionOf(r) ?? "";
    const prev = seen.get(c);
    if (prev == null) seen.set(c, s);
    else if (prev !== s) { repeats = true; break; }
  }
  if (!repeats) return (r) => categoryOf(r) ?? "";
  return (r) => {
    const c = categoryOf(r) ?? "";
    return c === "" ? c : sectionCategoryKey(sectionOf(r) ?? "", c);
  };
}
