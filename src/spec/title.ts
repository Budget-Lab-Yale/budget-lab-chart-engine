// Pure helpers for the inline title selector (`title_selectors` + `{token}` in `title`). See
// spec/types.ts (TitleSelector) for the shape and spec/validate.ts for the cross-field rules
// (every key must appear as `{key}` in the title; `default` must be an option id; etc.).
//
// No DOM here — the live `<select>` wiring lives in engine/render-live.ts (buildFigureHeader);
// export-png.ts and bundle-standalone.ts use resolveTitleText to get the plain-text title with
// tokens substituted by their active option's label.
import type { TitleSelector } from "./types";

/** Structural subset of ChartSpec these helpers need — lets TableSpec-shaped objects (which
 *  never have title_selectors) pass through resolveTitleText unchanged, matching the
 *  buildFigureHeader convention of accepting a spec subset rather than the full ChartSpec. */
export interface TitleSpec {
  title: string;
  title_selectors?: Record<string, TitleSelector>;
}

export type TitleSegment = { kind: "text"; text: string } | { kind: "token"; key: string };

// A token is `{key}` where key is letters/digits/underscore/dash — matches YAML-friendly map
// keys. Only keys present in `selectors` become tokens; anything else (including a syntactically
// matching `{unknownKey}`) stays literal text.
const TOKEN_RE = /\{([A-Za-z0-9_-]+)\}/g;

/** Split `title` into text/token segments. Only `{key}` sequences whose `key` is a property of
 *  `selectors` become `{kind:"token"}` segments — an absent or empty `selectors` (or a
 *  syntactically matching but unregistered key) leaves the corresponding text literal. */
export function parseTitleTokens(
  title: string,
  selectors: Record<string, TitleSelector> | undefined,
): TitleSegment[] {
  if (!selectors || !Object.keys(selectors).length) return [{ kind: "text", text: title }];

  const segments: TitleSegment[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(title))) {
    const key = m[1]!;
    if (!(key in selectors)) continue; // unregistered — leave as literal text (no split here)
    if (m.index > lastIndex) segments.push({ kind: "text", text: title.slice(lastIndex, m.index) });
    segments.push({ kind: "token", key });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < title.length) segments.push({ kind: "text", text: title.slice(lastIndex) });
  return segments.length ? segments : [{ kind: "text", text: title }];
}

/** Resolve the effective selections map for a spec: per key, `initial[key]` (when it names a
 *  real option) wins, else `selector.default` (when valid), else the first option. Returns `{}`
 *  when the spec has no title_selectors. */
export function resolveSelections(
  spec: TitleSpec,
  initial?: Record<string, string>,
): Record<string, string> {
  const selectors = spec.title_selectors;
  const result: Record<string, string> = {};
  if (!selectors) return result;
  for (const [key, selector] of Object.entries(selectors)) {
    const isValidId = (id: string | undefined): id is string =>
      id != null && selector.options.some((o) => o.id === id);
    const fromInitial = initial?.[key];
    if (isValidId(fromInitial)) {
      result[key] = fromInitial;
    } else if (isValidId(selector.default)) {
      result[key] = selector.default;
    } else {
      result[key] = selector.options[0]?.id ?? "";
    }
  }
  return result;
}

/** Resolve `spec.title` to a plain string, substituting each `{key}` token with its active
 *  option's label (falling back to the option id). `selections` omitted ⇒ resolved via
 *  `resolveSelections(spec)` (i.e. the defaults). A spec without title_selectors returns
 *  `spec.title` untouched. */
export function resolveTitleText(spec: TitleSpec, selections?: Record<string, string>): string {
  const selectors = spec.title_selectors;
  if (!selectors || !Object.keys(selectors).length) return spec.title;
  const effective = selections ?? resolveSelections(spec);
  const segments = parseTitleTokens(spec.title, selectors);
  return segments
    .map((seg) => {
      if (seg.kind === "text") return seg.text;
      const selector = selectors[seg.key]!;
      const activeId = effective[seg.key];
      const opt =
        selector.options.find((o) => o.id === activeId) ??
        selector.options.find((o) => o.id === selector.default) ??
        selector.options[0];
      return opt ? (opt.label ?? opt.id) : `{${seg.key}}`;
    })
    .join("");
}
