/**
 * @jest-environment node
 */
// Open point 5, the part that ships (asked for by the review of PR #13, 21 Oct
// 2026): OPEN-05-wasm-rejection passes through jest's moduleNameMapper, but the
// bundle changes only through vite.config.ts's alias. Dropped or renamed in a
// later clean-up, the suite would stay green and the live site would log the
// unhandled rejection at every load again.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../../..');
const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');

test('vite.config.ts maps blake2b-wasm to the stand-in, as a file path', () => {
  const alias =
    /'blake2b-wasm':\s*fileURLToPath\(\s*new URL\('(\.\/[^']+)', import\.meta\.url\)\s*\)/.exec(
      config
    );
  expect(alias).not.toBeNull();
  expect(existsSync(join(ROOT, alias![1]))).toBe(true);
});

test('jest maps it to the same file', () => {
  const jest = readFileSync(join(ROOT, 'jest.config.js'), 'utf8');
  expect(jest).toMatch(
    /'\^blake2b-wasm\$': '<rootDir>\/src\/lib\/blake2b-wasm-off\.cjs'/
  );
});

test('the stand-in is never supported, calls back with an error, and rejects nothing', async () => {
  const standIn = require(join(ROOT, 'src/lib/blake2b-wasm-off.cjs'));
  expect(standIn.SUPPORTED).toBe(false);
  const answers: unknown[] = [];
  await expect(
    standIn.ready((error: unknown) => answers.push(error))
  ).resolves.toBeUndefined();
  expect(answers[0]).toBeInstanceOf(Error);
});
