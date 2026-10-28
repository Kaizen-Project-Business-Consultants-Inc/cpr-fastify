/** Today's date in Toronto, where the courses run, as YYYY-MM-DD. */
export function torontoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now);
}

/**
 * Today in Toronto as a SQL DATE, for certificate expiry checks. Expiry dates
 * are stored as midnight of the expiry day, and a certificate is valid through
 * that whole day. NOW() and CURDATE() are UTC on the server, so they moved to
 * the next day at 8 pm Toronto and expired certificates about 4 hours early.
 */
export function torontoTodaySql(now: Date = new Date()): string {
  const day = torontoToday(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Unexpected Toronto date: ${day}`);
  return `DATE('${day}')`;
}

/**
 * The UTC instant (ms) of a wall-clock time in Toronto, e.g. ('2026-10-28', '09:00').
 * Class times are stored as plain Toronto date + time, but the server runs on UTC.
 */
export function torontoWallTimeToMs(day: string, time: string): number {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Toronto's offset from UTC at that moment (-4 or -5 h). Two passes settle the DST edge.
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - ms;
  };
  let ms = wall - offsetAt(wall);
  ms = wall - offsetAt(ms);
  return ms;
}
