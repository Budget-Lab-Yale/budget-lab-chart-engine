// Lightweight inline math / special-character formatting for table text.
//
// Authors write math the same way the TBL website does (MathJax defaults): inline math is
// delimited by \( … \); displayed math by \[ … \] or $$ … $$; and \$ is a literal dollar sign.
// Inside a delimiter we support the LINEAR subset of LaTeX — Greek letters, sub/superscripts
// (including stacked sub+super), inline italics, and a handful of operator/spacing symbols.
// Anything 2-dimensional (\frac, \sqrt, matrices, …) is NOT supported and is rejected at
// validation time (see validateRichText), never silently mis-rendered.
//
// Because the math markers (\(, \[, $$) only carry meaning inside their delimiters, a plain
// string with none of them passes through verbatim — bare $ _ ^ * stay literal. This keeps the
// feature always-on with no opt-in flag and no escaping burden, and guarantees that text without
// math renders byte-identically to before (so the golden SVG snapshots are unaffected).
//
// The same parsed run list backs all three consumers — the width measurer (layout sizing), the
// HTML renderer, and the SVG renderer — so they cannot disagree about what a string renders to.

/** A styled piece of a rich string, laid out left→right on one baseline. */
export type RichRun =
  | { kind: "text"; text: string; italic: boolean }
  | { kind: "super"; text: string; italic: boolean }
  | { kind: "sub"; text: string; italic: boolean }
  // Sub and super stacked on the SAME horizontal position (e.g. \theta_1^K → θ with ¹ over ₁).
  | { kind: "subsup"; sub: string; sup: string; subItalic: boolean; supItalic: boolean }
  // A hard line break, authored as `\\` (two backslashes) OUTSIDE any math delimiter. Splits the
  // surrounding text onto a new line; renders as <br> (HTML) / a new tspan line (SVG). Recognized
  // only outside \( … \) — a `\\` inside math is left to the math parser (2-D math is rejected at
  // validation, so it never reaches rendering).
  | { kind: "break" };

/** Script (sub/super) font size as a fraction of the surrounding text size. */
export const SCRIPT_SCALE = 0.72;

// Greek letter macros → Unicode. Lowercase Greek renders italic in math mode (matching LaTeX);
// uppercase Greek stays upright. Where Figtree lacks an italic Greek face the browser synthesizes
// an oblique, which is the expected math look.
const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ",
  sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ", varphi: "ϕ", chi: "χ",
  psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

// Single-glyph operator / relation / spacing macros → Unicode. These are all 1-dimensional, so
// they render inline like any other character (a big operator with limits, e.g. \sum_{i}^{n},
// gets its limits as ordinary inline sub/superscripts).
const SYMBOLS: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡",
  sim: "∼", simeq: "≃", propto: "∝", infty: "∞", partial: "∂", nabla: "∇",
  sum: "∑", prod: "∏", int: "∫", forall: "∀", exists: "∃", in: "∈", notin: "∉",
  subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩",
  rightarrow: "→", to: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐",
  leftrightarrow: "↔", mapsto: "↦", cdots: "⋯", ldots: "…", dots: "…", prime: "′",
  circ: "∘", bullet: "•", dagger: "†", degree: "°", deg: "°", percent: "%",
};

// Macros that take a braced argument and set its style. \text/\mathrm/\operatorname force upright.
const STYLE_MACROS: Record<string, "italic" | "upright"> = {
  textit: "italic", mathit: "italic", emph: "italic",
  text: "upright", mathrm: "upright", textrm: "upright", operatorname: "upright", mathsf: "upright",
};

// Multi-letter upright identifiers (function names) that read upright in math, not italic.
const UPRIGHT_WORDS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "lim", "max", "min",
  "det", "dim", "ker", "deg", "arg", "gcd", "sup", "inf", "mod",
]);

// Inline-math opener → its matching closer. $$ is both opener and closer.
const DELIMS: Array<{ open: string; close: string }> = [
  { open: "\\(", close: "\\)" },
  { open: "\\[", close: "\\]" },
  { open: "$$", close: "$$" },
];

/** True if the string contains any math delimiter (and so needs parsing rather than passthrough). */
export function hasMath(s: string): boolean {
  return s.includes("\\(") || s.includes("\\[") || s.includes("$$");
}

/** True if the string contains a hard-break token (`\\`). Combined with hasMath to decide whether
 *  a string can take the verbatim fast path. */
export function hasBreak(s: string): boolean {
  return s.includes("\\\\");
}

