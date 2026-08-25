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

/** The longest URL a link may carry, and the STRUCTURAL reason this parser is linear.
 *
 *  Measured: with the bound removed, the six shapes in `test/source-links.test.ts` take 13-14s each;
 *  with it, ~5ms. Without a cap, one `(` that never closes makes every candidate walk to the end of
 *  the string, and a failed candidate advances the cursor by one character — the quadratic that
 *  survived three narrower fixes here. The per-`]` memo below lowers the constant (removing it costs
 *  ~310ms on those shapes) but is not what bounds the work; this is.
 *
 *  2048 is the conventional practical URL limit, far past any real source line. */
const MAX_URL = 2048;

/** Index of the `)` closing a URL that starts at `from`, or -1 when it does not close within
 *  `MAX_URL` characters. Parens nest, so a `)` inside the URL (Wikipedia-style) stays part of it. */
function urlEnd(s: string, from: number): number {
  let depth = 1;
  // `+ 1` because the closing `)` of a MAX_URL-length URL sits AT `from + MAX_URL`: the URL itself
  // occupies from .. from+MAX_URL-1, so an exclusive bound of `from + MAX_URL` would never look at
  // the paren and would refuse a URL of exactly the documented maximum.
  const limit = Math.min(s.length, from + MAX_URL + 1);
  for (let i = from; i < limit; i++) {
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

  // The candidate URL depends ONLY on the closing `]`, never on which `[` opened it, so it is
  // resolved once per `]` and reused; `nextClose` is likewise monotonic in the cursor. Both are
  // constant-factor wins on top of MAX_URL, which is what actually bounds the work — see there
  // before assuming either of these is load-bearing for complexity.
  let nextClose = -1;
  let memoClose = -2;
  let memoEnd = -1;
  let memoUrl = "";

  let i = 0;
  while (i < s.length) {
    if (s[i] !== "[") {
      plain += s[i];
      i++;
      continue;
    }
    if (nextClose < i + 1) nextClose = s.indexOf("]", i + 1);
    const close = nextClose;
    if (close !== memoClose) {
      memoClose = close;
      memoEnd = -1;
      memoUrl = "";
      if (close !== -1 && s[close + 1] === "(") {
        const end = urlEnd(s, close + 2);
        const url = end === -1 ? "" : s.slice(close + 2, end);
        if (end !== -1 && isAllowedHref(url)) {
          memoEnd = end;
          memoUrl = url;
        }
      }
    }
    // `[` opens a link only if the construct closes AND resolves; otherwise it is a literal `[` and
    // scanning resumes at the next character, so `[[a](url)` still finds the link.
    // `close === i + 1` is empty link text — an invisible link, so the construct stays literal.
    if (memoEnd === -1 || close === i + 1) {
      plain += s[i];
      i++;
      continue;
    }
    flush();
    runs.push({ text: s.slice(i + 1, close), href: memoUrl });
    i = memoEnd + 1;
  }
  flush();
  return runs;
}

/** True when `s` holds no link at all — the case that must render exactly as it always has. */
export function isPlainText(runs: TextRun[]): boolean {
  return runs.length <= 1 && !runs[0]?.href;
}
