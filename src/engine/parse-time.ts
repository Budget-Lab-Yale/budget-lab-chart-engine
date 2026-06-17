// Time parsing for the three x-axis types. One canonical place for date parsing
// (the tracker had a copy in charts.js and ad-hoc regexes in the crosshair).

/** `YYYY-MM-DD` → Date (local midnight). Falls back to Date() for anything else. */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string));
  return new Date(s);
}

/** `YYYYQ#` → Date at the first day of the quarter, or null if it doesn't match. */
export function parseQuarter(s: string): Date | null {
  const m = /^(\d{4})Q(\d)$/.exec(s);
  if (!m) return null;
  return new Date(+(m[1] as string), (+(m[2] as string) - 1) * 3, 1);
}

/** Date → `YYYYQ#`. */
export function formatQuarter(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}Q${q}`;
}
