// SVG translate geometry shared by the layout tests. Not a test file.
//
// Several tests keep their own variants on purpose: a different regex (a one-argument
// `translate(x)`, no `\s*\)` anchor) or the element's own x/y/cx/cy folded in. Those read some
// transforms differently, so they were not replaced by this one.

/** `translate(x, y)` or `translate(x y)`; both arguments required, closing paren anchored. */
const TRANSLATE = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/;

/** The summed `translate(x, y)` of `el` and its ancestors, stopping before `stop` when given, else
 *  before the nearest `<svg>` ancestor (by tag name, so an `<svg>` nested in another stops it).
 *  The element's own x/y/cx/cy are not included. */
export function translateOf(el: Element | null, stop?: Element): [number, number] {
  let x = 0;
  let y = 0;
  for (let n = el; n && (stop ? n !== stop : n.tagName.toLowerCase() !== "svg"); n = n.parentElement) {
    const m = TRANSLATE.exec(n.getAttribute("transform") ?? "");
    if (m) {
      x += Number(m[1]);
      y += Number(m[2]);
    }
  }
  return [x, y];
}
