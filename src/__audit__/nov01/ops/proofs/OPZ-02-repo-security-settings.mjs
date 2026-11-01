#!/usr/bin/env node
// OPZ-02: the mvxsafe repository lacks the disclosure and secret-scanning settings its sister
// repository has. Read-only, through `gh api` (needs a logged-in gh) and one GET on each site.
//
// Checked for each repository and site:
//   - secret scanning and push protection (free on a public repository; a token pushed by mistake
//     is then flagged, and the push refused);
//   - private vulnerability reporting (a reporter has a private channel instead of a public issue);
//   - SECURITY.md on main;
//   - /.well-known/security.txt served as text (RFC 9116) with a Contact line.
// Exit 1 while mvxsafe lacks any of them (bug); mvxvest is the control and passes.
//
//   node src/__audit__/nov01/ops/proofs/OPZ-02-repo-security-settings.mjs
import { execFileSync } from 'node:child_process';

const gh = (path) =>
  JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
const ghOk = (path) => {
  try {
    execFileSync('gh', ['api', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
};

async function check(repo, site) {
  const problems = [];
  const sa = gh(`repos/${repo}`).security_and_analysis || {};
  if (sa.secret_scanning?.status !== 'enabled')
    problems.push('secret scanning disabled');
  if (sa.secret_scanning_push_protection?.status !== 'enabled')
    problems.push('push protection disabled');
  if (!gh(`repos/${repo}/private-vulnerability-reporting`).enabled)
    problems.push('private vulnerability reporting disabled');
  if (!ghOk(`repos/${repo}/contents/SECURITY.md`))
    problems.push('no SECURITY.md on main');
  const res = await fetch(`https://${site}/.well-known/security.txt`, {
    redirect: 'manual'
  });
  const body = res.ok ? await res.text() : '';
  const type = res.headers.get('content-type') || '';
  if (!(
    res.status === 200 &&
    type.startsWith('text/plain') &&
    /^Contact:/m.test(body)
  )) {
    problems.push(
      `/.well-known/security.txt is ${res.status} ${type || '(no type)'}${res.ok && !type.startsWith('text/plain') ? ' (the SPA fallback)' : ''}`
    );
  }
  console.log(
    `${repo} / ${site}: ${problems.length ? problems.join('; ') : 'all five in place'}`
  );
  return problems;
}

const control = await check('foxsyai/mvxvest', 'mvxvest.io');
const target = await check('foxsyai/mvxsafe', 'mvxsafe.io');
if (control.length) {
  console.log(
    '\nCONTROL FAILED: mvxvest should pass; the check itself is wrong or GitHub changed'
  );
  process.exit(2);
}
if (target.length) {
  console.log(
    `\nBUG (OPZ-02): foxsyai/mvxsafe lacks ${target.length} of the five: ${target.join('; ')}`
  );
  process.exit(1);
}
console.log(
  '\nOK: both repositories carry the same disclosure and scanning settings'
);
