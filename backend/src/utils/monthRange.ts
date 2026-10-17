/**
 * A `month` filter as a half-open date range [start, nextMonthStart).
 *
 * Accepts `YYYY-MM` or `YYYY-M` (month pickers send YYYY-MM; Firefox and
 * Safari show a plain text box). A bare `1`-`12` means that month of the
 * current year: a month alone must never match the same month in every year.
 * Returns null for anything else. A range on the raw column (not
 * MONTH(col) = ?) also lets MariaDB use its index.
 */
export function monthRange(month: string, today = new Date()): [string, string] | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(month.trim()) ?? (/^\d{1,2}$/.test(month.trim()) ? [month, String(today.getFullYear()), month.trim()] : null);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const next = mon === 12 ? [year + 1, 1] : [year, mon + 1];
  const fmt = (y: number, mo: number) => `${y}-${String(mo).padStart(2, '0')}-01`;
  return [fmt(year, mon), fmt(next[0], next[1])];
}

/** `monthRange`, or a 400 the user can act on when the value isn't a month. */
export function monthRangeOrThrow(month: string): [string, string] {
  const range = monthRange(month);
  if (!range) throw Object.assign(new Error('Month must look like 2026-03'), { statusCode: 400 });
  return range;
}