/** The math-delimiter opener starting exactly at `i`, or null. Break-first tokenizers must test
 *  `\\` BEFORE this so `\\(` reads as break + literal `(` rather than a `\(` math opener. */
function openerAt(s: string, i: number): { open: string; close: string } | null {
  for (const d of DELIMS) if (s.startsWith(d.open, i)) return { open: d.open, close: d.close };
  return null;
}

/** Convert the literal-text portions outside math: only the \$ escape is meaningful there. */
function unescapeText(s: string): string {
  return s.replace(/\\\$/g, "$");
}

/**
 * Parse a string into a flat list of styled runs. A string with no math delimiter yields a single
 * verbatim text run (true passthrough). Unsupported math commands are passed to `onUnsupported`
 * (when provided) and rendered as their literal source so output is never silently wrong.
 */
export function parseRich(s: string, onUnsupported?: (cmd: string) => void): RichRun[] {
  if (!hasMath(s) && !hasBreak(s)) return [{ kind: "text", text: s, italic: false }];

  const runs: RichRun[] = [];
  let i = 0;
  let start = 0; // start of the pending literal-text run being accumulated
  const flush = (end: number) => { if (end > start) pushText(runs, unescapeText(s.slice(start, end)), false); };
  while (i < s.length) {
    // Break token first, so `\\(` is break + literal `(` rather than a `\(` math opener.
    if (s[i] === "\\" && s[i + 1] === "\\") { flush(i); runs.push({ kind: "break" }); i += 2; start = i; continue; }
    const opener = openerAt(s, i);
    if (opener != null) {
      flush(i);
      const contentStart = i + opener.open.length;
      const closeIdx = s.indexOf(opener.close, contentStart);
      if (closeIdx < 0) {
        // Unterminated delimiter (author forgot the closer): render the remainder as math anyway
        // rather than dumping raw LaTeX. Graceful and never throws.
        parseMath(s.slice(contentStart), runs, onUnsupported);
        return runs;
      }
      parseMath(s.slice(contentStart, closeIdx), runs, onUnsupported);
      i = closeIdx + opener.close.length;
      start = i;
      continue;
    }
    i++;
  }
  flush(i);
  return runs;
}

/** Split a rich string at top-level `\\` break tokens (math regions are skipped so a `\\` inside
 *  `\( … \)` never splits). Returns the raw substrings between breaks — so each segment can be
 *  measured or rendered as its own rich string. Empty segments (leading/trailing/consecutive `\\`)
 *  are preserved as empty strings. */
export function splitBreaks(s: string): string[] {
  if (!hasBreak(s)) return [s];
  const segs: string[] = [];
  let i = 0;
  let start = 0;
  while (i < s.length) {
    if (s[i] === "\\" && s[i + 1] === "\\") { segs.push(s.slice(start, i)); i += 2; start = i; continue; }
    const opener = openerAt(s, i);
    if (opener != null) {
      const closeIdx = s.indexOf(opener.close, i + opener.open.length);
      if (closeIdx < 0) break;
      i = closeIdx + opener.close.length;
      continue;
    }
    i++;
  }
  segs.push(s.slice(start));
  return segs;
}

/** Append a text run, merging into the previous run when both are plain non-italic text. */
function pushText(runs: RichRun[], text: string, italic: boolean): void {
  if (text === "") return;
  const last = runs[runs.length - 1];
  if (last && last.kind === "text" && last.italic === italic) last.text += text;
  else runs.push({ kind: "text", text, italic });
}

/** Read a `{...}`-balanced group starting at `s[i]` (i points at `{`). Returns content + next index. */
function readGroup(s: string, i: number): { content: string; next: number } {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") { depth--; if (depth === 0) { j++; break; } }
  }
  return { content: s.slice(i + 1, Math.max(i + 1, j - 1)), next: j };
}

/** Read one script argument after `_`/`^`: either a `{group}` or a single token (char or \macro). */
function readScriptArg(s: string, i: number): { raw: string; next: number } {
  if (s[i] === "{") {
    const g = readGroup(s, i);
    return { raw: g.content, next: g.next };
  }
  if (s[i] === "\\") {
    let j = i + 1;
    while (j < s.length && /[a-zA-Z]/.test(s[j]!)) j++;
    return { raw: s.slice(i, j), next: j };
  }
  return { raw: s[i] ?? "", next: i + 1 };
}

