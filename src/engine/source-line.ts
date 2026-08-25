// The note + source line rendered below a chart (a live-layer DOM primitive). The
// optional `actions` node (download buttons) sits as a fixed column to the right of
// the text.
//
// Shared by charts (render-live.ts) and tables (table/mount.ts), so `[text](url)` links work in
// chart `note`/`source` and table `notes`/`source` from this one place.
import { parseInlineLinks } from "../spec/rich-text";

/** Append `s` to `parent`, as text plus anchors for any links it holds.
 *
 *  Text is always written through `textContent` and the href through a property assignment — never
 *  by building markup — so the escaping that made this field safe when it was one text node still
 *  holds for every run. A run only carries an href if the parser allowlisted its scheme, so there
 *  is no unsafe-URL branch to get wrong here. */
function appendLinkedText(parent: Node, s: string, doc: Document): void {
  for (const run of parseInlineLinks(s)) {
    if (!run.href) {
      parent.appendChild(doc.createTextNode(run.text));
      continue;
    }
    const a = doc.createElement("a");
    a.href = run.href;
    a.textContent = run.text;
    a.className = "figure-link";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    parent.appendChild(a);
  }
}

export function renderSourceLine(
  container: HTMLElement,
  { note, source, actions }: { note?: string; source?: string; actions?: HTMLElement } = {},
): void {
  if (!note && !source && !actions) return;
  const doc = container.ownerDocument;
  const meta = doc.createElement("div");
  meta.className = "figure-meta";

  const text = doc.createElement("div");
  text.className = "figure-meta-text";
  if (note) {
    const p = doc.createElement("p");
    p.className = "figure-note";
    appendLinkedText(p, note, doc);
    text.appendChild(p);
  }
  if (source) {
    const p = doc.createElement("p");
    p.className = "figure-source";
    const span = doc.createElement("span");
    span.className = "figure-source-prefix";
    span.textContent = "Source: ";
    p.appendChild(span);
    appendLinkedText(p, source, doc);
    text.appendChild(p);
  }
  meta.appendChild(text);
  if (actions) meta.appendChild(actions);
  container.appendChild(meta);
}
