#!/usr/bin/env node
// OPS-06: HSTS stops at the apex.
//
// nginx-live.conf: the `www.mvxsafe.io` server block only redirects and sets no
// Strict-Transport-Security, and the apex policy is `max-age=31536000` without
// `includeSubDomains`. So a browser that has visited mvxsafe.io still lets a
// network attacker answer http://www.mvxsafe.io (a link in an email, a typed
// address) with anything at all, and devnet.mvxsafe.io is covered only by its
// own header. The redirect itself should carry the header, and the apex should
// cover its subdomains (all of them are HTTPS already).
//
// Read-only. Exit 1 when the www redirect lacks HSTS or the apex HSTS lacks
// includeSubDomains, 0 otherwise.
//
//   node src/__audit__/ops/proofs/OPS-06-www-hsts.mjs
let bad = 0;
const www = await fetch('https://www.mvxsafe.io/', { redirect: 'manual' });
const wwwHsts = www.headers.get('strict-transport-security');
console.log(`${wwwHsts ? 'ok ' : 'BAD'} https://www.mvxsafe.io/ -> ${www.status} ${www.headers.get('location')}; HSTS: ${wwwHsts ?? '(absent)'}`);
if (!wwwHsts) bad++;

const apex = await fetch('https://mvxsafe.io/', { redirect: 'manual' });
const apexHsts = apex.headers.get('strict-transport-security') ?? '';
const covers = /includeSubDomains/i.test(apexHsts);
console.log(`${covers ? 'ok ' : 'BAD'} https://mvxsafe.io/ -> ${apex.status}; HSTS: ${apexHsts || '(absent)'}`);
if (!covers) bad++;

if (bad) {
  console.log('\nBUG (OPS-06): HSTS does not cover www.mvxsafe.io');
  process.exit(1);
}
console.log('\nOK: HSTS covers the www host and the subdomains');
