#!/usr/bin/env node
// OPS-04: index.html is served without any Cache-Control, so browsers may keep
// it by heuristic (10% of its age since Last-Modified) and, after a deploy that
// `rsync --delete`d the old hashed bundle, a returning signer gets an index.html
// that points at a script which no longer exists: a blank page until a hard
// reload, or, if only index.html changed, the old bundle. The hashed assets are
// cacheable for 30 days, which is right; the entry document must revalidate.
//
// Read-only: two GETs on the live site. Exit 1 when the document (and the SPA
// fallback for a safe route) lacks a Cache-Control that forces revalidation
// (no-cache, no-store or max-age=0 with must-revalidate), 0 otherwise.
//
//   node src/__audit__/ops/proofs/OPS-04-index-cache.mjs
const HOST = process.env.HOST || 'https://mvxsafe.io';
const paths = ['/', '/safe/erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p'];

const revalidates = (cc) =>
  /\bno-store\b/.test(cc) || /\bno-cache\b/.test(cc) || (/\bmax-age=0\b/.test(cc) && /\bmust-revalidate\b/.test(cc));

let bad = 0;
for (const p of paths) {
  const r = await fetch(HOST + p, { redirect: 'manual' });
  const cc = r.headers.get('cache-control') ?? '(absent)';
  const lm = r.headers.get('last-modified') ?? '(absent)';
  const ageH = lm === '(absent)' ? NaN : (Date.now() - Date.parse(lm)) / 3.6e6;
  const heuristic = Number.isNaN(ageH) ? 'n/a' : `${(ageH / 10).toFixed(1)} h`;
  const ok = revalidates(cc);
  console.log(`${ok ? 'ok ' : 'BAD'} GET ${HOST}${p} -> ${r.status} ${r.headers.get('content-type')}`);
  console.log(`      Cache-Control: ${cc}`);
  console.log(`      Last-Modified: ${lm} (age ${Number.isNaN(ageH) ? '?' : ageH.toFixed(1)} h, heuristic freshness ${heuristic})`);
  if (!ok) bad++;
}
if (bad) {
  console.log(`\nBUG (OPS-04): ${bad} document response(s) can be served stale from the browser cache after a deploy`);
  process.exit(1);
}
console.log('\nOK: the entry document is always revalidated');
