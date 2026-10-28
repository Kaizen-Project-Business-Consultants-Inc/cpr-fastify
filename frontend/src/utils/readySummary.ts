export interface ReadyFields {
  instructor_ready_at?: string | null;
  instructor_ready_distance_m?: number | null;
}

/**
 * What the course admin sees about an instructor's "I'm ready" check-in: when, and how far
 * from the venue they were (check-in is only accepted within the allowed distance). Null
 * until they check in. Older check-ins, from before the distance was required, show the time only.
 */
export function readySummary(c: ReadyFields): string | null {
  if (!c.instructor_ready_at) return null;
  const when = new Date(c.instructor_ready_at)
    .toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
  const d = c.instructor_ready_distance_m;
  if (d == null) return `Ready ${when}`;
  return `Ready ${when}, ${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`} from venue`;
}
