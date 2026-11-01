// OPZ-02, the files. The proof in proofs/ reads GitHub's main and the live site,
// so it can only pass after a merge, a deploy and the owner's three settings.
// This pins what the repository itself must carry: a reporter finds a private
// channel at the place RFC 9116 says, and it is this repository's, not the
// sister's.
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../../..');
const REPORT_URL = 'https://github.com/foxsyai/mvxsafe/security/advisories/new';
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('OPZ-02: the disclosure files', () => {
  test('SECURITY.md asks for a private report', () => {
    expect(existsSync(resolve(root, 'SECURITY.md'))).toBe(true);
    const text = read('SECURITY.md');
    expect(text).toMatch(/never in a public issue/);
    expect(text).toMatch(/Report a\s+vulnerability/);
    expect(text).not.toMatch(/mvxvest/i);
  });

  describe('public/.well-known/security.txt', () => {
    const path = 'public/.well-known/security.txt';

    test('exists, so Vite copies it and the SPA fallback does not answer', () => {
      expect(existsSync(resolve(root, path))).toBe(true);
    });

    test('names this repository and carries the fields RFC 9116 requires', () => {
      const text = read(path);
      expect(text).toMatch(new RegExp(`^Contact: ${REPORT_URL}$`, 'm'));
      expect(text).toMatch(
        /^Policy: https:\/\/github\.com\/foxsyai\/mvxsafe\/blob\/main\/SECURITY\.md$/m
      );
      expect(text).not.toMatch(/mvxvest/i);
      const expires = text.match(/^Expires: (\S+)$/m)?.[1] ?? '';
      expect(Number.isNaN(Date.parse(expires))).toBe(false);
    });
  });

  test('control: the file a deploy already serves is where this one will be', () => {
    expect(existsSync(resolve(root, 'public/robots.txt'))).toBe(true);
  });
});
