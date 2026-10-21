// OPX-04: every GitHub Action the workflows use must be pinned to a full
// commit SHA. A tag such as @v4 is a mutable pointer the action's maintainer
// (or whoever takes over their account) can move to any commit; the workflows
// that run with the review token and the checks App's key pin their actions,
// but ci.yml still takes pnpm/action-setup@v4, and the repository does not
// require SHA pinning (Actions settings: sha_pinning_required is false).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// src/__audit__/oct21/ops -> the repository root is four levels up.
const workflows = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows'
);

const usesOf = () => {
  const out: { file: string; ref: string }[] = [];
  for (const file of readdirSync(workflows)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const text = readFileSync(join(workflows, file), 'utf8');
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      out.push({ file, ref: m[1] });
    }
  }
  return out;
};

const pinned = (ref: string) =>
  ref.startsWith('./') || /@[0-9a-f]{40}$/.test(ref);

describe('OPX-04: the workflows pin every action to a commit', () => {
  it('reads the workflows and recognises a pinned action (control)', () => {
    const uses = usesOf();
    expect(uses.length).toBeGreaterThan(3);
    expect(
      uses.some((u) => /^actions\/checkout@[0-9a-f]{40}$/.test(u.ref))
    ).toBe(true);
    expect(
      pinned('actions/checkout@11d5960a326750d5838078e36cf38b85af677262')
    ).toBe(true);
    expect(pinned('pnpm/action-setup@v4')).toBe(false);
  });

  it('no action is taken from a mutable tag or branch', () => {
    const unpinned = usesOf().filter((u) => !pinned(u.ref));
    expect(unpinned).toEqual([]);
  });
});
