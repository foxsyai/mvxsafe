#!/usr/bin/env node
// OPS-05: the hashed assets are served without the security headers.
//
// nginx-live.conf, server mvxsafe.io: six add_header lines at server level, and
// a `location ~* \.(css|js|woff2?|png|...)$` block with its own
// `add_header Cache-Control "public"`. In nginx, add_header directives are
// inherited from the enclosing level ONLY when the current level has none, so
// that one line removes Strict-Transport-Security, X-Content-Type-Options,
// X-Frame-Options, Referrer-Policy, Permissions-Policy and the
// Content-Security-Policy from every script, stylesheet, font, image and SVG
// response. The document still carries them, which is why the site works; but
// an SVG opened directly is an unrestricted document, scripts go out without
// nosniff, and anyone auditing the headers of the bundle sees none.
//
// Read-only. Exit 1 when a script asset of the live site lacks any of the
// three headers that matter on an asset (HSTS, nosniff, CSP), 0 otherwise.
//
//   node src/__audit__/ops/proofs/OPS-05-asset-headers.mjs
const HOST = process.env.HOST || 'https://mvxsafe.io';
const WANT = ['strict-transport-security', 'x-content-type-options', 'content-security-policy'];

const index = await (await fetch(HOST + '/')).text();
const js = index.match(/\/assets\/index-[^"]+\.js/)?.[0];
if (!js) {
  console.log('could not find the script in index.html; nothing proven');
  process.exit(2);
}
let bad = 0;
for (const p of [js, '/mvxsafe-icon.svg']) {
  const r = await fetch(HOST + p, { method: 'HEAD' });
  const missing = WANT.filter((h) => !r.headers.has(h));
  console.log(`${missing.length ? 'BAD' : 'ok '} HEAD ${HOST}${p} -> ${r.status} ${r.headers.get('content-type')}`);
  console.log(`      Cache-Control: ${r.headers.get('cache-control')}`);
  console.log(`      missing: ${missing.length ? missing.join(', ') : 'none'}`);
  if (missing.length) bad++;
}
if (bad) {
  console.log(`\nBUG (OPS-05): ${bad} asset response(s) lost the server-level security headers`);
  process.exit(1);
}
console.log('\nOK: assets carry the security headers');