/** Render a (sub/super) script's source to display text + an italic decision. */
function renderScript(raw: string, onUnsupported?: (cmd: string) => void): { text: string; italic: boolean } {
  const sub = parseMath(raw, [], onUnsupported, true);
  // parseMath never emits break runs, but the union includes it: map subsup to its glyphs, break to
  // nothing, everything else to its text.
  const text = sub.map((r) => (r.kind === "subsup" ? r.sub + r.sup : r.kind === "break" ? "" : r.text)).join("");
  const italic = /[a-zA-Z]/.test(text) && sub.some((r) => (r.kind === "text" ? r.italic : false));
  return { text, italic };
}

/**
 * Tokenize a math-mode string into runs, appended to `out`. Letters render italic (math
 * variables); digits, Greek, and symbols upright. `_`/`^` attach to the preceding atom; an atom
 * carrying both becomes a stacked `subsup` run. When `flatten` is set, scripts are not stacked
 * (used to render a script's own contents to a plain string).
 */
function parseMath(s: string, out: RichRun[], onUnsupported?: (cmd: string) => void, flatten = false): RichRun[] {
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === " " || c === "\t" || c === "\n") { i++; continue; } // math ignores whitespace
    if (c === "{") { const g = readGroup(s, i); parseMath(g.content, out, onUnsupported, flatten); i = g.next; continue; }
    if (c === "}") { i++; continue; }

    if (c === "_" || c === "^") {
      // Scripts with no preceding atom (rare): attach to an empty base.
      attachScript(s, i, c, out, onUnsupported, flatten);
      i = skipScripts(s, i);
      continue;
    }

    if (c === "\\") {
      let j = i + 1;
      // Backslash-space and backslash-punctuation are spacing/escapes.
      if (s[j] === "," || s[j] === ";" || s[j] === " " || s[j] === ":" || s[j] === "!") { pushText(out, " ", false); i = j + 1; continue; }
      while (j < s.length && /[a-zA-Z]/.test(s[j]!)) j++;
      const name = s.slice(i + 1, j);
      i = j;
      if (name in GREEK) {
        // Lowercase Greek is italic in math mode (like Latin variables); uppercase Greek upright.
        pushText(out, GREEK[name]!, /^[a-z]/.test(name));
        i = applyScripts(s, i, out, onUnsupported, flatten);
        continue;
      }
      if (name in SYMBOLS) { pushText(out, SYMBOLS[name]!, false); i = applyScripts(s, i, out, onUnsupported, flatten); continue; }
      if (name in STYLE_MACROS) {
        // Consume the braced argument and emit its text in the macro's style.
        while (i < s.length && /\s/.test(s[i]!)) i++;
        let content = "";
        if (s[i] === "{") { const g = readGroup(s, i); content = g.content; i = g.next; }
        const italic = STYLE_MACROS[name] === "italic";
        pushText(out, content, italic);
        i = applyScripts(s, i, out, onUnsupported, flatten);
        continue;
      }
      if (UPRIGHT_WORDS.has(name)) { pushText(out, name, false); i = applyScripts(s, i, out, onUnsupported, flatten); continue; }
      // Unknown / unsupported command (e.g. \frac, \sqrt): report and degrade to literal source.
      onUnsupported?.(name);
      pushText(out, "\\" + name, false);
      continue;
    }

    // A bare character. Letters are italic math variables; everything else upright.
    const italic = /[a-zA-Z]/.test(c);
    pushText(out, c, italic);
    i++; // advance past the character before checking for trailing scripts
    i = applyScripts(s, i, out, onUnsupported, flatten);
  }
  return out;
}

/** After emitting a base atom, consume any immediately-following `_`/`^` scripts and attach them
 * to the just-emitted run (replacing it with a stacked subsup run when both are present). */
function applyScripts(s: string, i: number, out: RichRun[], onUnsupported?: (cmd: string) => void, flatten = false): number {
  if (s[i] !== "_" && s[i] !== "^") return i;
  let sub: { text: string; italic: boolean } | null = null;
  let sup: { text: string; italic: boolean } | null = null;
  while (s[i] === "_" || s[i] === "^") {
    const isSub = s[i] === "_";
    const arg = readScriptArg(s, i + 1);
    const r = renderScript(arg.raw, onUnsupported);
    if (isSub) sub = r; else sup = r;
    i = arg.next;
  }
  if (flatten) {
    if (sup) out.push({ kind: "text", text: sup.text, italic: sup.italic });
    if (sub) out.push({ kind: "text", text: sub.text, italic: sub.italic });
  } else if (sub && sup) {
    out.push({ kind: "subsup", sub: sub.text, sup: sup.text, subItalic: sub.italic, supItalic: sup.italic });
  } else if (sub) {
    out.push({ kind: "sub", text: sub.text, italic: sub.italic });
  } else if (sup) {
    out.push({ kind: "super", text: sup.text, italic: sup.italic });
  }
  return i;
}

