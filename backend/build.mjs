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

// Kept external — everything else is bundled, so the host's node_modules can be stale
// or absent without breaking a deploy.
//
//   pdfkit       resolves its .afm font metrics relative to its own package directory
//                at PDF-generation time, which happens in production. Bundling it would
//                break invoice PDFs, and the boot smoke test would not catch that.
//   pino-pretty  development-only log transport. pino loads transports by module name at
//                runtime, which a bundler cannot follow; production sets transport:false.
//   @sentry/node optional, loaded through a guarded dynamic import in index.ts.
const EXTERNAL = new Set([
  'pdfkit',
  'pino-pretty',
  '@sentry/node',
  // Loaded via dynamic import in plugins/swagger.ts and registered only when
  // NODE_ENV !== 'production', so the production bundle never evaluates them.
  '@fastify/swagger',
  '@fastify/swagger-ui',
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
