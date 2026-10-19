/** Today's date in Toronto, where the courses run, as YYYY-MM-DD. */
export function torontoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now);
}