/** Variant of applyScripts for scripts with no base atom (attach to an implicit empty base). */
function attachScript(s: string, i: number, _first: string, out: RichRun[], onUnsupported?: (cmd: string) => void, flatten = false): void {
  applyScripts(s, i, out, onUnsupported, flatten);
}

/** Advance past a run of `_`/`^` script groups (used when scripts had no base). */
function skipScripts(s: string, i: number): number {
  while (s[i] === "_" || s[i] === "^") {
    const arg = readScriptArg(s, i + 1);
    i = arg.next;
  }
  return i;
}

/** Total advance width of a rich string at `fontPx`/`weight`, via the caller's text measurer.
 *  For a string with no math this is exactly `measure(s, fontPx, weight)`. */
export function richWidth(
  s: string,
  fontPx: number,
  weight: number,
  measure: (s: string, fontPx: number, weight: number) => number,
): number {
  if (!hasMath(s) && !hasBreak(s)) return measure(s, fontPx, weight);
  const runs = parseRich(s);
  const sf = fontPx * SCRIPT_SCALE;
  // A broken string is as wide as its WIDEST line, not the sum: track the current line's width and
  // keep the running max across breaks.
  let maxW = 0;
  let line = 0;
  for (const run of runs) {
    if (run.kind === "break") { maxW = Math.max(maxW, line); line = 0; }
    else if (run.kind === "text") line += measure(run.text, fontPx, weight);
    else if (run.kind === "super" || run.kind === "sub") line += measure(run.text, sf, weight);
    else line += Math.max(measure(run.sub, sf, weight), measure(run.sup, sf, weight));
  }
  return Math.max(maxW, line);
}

/** Plain-text projection of a rich string (markup stripped, symbols mapped). Used for rough
 *  heuristics (e.g. banner flanking-rule placement) and as an accessible fallback. */
export function richToPlain(s: string): string {
  if (!hasMath(s) && !hasBreak(s)) return s;
  return parseRich(s)
    .map((r) => (r.kind === "break" ? " " : r.kind === "subsup" ? r.sup + r.sub : r.text))
    .join("");
}

/** Validate the supported subset: returns the list of unsupported `\command` names found inside
 *  math delimiters (empty when the string is fine). Plain strings are always valid. */
export function validateRichText(s: string): string[] {
  if (!hasMath(s)) return [];
  const bad: string[] = [];
  parseRich(s, (cmd) => { if (!bad.includes(cmd)) bad.push(cmd); });
  return bad;
}

// ---- HTML rendering ----------------------------------------------------------------------------

/** Append a rich string to `parent` as DOM nodes. Plain text becomes a single text node (so the
 *  resulting DOM/textContent is identical to a direct `.textContent =`). Math adds <sup>/<sub>/<i>
 *  and a stacked <span class="tbl-msubsup"> as needed. */
export function appendRichHtml(parent: Node, s: string, doc: Document): void {
  for (const run of parseRich(s)) {
    if (run.kind === "break") {
      parent.appendChild(doc.createElement("br"));
    } else if (run.kind === "text") {
      if (run.italic) { const el = doc.createElement("i"); el.textContent = run.text; parent.appendChild(el); }
      else parent.appendChild(doc.createTextNode(run.text));
    } else if (run.kind === "super" || run.kind === "sub") {
      const el = doc.createElement(run.kind === "super" ? "sup" : "sub");
      el.className = "tbl-math";
      if (run.italic) el.style.fontStyle = "italic";
      el.textContent = run.text;
      parent.appendChild(el);
    } else {
      const wrap = doc.createElement("span");
      wrap.className = "tbl-msubsup";
      const sup = doc.createElement("span");
      sup.className = "tbl-msup";
      if (run.supItalic) sup.style.fontStyle = "italic";
      sup.textContent = run.sup;
      const sub = doc.createElement("span");
      sub.className = "tbl-msub";
      if (run.subItalic) sub.style.fontStyle = "italic";
      sub.textContent = run.sub;
      wrap.appendChild(sup);
      wrap.appendChild(sub);
      parent.appendChild(wrap);
    }
  }
}

