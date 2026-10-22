/**
 * @jest-environment node
 */
// EXT-01, the gap the mvxvest side found on 23 Oct 2026 while checking the
// 21 Oct fixes live: readAccountFacts hashes the code the API returns, but
// when the answer carries no usable code (missing, empty, odd length, not
// hex) it fell back to the hash the API states. A signer who pasted the
// release hash then saw it match on the API's word alone, the trust EXT-01
// removed, and the source's size, which the upgrade's gas is worked out from,
// was unknown.
//
// Correct behaviour: such a hash is unverified. Nothing is green on it, the
// upgrade carries a blocking red check saying the code could not be read and
// to try again, and the card is told so.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import {
  expectedHashCheck,
  inspectUpgrade,
  readAccountFacts
} from 'multisig/inspect';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockCode
} from '../../../multisig/tests/contractsMock';
import { ALICE, CAROL, SAFE } from '../../display/fixtures';

const TARGET = predictSafeAddress(CAROL, 40);
const SOURCE = predictSafeAddress(ALICE, 60); // shard 1, the safe's
const OLD_CODE = mockCode('old');
const NEW_CODE = mockCode('new');
const fields = [TARGET, 0n, SOURCE, Uint8Array.of(0x05, 0x00), []];

const blocking = (
  checks: { tone: string; advisory?: boolean; text: string }[]
) => checks.filter((check) => check.tone === 'bad' && !check.advisory);

/** The source as the API states it, with the code it returns replaced. */
const sourceWithCode = (code: unknown) => ({
  ...contract({ owner: ALICE, hash: NEW_CODE, upgradeable: false }),
  code
});

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: OLD_CODE });
  mockAccounts[SOURCE] = contract({
    owner: ALICE,
    hash: NEW_CODE,
    upgradeable: false
  });
});

test('control: code returned and hashed, the hash is verified and nothing blocks', async () => {
  const facts = await readAccountFacts(SOURCE);
  expect(facts.codeHash).toBe(NEW_CODE);
  expect(facts.codeUnread).toBe(false);
  const { checks, upgrade } = await inspectUpgrade(fields, SAFE);
  expect(blocking(checks)).toEqual([]);
  expect(upgrade?.sourceHash).toBe(NEW_CODE);
  expect(expectedHashCheck(NEW_CODE, upgrade?.sourceHash ?? null)?.tone).toBe(
    'ok'
  );
});

test.each([
  ['no code at all', undefined],
  ['empty code', ''],
  ['code of odd length', 'abc'],
  ['code that is not hex', 'zz'.repeat(100)]
])(
  'a source whose answer has %s: unverified, red, and no match on the stated hash',
  async (_, code) => {
    mockAccounts[SOURCE] = sourceWithCode(code);
    const facts = await readAccountFacts(SOURCE);
    expect(facts.codeUnread).toBe(true);

    const { checks, upgrade } = await inspectUpgrade(fields, SAFE);
    expect(
      blocking(checks).some((check) =>
        /did not return the source's code[\s\S]*try again/i.test(check.text)
      )
    ).toBe(true);
    // The card has no hash to call a match: the release hash pasted is not green.
    expect(upgrade?.sourceHash).toBeNull();
    expect(upgrade?.sourceUnread).toBe(true);
    const pasted = expectedHashCheck(
      NEW_CODE,
      upgrade?.sourceHash ?? null,
      'the source',
      true
    );
    expect(pasted?.tone).toBe('bad');
    expect(pasted?.text).toMatch(/could not be read/i);
  }
);

test('the contract to upgrade with no usable code: unverified and red too', async () => {
  mockAccounts[TARGET] = {
    ...contract({ owner: SAFE, hash: OLD_CODE }),
    code: undefined
  };
  const { checks, upgrade } = await inspectUpgrade(fields, SAFE);
  expect(
    blocking(checks).some((check) =>
      /did not return the code of the contract to upgrade/i.test(check.text)
    )
  ).toBe(true);
  expect(upgrade?.targetHash).toBeNull();
});

// The review of PR #17: an unread code still got a size, so the upgrade's gas
// was shown as measured for code that was never read.
test.each([
  ['code of odd length', 'abc'],
  ['code that is not hex', 'zz'.repeat(100)]
])(
  'a source whose answer has %s has no size, and its gas is not called measured',
  async (_, code) => {
    mockAccounts[SOURCE] = sourceWithCode(code);
    expect((await readAccountFacts(SOURCE)).codeBytes).toBe(0);
    const { perform } = await inspectUpgrade(fields, SAFE);
    expect(perform.simulate).toBe(false);
    expect(perform.simulate === false && perform.known).toBe(false);
  }
);

test('control: code returned and hashed has its size, and its gas is measured', async () => {
  const facts = await readAccountFacts(SOURCE);
  expect(facts.codeBytes).toBeGreaterThan(0);
  const { perform } = await inspectUpgrade(fields, SAFE);
  expect(perform.simulate === false && perform.known).toBe(true);
});
