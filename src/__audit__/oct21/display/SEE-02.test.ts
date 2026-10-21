/**
 * @jest-environment node
 */
// SEE-02 (low): the sentence for an SCDeployFromSource action omits the code
// metadata of the contract it creates, although its sibling SCUpgradeFromSource
// spells the metadata out ("Afterwards it is upgradeable, readable, ..."). A
// deploy action proposed with another tool (mvxsafe has no deploy-from-source
// form, but the board can be shown one filed elsewhere) can create a contract
// the safe then owns, with any flags -- not upgradeable, or payable -- and the
// signer is never told. describe.ts's own rule #2 is "Complete": every field a
// signer approves should be in the sentence. The deploy already names the
// source, the EGLD and the arguments (DISP-09 fix, 7 Oct); the metadata is the
// one field still dropped.
//
// Fix: append describeMetadata(flags) to the SCDeployFromSource branch, as the
// SCUpgradeFromSource branch does. (SCDeployFromSource fields are
// [amount, source, code_metadata, arguments]; the metadata at index 2 is
// currently skipped by the destructuring `[amount, source, , args]`.)
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);

import { Address } from '@multiversx/sdk-core';
import { describeAction } from 'multisig/describe';
import { CAROL, SAFE } from '../../display/fixtures';

const SOURCE = 'erd1qqqqqqqqqqqqqpgqkwxlhdl97p33n2lv25dxk84d5jn8y0r6aujqtg3f08';
// readable + payable, NOT upgradeable, not payable-by-sc.
const NOT_UPGRADEABLE_PAYABLE = Uint8Array.of(0x04, 0x02);
const UPGRADEABLE = Uint8Array.of(0x05, 0x00);

const deploy = (metadata: Uint8Array) => ({
  name: 'SCDeployFromSource',
  fields: [0n, Address.newFromBech32(SOURCE), metadata, []]
});
const upgrade = (metadata: Uint8Array) => ({
  name: 'SCUpgradeFromSource',
  fields: [
    Address.newFromBech32(predictTarget()),
    0n,
    Address.newFromBech32(SOURCE),
    metadata,
    []
  ]
});
// A plain owned-contract address for the upgrade control.
function predictTarget() {
  const { predictSafeAddress } = require('multisig/legacyCalls');
  return predictSafeAddress(CAROL, 40);
}

test('control: the sibling upgrade discloses the metadata of the result', async () => {
  const sentence = await describeAction(upgrade(NOT_UPGRADEABLE_PAYABLE), SAFE);
  expect(sentence).toMatch(/not upgradeable/);
  expect(sentence).toMatch(/payable/);
});

test('a deploy must disclose the metadata of the contract it creates', async () => {
  const sentence = await describeAction(deploy(NOT_UPGRADEABLE_PAYABLE), SAFE);
  // The source code and arguments are already named (this part passes today),
  // so the failure below is specifically the missing metadata, nothing else.
  expect(sentence).toMatch(/code of/i);
  // The signer is never told the new contract is not upgradeable, or payable.
  expect(sentence).toMatch(/upgradeable|payable/);
});

test('a deploy of an upgradeable contract equally omits its flags', async () => {
  // Same gap, different flags, to show it is disclosure that is missing, not
  // one particular flag. (This also currently fails, for the same reason.)
  const sentence = await describeAction(deploy(UPGRADEABLE), SAFE);
  expect(sentence).toMatch(/upgradeable/);
});
