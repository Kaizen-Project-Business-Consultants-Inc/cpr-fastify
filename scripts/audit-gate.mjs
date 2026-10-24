// Fails on any high/critical production advisory except the ones listed in
// ACCEPTED, each with a reason and a way out. Replaces a bare
// `npm audit --omit=dev --audit-level=high`, which can't ignore an advisory.
import { execSync } from 'node:child_process';

const ACCEPTED = {
  // zod 3 -> 4 is a breaking upgrade; needs its own change. Only reachable by
  // sending the server oversized collections. Remove once zod is on >=4.6.6.
  'GHSA-mrhx-c7xc-m3w5': 'zod memory exhaustion (upgrade to zod 4 pending)',
};

let raw;
try {
  raw = execSync('npm audit --omit=dev --json', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
} catch (e) {
  raw = e.stdout ?? ''; // npm audit exits non-zero when it finds anything
}

// Fail closed: an audit that couldn't run (registry down, rate limit, new npm
// format) must not read as "no vulnerabilities".
let report;
try {
  report = JSON.parse(raw);
} catch {
  report = null;
}
if (!report || report.error || report.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
  console.error('npm audit did not return a usable report:', String(raw).slice(0, 500));
  process.exit(1);
}

const blocking = [];
for (const [name, v] of Object.entries(report.vulnerabilities)) {
  if (v.severity !== 'high' && v.severity !== 'critical') continue;
  const advisories = (v.via ?? []).filter((x) => typeof x === 'object');
  // A package is only blocking if some advisory against it isn't accepted.
  // Entries with no advisory objects are transitive and covered by their parent.
  const open = advisories.filter((a) => !Object.hasOwn(ACCEPTED, (a.url ?? '').split('/').pop()));
  if (advisories.length > 0 && open.length > 0) blocking.push(`${name}: ${open.map((a) => a.title).join('; ')}`);
}

for (const [id, why] of Object.entries(ACCEPTED)) console.log(`accepted ${id}: ${why}`);
if (blocking.length) {
  console.error('Blocking high/critical advisories:\n  ' + blocking.join('\n  '));
  process.exit(1);
}
console.log('Audit gate passed.');
