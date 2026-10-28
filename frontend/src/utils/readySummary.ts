export interface ReadyFields {
  instructor_ready_at?: string | null;
  instructor_ready_distance_m?: number | null;
  instructor_ready_accuracy_m?: number | null;
  instructor_ready_located?: number | boolean | null;
}

/**
 * What the course admin sees about an instructor's "I'm ready" tap: when, and how far from
 * the venue their phone was. `warn` is set when they were clearly somewhere else. Null when
 * they have not tapped.
 */
export function readySummary(c: ReadyFields): { text: string; warn: boolean } | null {
  if (!c.instructor_ready_at) return null;
  const when = new Date(c.instructor_ready_at)
    .toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
  const d = c.instructor_ready_distance_m;
  if (d != null) {
    // Phone location can be off by the reported accuracy; only call it far beyond that
    const far = d > Math.max(500, (c.instructor_ready_accuracy_m ?? 0) * 2);
    return { text: `Ready ${when}, ${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`} from venue`, warn: far };
  }
  return {
    text: c.instructor_ready_located ? `Ready ${when}, venue address too general to check` : `Ready ${when}, no location shared`,
    warn: false,
  };
}
