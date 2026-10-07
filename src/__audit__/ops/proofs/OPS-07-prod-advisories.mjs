#!/usr/bin/env node
// OPS-07: the shipped bundle is built from dependencies with known high
// advisories (as of 7 Oct 2026: axios 1.18.1, react-router-dom 6.30.4 /
// react-router 6.30.4, socket.io-parser 4.2.6, and build-time-only packages
// pulled in as runtime dependencies of @multiversx/sdk-dapp-ui).
//
// Nothing here is shown to be exploitable in this static app, so this is low:
// most axios advisories concern its Node adapter; the react-router open
// redirect needs a user-controlled navigation target (the /safe/:address route
// is the one to look at, web area). It counts because pnpm audit is not run
// anywhere (CI builds, deploy.sh builds, neither audits) and because the
// lockfile pins versions that the registry has flagged.
//
// Needs the npm registry (read-only). Exit 1 when `pnpm audit --prod` reports a
// high or critical advisory, 0 otherwise. The registry's database moves, so
// the list printed is the one that matters on the day it runs.
//
//   node src/__audit__/ops/proofs/OPS-07-prod-advisories.mjs
import { spawnSync } from 'node:child_process';

const APP = '/home/sebastian/FOXSY/mvxsafe/app';
const r = spawnSync('pnpm', ['audit', '--prod', '--json'], { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.log('pnpm audit returned no JSON (offline?):\n' + (r.stderr || r.stdout).slice(0, 400));
  process.exit(2);
}
const counts = report.metadata?.vulnerabilities ?? {};
console.log('pnpm audit --prod:', JSON.stringify(counts));
const serious = Object.values(report.advisories ?? {}).filter((a) => a.severity === 'high' || a.severity === 'critical');
const byModule = new Map();
for (const a of serious) {
  const key = `${a.module_name} ${a.findings?.[0]?.version ?? ''}`;
  if (!byModule.has(key)) byModule.set(key, []);
  byModule.get(key).push(`${a.title} (${a.vulnerable_versions})`);
}
for (const [mod, titles] of byModule) {
  console.log(`- ${mod}`);
  for (const t of titles) console.log(`    ${t}`);
}
if (serious.length) {
  console.log(`\nBUG (OPS-07): ${serious.length} high/critical advisories against production dependencies`);
  process.exit(1);
}
console.log('\nOK: no high or critical advisories against production dependencies');
