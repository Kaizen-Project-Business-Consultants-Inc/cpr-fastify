/**
 * Generate docs/API.md from the live route table (via @fastify/swagger).
 *
 *   npm run docs:api            (from backend/)
 *
 * Builds the app with a lazily-created (never connected) DB pool, reads the OpenAPI
 * document, and writes a Markdown reference grouped by tag. CI regenerates this and
 * fails if docs/API.md differs from the committed file, so the reference cannot drift.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal environment so config/env.ts validates without a real database.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DB_USER ??= 'docs';
process.env.DB_PASSWORD ??= 'docs';
process.env.DB_NAME ??= 'docs';
process.env.JWT_ACCESS_SECRET ??= 'docs-generation-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET ??= 'docs-generation-refresh-secret-0123456789';
process.env.FRONTEND_URL ??= 'http://localhost:5173';

const { initPoolForTooling } = await import('../src/config/database.js');
initPoolForTooling();
const { buildApp } = await import('../src/app.js');

type Op = { tags?: string[]; summary?: string; description?: string; security?: unknown[] };
type Paths = Record<string, Record<string, Op>>;

const app = await buildApp();
await app.ready();
// swagger is registered inside the /api/v1 plugin context, so read the spec over HTTP.
const res = await app.inject({ method: 'GET', url: '/api/v1/docs/json' });
if (res.statusCode !== 200) throw new Error(`Could not read OpenAPI spec: HTTP ${res.statusCode}`);
const spec = res.json() as { paths: Paths; tags?: { name: string; description?: string }[]; info: { title: string; version: string } };
await app.close();

// Routes registered outside the swagger prefix (root-level): document by hand.
const extra: Array<[string, string, string, string]> = [
  ['Health', 'GET', '/health', 'Liveness + DB check (root, outside /api/v1)'],
  ['Health', 'GET', '/metrics', 'Request counts, error rate, latency (root, outside /api/v1)'],
];

const methodOrder = ['get', 'post', 'put', 'patch', 'delete'];
const byTag = new Map<string, Array<{ method: string; path: string; note: string; auth: string }>>();

const tagFor = (p: string, op: Op) => {
  if (op.tags?.length) return op.tags[0];
  const seg = '/' + (p.replace(/^\/api\/v1/, '').split('/')[1] ?? '');
  return seg === '/' ? 'Misc' : seg.slice(1).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

for (const [path, ops] of Object.entries(spec.paths)) {
  for (const method of methodOrder) {
    const op = ops[method];
    if (!op) continue;
    const tag = tagFor(path, op);
    const list = byTag.get(tag) ?? [];
    const publicRoute = /\/auth\/(login|refresh|logout|forgot-password|recover-password|reset-password)$|\/health$|\/client-errors$|\/config$/.test(path);
    list.push({
      method: method.toUpperCase(),
      path: path.replace(/^\/api\/v1/, ''),
      note: op.summary || op.description || '',
      auth: publicRoute ? 'No' : 'Bearer',
    });
    byTag.set(tag, list);
  }
}
for (const [tag, method, path, note] of extra) {
  const list = byTag.get(tag) ?? [];
  list.push({ method, path, note, auth: 'No' });
  byTag.set(tag, list);
}

const tagDesc = new Map((spec.tags ?? []).map((t) => [t.name, t.description ?? '']));
const tags = [...byTag.keys()].sort((a, b) => a.localeCompare(b));
const total = [...byTag.values()].reduce((n, l) => n + l.length, 0);

let md = `# API Reference

_Generated from the route table by \`npm run docs:api\` (backend/scripts/generate-api-docs.ts). Do not edit by hand — CI fails if this file is stale._

Base URL: \`/api/v1\` (except the two root-level health/metrics endpoints).
Auth: send the access token as \`Authorization: Bearer <token>\`. Role guards are enforced per route (\`requireRole\`); see the route file for the exact roles.

**${total} endpoints across ${tags.length} groups.**

`;
for (const tag of tags) {
  const list = byTag.get(tag)!;
  list.sort((a, b) => a.path.localeCompare(b.path) || methodOrder.indexOf(a.method.toLowerCase()) - methodOrder.indexOf(b.method.toLowerCase()));
  md += `## ${tag}\n\n`;
  if (tagDesc.get(tag)) md += `${tagDesc.get(tag)}\n\n`;
  md += `| Method | Path | Auth | Notes |\n|---|---|---|---|\n`;
  for (const r of list) md += `| ${r.method} | \`${r.path}\` | ${r.auth} | ${r.note.replace(/\|/g, '\\|')} |\n`;
  md += '\n';
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/API.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md);
console.log(`Wrote ${out}: ${total} endpoints in ${tags.length} groups`);
process.exit(0);
