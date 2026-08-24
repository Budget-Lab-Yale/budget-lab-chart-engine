// Inline links in author-supplied note/source text: `[text](url)`, and nothing else.
//
// The rule is `table/richtext.ts`'s, deliberately: a marker only carries meaning inside a COMPLETE,
// well-formed construct, so a string without one passes through verbatim and renders byte-identically
// to before. That is what lets this be always-on with no opt-in flag — and it is also why there is
// no escape syntax. `\[` and `\]` already delimit display math in table text; defining them as
// escaped brackets here would both collide with that grammar and silently rewrite strings that are
// legal today.
//
// The cost of no escape is that an author cannot write a literal `[x](https://y)`. That is the same
// trade the math feature already makes for `\(` and `$$`, and it is why the allowlist below is part
// of FORMING a link rather than a check applied afterwards: a disallowed scheme simply is not a
// link, so no anchor can ever be built for one.
//
// Lives in `src/spec/` because validation needs it and `src/spec/*` must not import `src/engine/*`.
// The engine, embed and table layers all import it from here.

/** A piece of a source/note line. `href` present ⇒ render it as a link. */
export interface TextRun {
  text: string;
  href?: string;
}

// `http://` and `https://` require the slashes; `mailto:` does not have them. Matching a bare
// `http:` prefix would quietly accept `http:example.com`, which `new URL` normalizes to
// `http://example.com/` — a link the author did not write and CONFIG-SPEC does not promise.
const ALLOWED_SCHEME = /^(?:https?:\/\/|mailto:)/i;
/** Whitespace, angle brackets and quotes never belong in an href we are about to set as an
 *  attribute; rejecting them keeps the parser's answer and the DOM's normalization from diverging. */
const HREF_FORBIDDEN = /[\s<>"'`\\]/;

/** The single authority on what may become a link. Validation and both renderers reach it through
 *  `parseInlineLinks`, so none of them can disagree about it. */
export function isAllowedHref(url: string): boolean {
  if (!ALLOWED_SCHEME.test(url) || HREF_FORBIDDEN.test(url)) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Index just past the `)` closing a URL that starts at `from`, or -1 when it never closes.
 *  Parens nest, so a trailing `)` inside the URL (Wikipedia-style) stays part of it. */
function urlEnd(s: string, from: number): number {
  let depth = 1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Split `s` into runs. Never throws; anything that is not a complete, allowed-scheme link is text.
 *
 * Guarantees the rest of the pipeline depends on:
 *  - the runs' `text` concatenates to the VISIBLE text with no whitespace added, moved or dropped —
 *    and for a string with no link that IS `s`, byte for byte, which is the whole safety argument;
 *  - no run is empty, so a whole-string link is ONE run and the no-link case is exactly one run
 *    (which is the fast-path trigger the export wrapper keys off).
 */
export function parseInlineLinks(s: string): TextRun[] {
  if (!s) return [];
  const runs: TextRun[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain) runs.push({ text: plain });
    plain = "";
  };

  // The next `]` at or after the cursor. Cached because the answer is monotonic in `i`, and a
  // failed opener only advances the cursor by one: re-scanning from each of the `[`s in `[[[[…]`
  // is Θ(n²), and note/source text has no length limit.
  let nextClose = -1;
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "[") {
      plain += s[i];
      i++;
      continue;
    }
    // `[` only opens a link if the whole construct closes and resolves; otherwise it is a literal
    // `[` and scanning resumes at the very next character, so `[[a](url)` still finds the link.
    if (nextClose < i + 1) nextClose = s.indexOf("]", i + 1);
    const close = nextClose;
    const text = close === -1 ? "" : s.slice(i + 1, close);
    const end = close !== -1 && s[close + 1] === "(" ? urlEnd(s, close + 2) : -1;
    const url = end === -1 ? "" : s.slice(close + 2, end);
    if (!text || end === -1 || !isAllowedHref(url)) {
      plain += s[i];
      i++;
      continue;
    }
    flush();
    runs.push({ text, href: url });
    i = end + 1;
  }
  flush();
  return runs;
}

/** True when `s` holds no link at all — the case that must render exactly as it always has. */
export function isPlainText(runs: TextRun[]): boolean {
  return runs.length <= 1 && !runs[0]?.href;
}
