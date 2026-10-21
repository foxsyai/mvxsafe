#!/usr/bin/env node
// OPX-05: the locked production tree carries high advisories that have a fixed
// release, and nothing in the pipeline would notice: neither CI (ci.yml) nor
// deploy.sh runs `pnpm audit`. The 7 Oct fix added overrides for the
// advisories of that day; new ones have arrived since (follow-redirects
// 1.16.0, an axios dependency) and sit in pnpm-lock.yaml unnoticed.
//
// None of the current ones is reachable in the browser bundle (follow-redirects
// is axios's Node adapter, which Vite does not bundle), so this is hygiene:
// the pipeline has no step that turns a known advisory into a red check.
//
// Needs the npm registry (read-only). Advisories with no fixed release at all
// (patched_versions "<0.0.0", e.g. braces) are listed but do not count: no
// change could make them pass. Exit 1 when `pnpm audit --prod` reports a high
// or critical advisory that has a fixed release, 0 otherwise.
//
//   node src/__audit__/oct21/ops/proofs/OPX-05-prod-advisories.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The repository root, five levels above this file.
const APP = fileURLToPath(new URL('../../../../../', import.meta.url)).replace(
  /\/$/,
  ''
);
const r = spawnSync('pnpm', ['audit', '--prod', '--json'], {
  cwd: APP,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
});
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.log(
    'pnpm audit returned no JSON (offline?):\n' +
      (r.stderr || r.stdout).slice(0, 400)
  );
  process.exit(2);
}
console.log(
  'pnpm audit --prod:',
  JSON.stringify(report.metadata?.vulnerabilities ?? {})
);
const serious = Object.values(report.advisories ?? {}).filter(
  (a) => a.severity === 'high' || a.severity === 'critical'
);
const fixable = [];
for (const a of serious) {
  const version = a.findings?.[0]?.version ?? '';
  const noFix = !a.patched_versions || a.patched_versions === '<0.0.0';
  console.log(
    `- ${a.module_name} ${version}: ${a.title} (vulnerable ${a.vulnerable_versions}; ${noFix ? 'NO fixed release yet, not counted' : 'fixed in ' + a.patched_versions})`
  );
  if (!noFix) fixable.push(a);
}
if (fixable.length) {
  console.log(
    `\nBUG (OPX-05): ${fixable.length} high/critical advisories with a fixed release against production dependencies, and no pipeline step runs pnpm audit`
  );
  process.exit(1);
}
console.log(
  '\nOK: no high or critical advisory with a fixed release against production dependencies'
);
