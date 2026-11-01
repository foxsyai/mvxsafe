#!/usr/bin/env node
// OPZ-08: a high advisory with a fixed release sits in the locked production tree again, so the
// audit gate of 21 Oct 2026 (OPX-05) is red: `pnpm audit --prod --audit-level=high` exits 1, which
// makes deploy.sh refuse the next release and the CI job fail on the next merge candidate.
//
// On 1 Nov 2026 it is follow-redirects 1.16.1 (GHSA-mrwp-f3q8-3g9p, published 30 Oct 2026, fixed in
// 1.16.2): the exact version the 21 Oct override pinned. It is axios's Node adapter and never
// reaches the browser bundle, so this is the gate doing its job, not a hole in the site; but the
// override has to move before anything can ship, and the sister repository (mvxvest) has no audit
// step in CI or in its deploy script, so nothing there would say so.
//
// Needs the npm registry (read-only). Advisories with no fixed release at all do not count. Exit 1
// while the production tree carries a high or critical advisory that has a fixed release.
//
//   node src/__audit__/nov01/ops/proofs/OPZ-08-prod-advisories.mjs
//   MVXVEST=/path/to/mvxvest node ...        # also checks that repository's dapp/
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../../../../../', import.meta.url)).replace(
  /\/$/,
  ''
);

function audit(dir, label) {
  const run = spawnSync(
    'pnpm',
    ['audit', '--prod', '--audit-level=high', '--json'],
    {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    }
  );
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.log(
      `${label}: pnpm audit gave no JSON (${(run.stderr || '').trim().slice(0, 200)})`
    );
    return null;
  }
  const fixable = Object.values(report.advisories || {}).filter(
    (a) =>
      ['high', 'critical'].includes(a.severity) &&
      a.patched_versions &&
      a.patched_versions !== '<0.0.0'
  );
  console.log(
    `${label}: pnpm audit --prod exit ${run.status}; ${JSON.stringify(report.metadata?.vulnerabilities || {})}`
  );
  for (const a of fixable) {
    console.log(
      `  - ${a.module_name} ${a.findings?.[0]?.version || ''}: ${a.title} (vulnerable ${a.vulnerable_versions}; fixed in ${a.patched_versions}) ${a.github_advisory_id || ''}`
    );
  }
  return fixable;
}

let bad = 0;
const app = audit(APP, 'mvxsafe');
if (app === null || app.length) bad++;
if (process.env.MVXVEST) {
  const vest = audit(`${process.env.MVXVEST}/dapp`, 'mvxvest dapp');
  if (vest === null || vest.length) bad++;
}
if (bad) {
  console.log(
    '\nBUG (OPZ-08): a high advisory with a fixed release is in the locked production tree; the audit gate is red, so the next deploy is refused until the override moves'
  );
  process.exit(1);
}
console.log(
  '\nOK: no high or critical advisory with a fixed release in the production tree'
);
