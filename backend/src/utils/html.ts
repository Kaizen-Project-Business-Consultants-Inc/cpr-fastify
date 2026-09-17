/**
 * HTML escaping helpers for server-rendered HTML (invoice previews, emails).
 *
 * Usage:
 *   safeHtml`<p>${userInput}</p>`        -> userInput is escaped
 *   safeHtml`<div>${raw(trustedHtml)}</div>` -> trustedHtml inserted as-is
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/** Marker for HTML that has already been escaped or is trusted. */
export class RawHtml {
  constructor(public readonly html: string) {}
  toString(): string { return this.html; }
}

export function raw(html: string | RawHtml): RawHtml {
  return html instanceof RawHtml ? html : new RawHtml(html);
}

/** Tagged template: escapes every interpolated value unless it is RawHtml. */
export function safeHtml(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v instanceof RawHtml) out += v.html;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof RawHtml ? x.html : escapeHtml(x))).join('');
      else out += escapeHtml(v);
    }
  }
  return out;
}
