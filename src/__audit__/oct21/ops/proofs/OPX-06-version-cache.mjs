#!/usr/bin/env node
// OPX-06: /version.txt, the file that says which commit a site serves, is
// cacheable by heuristic. The document (index.html, every route) is served
// with `Cache-Control: no-cache` since the 7 Oct audit (OPS-04), but
// version.txt gets only Last-Modified and an ETag, so a browser keeps it for
// a tenth of its age without asking (a week after a deploy: 17 hours). A
// person who opens /version.txt to see what is live, after a deploy, can read
// the commit of the previous build. deploy.sh reads it with curl, which does
// not cache, so the deploy's own check is not affected.
//
// Reads the live sites (two GETs). Exit 1 while version.txt is served without
// a Cache-Control that forces revalidation, 0 once it is.
//
//   node src/__audit__/oct21/ops/proofs/OPX-06-version-cache.mjs
const hosts = ['https://mvxsafe.io', 'https://devnet.mvxsafe.io'];
const revalidates = (cc) => /\b(no-cache|no-store|max-age=0)\b/i.test(cc ?? '');

let bad = 0;
for (const host of hosts) {
  // The document is the control: it carries the header the file lacks.
  const page = await fetch(`${host}/`, { redirect: 'manual' });
  const file = await fetch(`${host}/version.txt`, { redirect: 'manual' });
  const pageCc = page.headers.get('cache-control');
  const fileCc = file.headers.get('cache-control');
  const body = (await file.text()).trim();
  console.log(
    `${host}/            -> ${page.status}, Cache-Control: ${pageCc ?? '(absent)'}`
  );
  console.log(
    `${host}/version.txt -> ${file.status} "${body}", Cache-Control: ${fileCc ?? '(absent)'}, Last-Modified: ${file.headers.get('last-modified') ?? '(absent)'}`
  );
  if (!revalidates(pageCc)) {
    console.log(
      '  (the control failed: the document itself is cacheable; see OPS-04 of 7 Oct)'
    );
  }
  if (file.status === 200 && !revalidates(fileCc)) bad += 1;
}
if (bad) {
  console.log(
    `\nBUG (OPX-06): ${bad} version.txt response(s) can be served stale from the browser cache after a deploy`
  );
  process.exit(1);
}
console.log('\nOK: version.txt is revalidated on every read');
