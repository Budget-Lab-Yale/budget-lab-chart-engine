// Row identity on a sectioned category axis (`columns.section`). A row is identified by section +
// category; its display text is still the category. So "Top 1%" under "Ranked by income" and
// "Top 1%" under "Ranked by net worth" are two rows that both read "Top 1%".
//
// Every chart type reads this through one point: renderPane's row prep (engine/index.ts
// `prepareRows`) rewrites `_xc` to the key, so the band domain, hover resolution and DOM tagging
// all see distinct rows without any per-mark code. Callers that read raw rows (figure heights) key
// them through `sectionKeyer` too. Reader-facing text goes back through `categoryText`.
//
// A chart is keyed ONLY when some label actually repeats across sections. Without a repeat the key
// is the bare category, so every chart without one — sectioned or not — renders byte-identically.
//
// Decoding is by lookup, never by parsing: `categoryText` returns a category only for a string this
// module minted as a key, so an author label that happens to contain the separator is never split.
// (An author label byte-equal to a key minted for another chart on the same page would still be
// read as that key; that needs a label containing U+E000 that spells out another chart's section
// and category, and is the one case the lookup cannot tell apart.)

/** Prefix of every key. A Private Use Area code point: legal XML, which matters because keys are
 *  stamped into `data-category` on the live SVG and the PNG export re-render. */
const SEP = "\uE000";

/** Every key minted so far, with the category it stands for. */
const minted = new Map<string, string>();

/** The internal key for a category within a section. JSON-encoding the pair keeps distinct pairs
 *  distinct whatever characters the section and category hold. */
export function sectionCategoryKey(section: string, category: string): string {
  const key = `${SEP}${JSON.stringify([section, category])}`;
  minted.set(key, category);
  return key;
}

/** The text a reader sees for a category key: the category. Identity on anything not minted here. */
export function categoryText(key: string): string {
  return minted.get(key) ?? key;
}

/** Whether some category appears under more than one section in `rows`. */
export function labelsRepeatAcrossSections<R>(
  rows: readonly R[],
  categoryOf: (r: R) => string | null | undefined,
  sectionOf: (r: R) => string | null | undefined,
): boolean {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const c = categoryOf(r);
    if (c == null || c === "") continue;
    const s = sectionOf(r) ?? "";
    const prev = seen.get(c);
    if (prev == null) seen.set(c, s);
    else if (prev !== s) return true;
  }
  return false;
}

/** Map each row to its category key: `sectionCategoryKey(section, category)` when the chart is
 *  keyed (some label in `rows` repeats across sections), else the bare category. A blank category
 *  stays blank, so a row the engine drops for having no category is still dropped. */
export function sectionKeyer<R>(
  rows: readonly R[],
  categoryOf: (r: R) => string | null | undefined,
  sectionOf: (r: R) => string | null | undefined,
): (r: R) => string {
  if (!labelsRepeatAcrossSections(rows, categoryOf, sectionOf)) return (r) => categoryOf(r) ?? "";
  return (r) => {
    const c = categoryOf(r) ?? "";
    return c === "" ? c : sectionCategoryKey(sectionOf(r) ?? "", c);
  };
}

/** `section_order` is an inclusion filter: the rows of a section it leaves out are dropped here,
 *  before anything reads them (net mode, the value domain, the height, hover), as series_order's
 *  are. Identity when there is no section column or no `section_order`. */
export function rowsInSectionOrder<R>(
  rows: R[],
  sectionOrder: readonly string[] | undefined,
  sectionOf: ((r: R) => string | null | undefined) | null,
): R[] {
  if (!sectionOf || !sectionOrder || !sectionOrder.length) return rows;
  const listed = new Set(sectionOrder);
  return rows.filter((r) => listed.has(sectionOf(r) ?? ""));
}
