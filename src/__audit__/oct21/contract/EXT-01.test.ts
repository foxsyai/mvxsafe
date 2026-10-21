/**
 * @jest-environment node
 */
// EXT-01, reported by the mvxvest side and proven here by the main session
// (21 Oct 2026). An upgrade card shows the code hash the API states, but the
// API also returns the code itself, and the app never hashed it: an answer
// whose hash does not belong to its code was shown as it was. And a contract
// for which the API does not say whether it is upgradeable was treated as not
// upgradeable: a source that may still be replaced by its owner passed with
// no word about it.
//
// Correct behaviour: the hash shown is the hash of the code returned, a hash
// that does not match its code is red, and an unknown upgradeability is said.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { inspectUpgrade, readAccountFacts } from 'multisig/inspect';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockCode
} from '../../../multisig/tests/contractsMock';
import { ALICE, CAROL, SAFE } from '../../display/fixtures';

const TARGET = predictSafeAddress(CAROL, 40);
const SOURCE = predictSafeAddress(ALICE, 60); // shard 1, the safe's shard
const OLD_CODE = mockCode('old');
const NEW_CODE = mockCode('new');
const METADATA = Uint8Array.of(0x05, 0x00);
const fields = [TARGET, 0n, SOURCE, METADATA, []];

const bad = (checks: { tone: string; text: string }[], pattern: RegExp) =>
  checks.some((check) => check.tone === 'bad' && pattern.test(check.text));

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: OLD_CODE });
  mockAccounts[SOURCE] = contract({
    owner: ALICE,
    hash: NEW_CODE,
    upgradeable: false
  });
});

test('control: a code and its hash that agree are shown, and nothing is red', async () => {
  const facts = await readAccountFacts(SOURCE);
  expect(facts.codeHash).toBe(NEW_CODE);
  const { checks } = await inspectUpgrade(fields, SAFE);
  expect(checks.filter((check) => check.tone === 'bad')).toEqual([]);
});

test("the source's stated hash is not the hash of its code: the code's own hash is shown, and it is red", async () => {
  const claimed =
    'fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32';
  mockAccounts[SOURCE] = {
    ...contract({ owner: ALICE, hash: claimed, upgradeable: false }),
    code: (mockAccounts[SOURCE] as { code: string }).code
  };
  const facts = await readAccountFacts(SOURCE);
  expect(facts.codeHash).toBe(NEW_CODE);
  const { checks } = await inspectUpgrade(fields, SAFE);
  expect(bad(checks, /does not match/i)).toBe(true);
});

test('a source whose upgradeability the API does not state is not passed in silence', async () => {
  const { isUpgradeable: _unknown, ...rest } = mockAccounts[SOURCE] as Record<
    string,
    unknown
  >;
  mockAccounts[SOURCE] = rest;
  const { checks } = await inspectUpgrade(fields, SAFE);
  expect(
    checks.some(
      (check) =>
        check.tone !== 'ok' &&
        /whether the source is upgradeable/i.test(check.text)
    )
  ).toBe(true);
});

test('a contract whose metadata the API does not state: the comparison is said to be missing', async () => {
  const { isUpgradeable: _unknown, ...rest } = mockAccounts[TARGET] as Record<
    string,
    unknown
  >;
  mockAccounts[TARGET] = rest;
  const { checks } = await inspectUpgrade(fields, SAFE);
  expect(
    checks.some(
      (check) =>
        check.tone !== 'ok' &&
        /whether the contract is upgradeable/i.test(check.text)
    )
  ).toBe(true);
});
