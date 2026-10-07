// OPS-08: the release-age cooldown is configured as an exclusion only.
//
// pnpm-workspace.yaml carries `minimumReleaseAgeExclude: ['@multiversx/*']`
// but no `minimumReleaseAge`, and nothing sets it globally (`pnpm config get
// minimumReleaseAge` is empty on the build machine). The exclusion therefore
// does nothing, and every dependency, including the SDK that builds the
// transactions a board member signs, is eligible the minute a version is
// published. A cooldown of a day or more is the cheap defence against a
// hijacked package (the 2025 npm worm incidents were all caught within hours).
//
// Fails until pnpm-workspace.yaml sets `minimumReleaseAge` to at least one day
// (1440 minutes).
import { readFileSync } from 'fs';
import { resolve } from 'path';

const workspaceFile = resolve(__dirname, '../../../pnpm-workspace.yaml');

const settingOf = (text: string, key: string): string | undefined => {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : undefined;
};

describe('OPS-08: a release-age cooldown protects the dependency tree', () => {
  const text = readFileSync(workspaceFile, 'utf8');

  test('minimumReleaseAge is set to at least one day', () => {
    const value = settingOf(text, 'minimumReleaseAge');
    expect(value).toBeDefined();
    expect(Number(value)).toBeGreaterThanOrEqual(1440);
  });

  test('an exclusion list is not configured without the setting it excludes from', () => {
    const hasExclusion = /^minimumReleaseAgeExclude:/m.test(text);
    const hasSetting = settingOf(text, 'minimumReleaseAge') !== undefined;
    expect(hasExclusion && !hasSetting).toBe(false);
  });
});