// ---- SVG rendering -----------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

export interface RichSvgOpts {
  x: number;
  baselineY: number;
  anchor: "start" | "middle" | "end";
  fontFamily: string;
  fontSize: number;
  weight: number;
  fill: string;
  cls?: string;
  measure: (s: string, fontPx: number, weight: number) => number;
}

/** Build a single <text> element for a rich string, with <tspan>s for scripts and stacked
 *  sub+super clusters. Horizontal alignment is done by measuring the total width and placing the
 *  (start-anchored) text manually, so stacked clusters with back-shifted tspans still align. */
export function renderRichSvgText(doc: Document, s: string, opts: RichSvgOpts): SVGElement {
  const runs = parseRich(s);
  const sf = opts.fontSize * SCRIPT_SCALE;
  const m = opts.measure;

  // Split the run list into lines at hard breaks. A single-line string (the common case) yields
  // one line, so its output is byte-identical to before.
  const lines: RichRun[][] = [[]];
  for (const run of runs) {
    if (run.kind === "break") lines.push([]);
    else lines[lines.length - 1]!.push(run);
  }
  const lineWidth = (line: RichRun[]): number => {
    let w = 0;
    for (const run of line) {
      if (run.kind === "text") w += m(run.text, opts.fontSize, opts.weight);
      else if (run.kind === "super" || run.kind === "sub") w += m(run.text, sf, opts.weight);
      else if (run.kind === "subsup") w += Math.max(m(run.sub, sf, opts.weight), m(run.sup, sf, opts.weight));
    }
    return w;
  };
  const lineStartX = (line: RichRun[]): number => {
    const w = lineWidth(line);
    return opts.anchor === "middle" ? opts.x - w / 2 : opts.anchor === "end" ? opts.x - w : opts.x;
  };

  const t = doc.createElementNS(SVG_NS, "text");
  t.setAttribute("x", String(lineStartX(lines[0]!)));
  t.setAttribute("y", String(opts.baselineY));
  t.setAttribute("text-anchor", "start");
  t.setAttribute("font-family", opts.fontFamily);
  t.setAttribute("font-size", String(opts.fontSize));
  t.setAttribute("font-weight", String(opts.weight));
  t.setAttribute("fill", opts.fill);
  if (opts.cls) t.setAttribute("class", opts.cls);

  // Position every tspan with ABSOLUTE x and y. Script rise/drop are explicit pixel offsets
  // (not `baseline-shift`, which Chromium's SVG rasterizer ignores), so super/sub land at the
  // right height and a stacked cluster's two halves sit one above the other at the same x. Each
  // hard-break line drops the baseline by lineHeight and re-anchors from that line's own start.
  const supRise = opts.fontSize * 0.42;
  const subDrop = opts.fontSize * 0.16;
  const lineHeight = opts.fontSize + 3; // matches the layout's per-line heights (12→15, 13→16)
  const put = (text: string, x: number, y: number, italic: boolean, script: boolean): void => {
    const ts = doc.createElementNS(SVG_NS, "tspan");
    ts.setAttribute("x", String(x));
    ts.setAttribute("y", String(y));
    if (script) ts.setAttribute("font-size", String(sf));
    if (italic) ts.setAttribute("font-style", "italic");
    ts.textContent = text;
    t.appendChild(ts);
  };

  lines.forEach((line, li) => {
    let cx = lineStartX(line);
    const baseY = opts.baselineY + li * lineHeight;
    for (const run of line) {
      if (run.kind === "text") {
        put(run.text, cx, baseY, run.italic, false);
        cx += m(run.text, opts.fontSize, opts.weight);
      } else if (run.kind === "super") {
        put(run.text, cx, baseY - supRise, run.italic, true);
        cx += m(run.text, sf, opts.weight);
      } else if (run.kind === "sub") {
        put(run.text, cx, baseY + subDrop, run.italic, true);
        cx += m(run.text, sf, opts.weight);
      } else if (run.kind === "subsup") {
        // Stacked sub+super on the same x; advance by the wider of the two.
        const supW = m(run.sup, sf, opts.weight);
        const subW = m(run.sub, sf, opts.weight);
        put(run.sup, cx, baseY - supRise, run.supItalic, true);
        put(run.sub, cx, baseY + subDrop, run.subItalic, true);
        cx += Math.max(supW, subW);
      }
    }
  });
  return t;
}
