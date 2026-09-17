/**
 * Bundle the backend into a single self-contained dist/index.js.
 *
 * Why: CI deploys over FTP and cannot run `npm install` on the host, so the host's
 * node_modules are frozen at whatever was installed there last. Any new or upgraded
 * package therefore fails at runtime (two outages on 2026-09-17). Bundling makes the
 * uploaded artifact independent of the host's packages.
 *
 * Strategy (conservative): packages that are known to already exist on the host and
 * that misbehave when bundled (native/optional/file-relative) stay external; everything
 * else — including our own code and any newly added package — is bundled in.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Kept external: present on the host since the original install; either optional
// (loaded with a guarded dynamic import), dev-only, or reliant on files next to the
// package on disk (pdfkit font data, swagger-ui static assets).
const EXTERNAL = new Set([
  '@sentry/node',
  'pino-pretty',
  'pdfkit',
  '@fastify/swagger',
  '@fastify/swagger-ui',
  'mysql2',
  'fastify',
  'pino',
  'bcryptjs',
  'jsonwebtoken',
  'zod',
  '@fastify/cookie',
  '@fastify/cors',
  '@fastify/helmet',
  '@fastify/multipart',
  '@fastify/rate-limit',
  '@fastify/sensible',
  '@fastify/static',
]);

const external = Object.keys(pkg.dependencies).filter((d) => EXTERNAL.has(d));
const bundled = Object.keys(pkg.dependencies).filter((d) => !EXTERNAL.has(d));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  external,
  // CJS packages bundled into ESM need a `require` shim.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

console.log(`bundled: ${bundled.join(', ') || '(none)'}`);
console.log(`external (must exist on host): ${external.join(', ')}`);
