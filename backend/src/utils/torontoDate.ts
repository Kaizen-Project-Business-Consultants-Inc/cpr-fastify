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
