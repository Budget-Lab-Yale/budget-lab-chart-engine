// Pure, deterministic, human-friendly histogram bin LABELS for the hover tooltip header.
// No DOM, no locale-dependent date parsing, no Date.now/random. Temporal edges are epoch-ms and
// are formatted from their UTC calendar parts (getUTC*) with explicit month-name arrays so output
// is stable regardless of the host timezone/locale.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Calendar-interval bin widths — each such bin covers exactly one period → a single-name label. */
export type CalendarInterval = "month" | "quarter" | "year" | "week" | "day";

export interface BinLabelOpts {
  xType: "numeric" | "temporal";
  /** The bin width when it is a calendar interval NAME; otherwise null (count-based / day-count). */
  interval: CalendarInterval | null;
  /** Unit applied to NUMERIC edges only (each edge). Ignored for temporal labels. */
  unit?: string;
  unitPosition?: "prefix" | "suffix";
  /** Numeric edge rounding. Absent ⇒ smart trim to ≤2 fraction digits (drops float noise). */
  decimals?: number;
}

/** Round + thousands-separate one numeric edge (no unit). */
function formatNumericEdge(v: number, decimals: number | undefined): string {
  const n = +v;
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined,
    decimals != null
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : { maximumFractionDigits: 2 });
}

/** Single-period temporal label from a period-start epoch-ms, per calendar interval. */
function formatSinglePeriod(startMs: number, interval: CalendarInterval): string {
  const d = new Date(startMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (interval) {
    case "year": return String(y);
    case "quarter": return `Q${Math.floor(m / 3) + 1} ${y}`;
    case "month": return `${MONTHS[m]} ${y}`;
    case "week": return `Week of ${MONTHS[m]} ${day}, ${y}`;
    case "day": return `${MONTHS[m]} ${day}, ${y}`;
  }
}

/**
 * PURE — build the friendly bin-range header for one histogram bin.
 *
 * NUMERIC: `47.9 – 50.7` (en dash, spaces), rounded per `decimals` (else ≤2 digits, trimmed),
 * with the optional unit applied to each edge (prefix/suffix).
 *
 * TEMPORAL: a calendar-interval bin (`interval` set) covers exactly one period → its NAME
 * (`July 2023`, `Q3 2023`, `2023`, `Week of July 2, 2023`, `July 5, 2023`). A non-calendar bin
 * (`interval === null`) → a month+year RANGE from the start to the INCLUSIVE end (x1 is the
 * exclusive upper edge, so the inclusive end is the period containing x1 − ε): same year
 * `July – September 2023`, cross year `July 2023 – March 2024`. If the start and end land in the
 * same month+year the range collapses to that single month.
 */
export function formatBinLabel(x0: number, x1: number, opts: BinLabelOpts): string {
  if (opts.xType === "temporal") {
    if (opts.interval) return formatSinglePeriod(x0, opts.interval);
    // Non-calendar bin: inclusive end = the period containing x1 − ε (x1 is exclusive).
    const start = new Date(x0);
    const end = new Date(x1 - 1);
    const sY = start.getUTCFullYear(), sM = start.getUTCMonth();
    const eY = end.getUTCFullYear(), eM = end.getUTCMonth();
    if (sY === eY && sM === eM) return `${MONTHS[sM]} ${sY}`;
    if (sY === eY) return `${MONTHS[sM]} – ${MONTHS[eM]} ${sY}`;
    return `${MONTHS[sM]} ${sY} – ${MONTHS[eM]} ${eY}`;
  }
  const position = opts.unitPosition ?? "suffix";
  const unit = opts.unit ?? "";
  let lo = formatNumericEdge(x0, opts.decimals);
  let hi = formatNumericEdge(x1, opts.decimals);
  if (unit) {
    if (position === "prefix") { lo = `${unit}${lo}`; hi = `${unit}${hi}`; }
    // A spaced word suffix (" yrs") reads as a trailing unit applied once to the range; a tight
    // symbol suffix ("%") attaches to each edge.
    else if (unit.startsWith(" ")) hi = `${hi}${unit}`;
    else { lo = `${lo}${unit}`; hi = `${hi}${unit}`; }
  }
  return `${lo} – ${hi}`;
}
