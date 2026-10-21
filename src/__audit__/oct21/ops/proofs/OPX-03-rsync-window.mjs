#!/usr/bin/env node
// OPX-03: the publish step is not atomic. deploy.sh uploads with
// `rsync -a --delete build/ host:dir/`, which (rsync 3: --delete-during)
// removes the previous hashed assets from assets/ BEFORE the new ones have
// arrived and replaces index.html only AFTER them (the file list is sorted,
// assets/ comes first). For the whole upload, which is seconds over the
// internet, the server holds the OLD index.html pointing at assets that no
// longer exist: a visitor who loads the site then (index.html is no-cache, so
// a revalidation gets that old page) sees a blank page until a reload.
//
// This reproduces the window on the local disk with the very rsync options
// deploy.sh uses, read from deploy.sh itself, throttled with --bwlimit so the
// upload takes a few seconds, while a poller reads www/index.html and checks
// that the script it names exists. Exit 1 when the served tree was
// inconsistent at any sample (bug), 0 when every sample was consistent.
//
//   node src/__audit__/oct21/ops/proofs/OPX-03-rsync-window.mjs
//   RSYNC_OPTS='-a --delete --delay-updates --delete-delay' node ...   # expected: exit 0
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repository root, five levels above this file.
const APP = fileURLToPath(new URL('../../../../../', import.meta.url)).replace(
  /\/$/,
  ''
);

let opts = process.env.RSYNC_OPTS?.split(/\s+/).filter(Boolean);
if (!opts) {
  const line = readFileSync(join(APP, 'deploy.sh'), 'utf8').match(
    /^\s*rsync\s+(.*?)\s+build\/\s+/m
  );
  if (!line) {
    console.log(
      'deploy.sh no longer publishes with an in-place rsync of build/: nothing to test'
    );
    process.exit(0);
  }
  opts = line[1].split(/\s+/).filter(Boolean);
}
console.log(`rsync options under test: ${opts.join(' ')}`);

const tmp = mkdtempSync(join(tmpdir(), 'mvxsafe-opx03-'));
// Two builds of the site, an hour apart (rsync -a takes a same-sized file with
// the same mtime as unchanged, and a real build is never the same minute).
const site = (dir, tag, when) => {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const files = {
    'index.html': `<!doctype html><script type="module" src="/assets/index-${tag}.js"></script><link rel="stylesheet" href="/assets/index-${tag}.css">`,
    [`assets/index-${tag}.js`]: randomBytes(2 * 1024 * 1024),
    [`assets/index-${tag}.css`]: randomBytes(64 * 1024),
    'version.txt': `${tag}\n`
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
    utimesSync(join(dir, name), when, when);
  }
};
const now = Date.now() / 1000;
site(join(tmp, 'old'), 'OLD00000', now - 3600);
site(join(tmp, 'new'), 'NEW00000', now);
cpSync(join(tmp, 'old'), join(tmp, 'www'), {
  recursive: true,
  preserveTimestamps: true
});
const www = join(tmp, 'www');

const served = () => {
  const html = readFileSync(join(www, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\/assets\/([^"]+)"/g)].map((m) => m[1]);
  const missing = refs.filter((f) => !existsSync(join(www, 'assets', f)));
  return { index: html.includes('NEW00000') ? 'new' : 'old', missing };
};

// 400 KB/s: the 2 MB bundle takes about five seconds, like a real upload.
const rsync = spawn('rsync', [
  ...opts,
  '--bwlimit=400',
  join(tmp, 'new') + '/',
  www + '/'
]);
const t0 = Date.now();
const samples = [];
let firstBad = null;
let lastBad = null;
const timer = setInterval(() => {
  const s = served();
  samples.push(s);
  if (s.missing.length) {
    lastBad = Date.now() - t0;
    if (firstBad === null) firstBad = lastBad;
  }
}, 25);
const code = await new Promise((resolve) => rsync.on('close', resolve));
clearInterval(timer);
const after = served();
const bad = samples.filter((s) => s.missing.length);
const example = bad[0];
rmSync(tmp, { recursive: true, force: true });

console.log(
  `rsync exit ${code} after ${((Date.now() - t0) / 1000).toFixed(1)} s; ${samples.length} samples of the served tree`
);
console.log(
  `after the upload: index.html is ${after.index}, missing assets: ${after.missing.length ? after.missing.join(', ') : 'none'}`
);
if (bad.length) {
  console.log(
    `inconsistent for ${((lastBad - firstBad) / 1000).toFixed(1)} s (from ${firstBad} ms to ${lastBad} ms): ${bad.length} of ${samples.length} samples served the ${example.index} index.html while it named ${example.missing.join(', ')}, which did not exist`
  );
  console.log(
    '\nBUG (OPX-03): during the upload the site serves an index.html whose assets are gone: a blank page for whoever loads it then'
  );
  process.exit(1);
}
console.log(
  '\nOK: at every sample the served index.html named assets that existed'
);
