#!/usr/bin/env node
// OPS-10: nothing on the live site says which commit is deployed.
//
// index.html carries no build or commit marker, there is no /version.txt (the
// SPA fallback answers index.html for it), and deploy.sh records nothing. The
// only way to establish tonight that https://mvxsafe.io runs commit 66a186e
// was to rebuild it byte for byte and compare hashes. Without a marker a stale
// deploy, a deploy from a dirty working copy, or a bundle someone replaced on
// the server cannot be told apart from the real thing by anyone, maintainer
// or board member, short of that rebuild.
//
// Read-only. Exit 1 when neither a `<meta name="commit">` (or "version") in
// index.html nor a text/plain /version.txt with a git hash exists, 0 otherwise.
//
//   node src/__audit__/ops/proofs/OPS-10-no-version-marker.mjs
const HOST = process.env.HOST || 'https://mvxsafe.io';

const index = await (await fetch(HOST + '/')).text();
const meta = index.match(/<meta\s+name="(commit|version|build)"\s+content="([^"]+)"/i);
console.log(`index.html marker: ${meta ? `${meta[1]}=${meta[2]}` : '(none)'}`);

const v = await fetch(HOST + '/version.txt');
const type = v.headers.get('content-type') || '';
const body = (await v.text()).trim();
const versionFile = v.status === 200 && /^text\/plain/.test(type) && /\b[0-9a-f]{7,40}\b/.test(body);
console.log(`/version.txt: ${v.status} ${type} ${versionFile ? body.slice(0, 60) : '(not a version file: the SPA fallback)'}`);

if (!meta && !versionFile) {
  console.log('\nBUG (OPS-10): the deployed bundle cannot be matched to a commit');
  process.exit(1);
}
console.log('\nOK: the live site states what it runs');
