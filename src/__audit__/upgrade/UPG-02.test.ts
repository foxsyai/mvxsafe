/**
 * @jest-environment node
 */
// UPG-02: an SCUpgradeFromSource whose target is THE SAFE ITSELF. The form and
// the builder refuse it ("That is the safe itself"), but inspectUpgrade, whose
// comment says "The rules are the propose form's, so an upgrade proposed some
// other way is held to them too", does not: the card shows "Upgrade the
// contract erd1qqq...<the safe>" with every check green ("The safe owns the
// contract, so it may upgrade it", "The metadata stays as it is"). A 2-of-3
// vote on that replaces the multisig's own code with whatever the source holds.
// A handover of the safe reads "Hand THIS SAFE over to ... Do not sign"; an
// upgrade of the safe must be at least as loud.
jest.mock(
  'multisig/network',
  () => require('../../multisig/tests/contractsMock').contractsNetworkMock
);

import { describeAction } from 'multisig/describe';
import { inspectUpgrade } from 'multisig/inspect';
import { predictSafeAddress } from 'multisig/legacyCalls';
import { contract, mockAccounts } from '../../multisig/tests/contractsMock';
import { ALICE, CAROL, SAFE } from '../display/fixtures';

const TARGET = predictSafeAddress(CAROL, 40); // an ordinary contract the safe owns
const SOURCE = predictSafeAddress(ALICE, 60); // shard 1, the safe's shard
const NEW_CODE =
  'fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32';
const OLD_CODE = '11'.repeat(32);
const METADATA = Uint8Array.of(0x05, 0x00);

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: OLD_CODE });
  // A safe owns itself and runs the multisig code, upgradeable like every safe.
  mockAccounts[SAFE] = contract({ owner: SAFE, hash: OLD_CODE });
  mockAccounts[SOURCE] = contract({
    owner: ALICE,
    hash: NEW_CODE,
    upgradeable: false
  });
});

const fields = (target: string) => [target, 0n, SOURCE, METADATA, []];

describe('control: an upgrade of a contract the safe owns', () => {
  test('is green, and the sentence is about that contract', async () => {
    const { checks } = await inspectUpgrade(fields(TARGET), SAFE);
    expect(checks.filter((check) => check.tone === 'bad')).toEqual([]);
    const sentence = await describeAction(
      { name: 'SCUpgradeFromSource', fields: fields(TARGET) },
      SAFE
    );
    expect(sentence).not.toMatch(/THIS SAFE/);
  });
});

describe('an upgrade whose target is the safe itself, proposed with another tool', () => {
  test('is red on the card: a check says it is the safe itself', async () => {
    const { checks } = await inspectUpgrade(fields(SAFE), SAFE);
    expect(
      checks.some(
        (check) =>
          check.tone === 'bad' &&
          !check.advisory &&
          /safe itself|THIS SAFE/i.test(check.text)
      )
    ).toBe(true);
  });

  test('the sentence says THIS SAFE, as the handover of the safe does', async () => {
    const sentence = await describeAction(
      { name: 'SCUpgradeFromSource', fields: fields(SAFE) },
      SAFE
    );
    expect(sentence).toMatch(/THIS SAFE/);
  });
});
