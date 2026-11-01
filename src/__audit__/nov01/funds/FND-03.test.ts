/**
 * @jest-environment node
 *
 * FND-03: fifty tokens sent by a stranger hide the safe's real token from the
 * page and from the Send form.
 *
 * readBalances reads /accounts/<safe>/tokens?size=50 and nothing else: no
 * second page, no count. The API orders a holder's tokens by identifier, not
 * by value (mainnet, 1 Nov 2026: a 28-token account lists its tokens in
 * alphabetical order, the one worth most in the middle). Anyone can send a
 * safe any token (it is payable), so fifty tokens whose identifiers sort before
 * the safe's real token, issued for 0.05 EGLD each or already in a spammer's
 * hands, push it past the fiftieth place: the holdings card no longer lists it,
 * the token tile shows a junk token, and the Send form, whose select is
 * overview.tokens, cannot propose a transfer of it at all.
 *
 * Correct behaviour, asserted here: what the safe holds is read whole, however
 * many tokens have been sent to it, so the real token is listed and can be sent.
 */
jest.mock('multisig/network', () => {
  const { networkMock } = require('../../display/fixtures');
  const junk = Array.from({ length: 50 }, (_, at) => ({
    identifier: `AAA${String.fromCharCode(65 + Math.floor(at / 26))}${String.fromCharCode(65 + (at % 26))}-${at.toString(16).padStart(6, '0')}`,
    ticker: 'AAA',
    name: 'junk',
    balance: '1',
    decimals: 0
  }));
  const real = {
    identifier: 'TOKEN-abc123',
    ticker: 'TOKEN',
    name: 'Token',
    balance: '1360000000000000000000000000',
    decimals: 18,
    valueUsd: 2000000
  };
  // The API's order: by identifier.
  const all = [...junk, real].sort((a, b) =>
    a.identifier.localeCompare(b.identifier)
  );
  return {
    ...networkMock,
    api: async (path: string) => {
      const tokens = /^\/accounts\/[^/]+\/tokens(\/count)?(\?(.*))?$/.exec(
        path
      );
      if (tokens) {
        const params = new URLSearchParams(tokens[3] ?? '');
        let list = all;
        const identifier = params.get('identifier');
        const search = params.get('search');
        if (identifier)
          list = list.filter((token) => token.identifier === identifier);
        if (search)
          list = list.filter((token) =>
            token.identifier.toLowerCase().includes(search.toLowerCase())
          );
        if (tokens[1]) return list.length;
        const from = Number(params.get('from') ?? 0);
        const size = Number(params.get('size') ?? 25);
        return list.slice(from, from + size);
      }
      return networkMock.api(path);
    }
  };
});

import { readBalances } from 'multisig/reads';
import { SAFE } from '../../display/fixtures';

test('control: the junk tokens are read', async () => {
  const { tokens } = await readBalances(SAFE);
  expect(tokens.length).toBeGreaterThanOrEqual(50);
  expect(tokens.some((token) => token.identifier.startsWith('AAA'))).toBe(true);
});

test("the safe's real token is still listed when fifty junk tokens sort before it", async () => {
  const { tokens } = await readBalances(SAFE);
  const real = tokens.find((token) => token.identifier === 'TOKEN-abc123');
  expect(real).toBeDefined();
  expect(real!.amount).toBe(1360000000);
});
