/**
 * Calendar-date helpers. Every date in the quest and save layers is a local
 * `YYYY-MM-DD` string. Dates are parsed as local midnight and day arithmetic is done on
 * calendar fields, never by adding 24-hour blocks, so daylight saving shifts cannot
 * move a date by one.
 */

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` as local midnight. Throws a readable Error on bad input. */
export function parseYmd(ymd: string): Date {
  const match = YMD_PATTERN.exec(ymd);
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${ymd}".`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`"${ymd}" is not a real calendar date.`);
  }
  return date;
}

export function isYmd(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseYmd(value);
    return true;
  } catch {
    return false;
  }
}

/** Format a Date's local calendar fields as `YYYY-MM-DD`. */
export function formatYmd(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's local calendar date. Pass `now` in tests. */
export function todayLocal(now: Date = new Date()): string {
  return formatYmd(now);
}

/** The calendar date `n` days after `ymd` (`n` may be negative). */
export function addDays(ymd: string, n: number): string {
  const date = parseYmd(ymd);
  date.setDate(date.getDate() + n);
  return formatYmd(date);
}

/** Whole calendar days from `a` to `b`: positive when `b` is later than `a`. */
export function daysBetween(a: string, b: string): number {
  const da = parseYmd(a);
  const db = parseYmd(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86_400_000);
}
