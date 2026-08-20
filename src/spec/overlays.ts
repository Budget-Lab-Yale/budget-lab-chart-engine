// The parts of `overlays` resolution that need nothing but the spec.
//
// Kept engine-free on purpose: src/spec/ is a leaf layer (it imports nothing from src/engine/), and
// both spec validation and the engine's legend builder need these two answers. The geometry, the
// palette lookup and the fit live in src/engine/overlays.ts.
import type { Overlay } from "./types";

export type OverlayKind = "method" | "fun" | "abline" | "column";

/** Which kind this entry declares, or null when it declares none or more than one. `slope` and
 *  `intercept` count as ONE key together; a half-declared abline is null here and gets its own error
 *  message in validate.ts. */
export function overlayKind(o: Overlay): OverlayKind | null {
  const kinds: OverlayKind[] = [];
  if (o.method != null) kinds.push("method");
  if (o.fun != null) kinds.push("fun");
  if (o.slope != null && o.intercept != null) kinds.push("abline");
  if (o.column != null) kinds.push("column");
  return kinds.length === 1 ? (kinds[0] as OverlayKind) : null;
}

/** Dashed or solid. Exported because the legend row must agree with the line it keys, and the way
 *  those two drift apart is each deriving the default separately — which is how `.is-dot` silently
 *  became a square (issue #30). */
export function overlayDashed(o: Overlay): boolean {
  if (o.style) return o.style === "dashed";
  const kind = overlayKind(o);
  // Computed FROM the data (method, column) reads solid; asserted OVER it (fun, abline) reads dashed.
  return kind === "fun" || kind === "abline";
}

/** True when a data-derived overlay (`method`/`column`) is fit PER SERIES (the default) rather than
 *  pooled across all series (`by: "all"`). A per-series fit is already keyed by the series' own
 *  legend color, so its overlay legend row takes the neutral tint instead — one row cannot key N
 *  colours and a concept at once. Exported (rather than re-derived at each call site) for the same
 *  reason `overlayDashed` is: engine/overlays.ts's own geometry and annotation-legend.ts's legend
 *  row must agree on this, and re-deriving a shared concept is how `.is-dot` silently became a
 *  square (issue #30). */
export function overlayPerSeries(o: Overlay): boolean {
  const kind = overlayKind(o);
  return (kind === "method" || kind === "column") && (o.by ?? "series") === "series";
}
