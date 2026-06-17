// The note + source line rendered below a chart (a live-layer DOM primitive). The
// optional `actions` node (download buttons) sits as a fixed column to the right of
// the text.
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
    p.textContent = note;
    text.appendChild(p);
  }
  if (source) {
    const p = doc.createElement("p");
    p.className = "figure-source";
    const span = doc.createElement("span");
    span.className = "figure-source-prefix";
    span.textContent = "Source: ";
    p.appendChild(span);
    p.appendChild(doc.createTextNode(source));
    text.appendChild(p);
  }
  meta.appendChild(text);
  if (actions) meta.appendChild(actions);
  container.appendChild(meta);
}
