/**
 * @jest-environment node
 */
// UPG-01: `upgradeContract` is the built-in that REPLACES a contract's code
// (it is the exact data the SDK's own createTransactionForUpgrade sends:
// "upgradeContract"@<code>@<metadata>). Proposed as an ordinary call of a
// contract the safe owns (SendAsyncCall / SendTransferExecute), mvxsafe shows
// it as "Call upgradeContract(0x0061736d..., 1,280) on erd1..." and the checks
// go green ("the safe owns the contract it calls"). None of the guards a real
// SCUpgradeFromSource gets apply: no statement that the code is being replaced,
// no metadata in words, no "never upgradeable again" warning, no code-hash
// field. Its sibling built-in `ChangeOwnerAddress` IS recognised by describe.ts
// ("Hand the contract X over to Y"); `upgradeContract` is not.
//
// The card must tell the signer this action replaces the contract's code, and
// must warn when it drops "upgradeable", rather than present it as a benign
// green call. (Severity is bounded: on devnet a perform of this action with the
// full bytecode fails at performAction with "storage decode error: input too
// long" -- see proofs/UPG-01.mjs -- so this audit does NOT claim on-chain code
// replacement, only that the card misleads and the vote is wasted.)
jest.mock(
  'multisig/network',
  () => require('../../multisig/tests/contractsMock').contractsNetworkMock
);

import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockTrial
} from '../../multisig/tests/contractsMock';
import { CAROL, SAFE } from '../display/fixtures';

const TARGET = predictSafeAddress(CAROL, 40); // a contract the safe owns
const OLD_CODE = '11'.repeat(32);

// A wasm module (magic + version) as a release's .wasm would start.
const NEW_CODE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00,
  0x00, 0x03, 0x02, 0x01, 0x00, 0x07, 0x08, 0x01, 0x04, 0x69, 0x6e, 0x69, 0x74,
  0x00, 0x00, 0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b
]);
const NOT_UPGRADEABLE = Uint8Array.of(0x04, 0x00);
const UPGRADEABLE = Uint8Array.of(0x05, 0x00);

const callAction = (
  name: 'SendAsyncCall' | 'SendTransferExecute',
  to: string,
  metadata: Uint8Array
) => ({
  name,
  fields: [
    {
      to,
      egld_amount: 0n,
      endpoint_name: Buffer.from('upgradeContract'),
      arguments: [NEW_CODE, metadata]
    }
  ]
});

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: OLD_CODE });
  mockAccounts[SAFE] = contract({ owner: SAFE, hash: OLD_CODE });
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

describe('control: the sibling built-in ChangeOwnerAddress IS recognised', () => {
  test('a call of ChangeOwnerAddress on an owned contract is spelled out, not shown as "Call ChangeOwnerAddress(...)"', async () => {
    const { Address } = require('@multiversx/sdk-core');
    const sentence = await describeAction(
      {
        name: 'SendAsyncCall',
        fields: [
          {
            to: TARGET,
            egld_amount: 0n,
            endpoint_name: Buffer.from('ChangeOwnerAddress'),
            arguments: [Address.newFromBech32(CAROL).getPublicKey()]
          }
        ]
      },
      SAFE
    );
    expect(sentence).toMatch(/Hand the contract .* over to/);
    expect(sentence).not.toMatch(/^Call ChangeOwnerAddress\(/);
  });
});

describe('the code-replacing built-in upgradeContract, proposed as a call', () => {
  for (const name of ['SendAsyncCall', 'SendTransferExecute'] as const) {
    test(`${name}: the sentence says the contract's code is being replaced, not "Call upgradeContract(...)"`, async () => {
      const sentence = await describeAction(
        callAction(name, TARGET, UPGRADEABLE),
        SAFE
      );
      expect(sentence).not.toMatch(/^Call upgradeContract\(/);
      expect(sentence).toMatch(/code/i);
      expect(sentence).toMatch(/replac|upgrad/i);
    });

    test(`${name}: dropping "upgradeable" is warned, as SCUpgradeFromSource warns`, async () => {
      const sentence = await describeAction(
        callAction(name, TARGET, NOT_UPGRADEABLE),
        SAFE
      );
      expect(sentence).toMatch(/never be changed again|not upgradeable/i);
    });

    test(`${name}: the checks do not present it as a benign green call`, async () => {
      const inspection = await inspectAction(
        callAction(name, TARGET, UPGRADEABLE),
        SAFE
      );
      // At least one check must flag that this replaces the contract's code,
      // instead of only "it works" and "the safe owns the contract it calls".
      const warnsAboutCode = inspection.checks.some(
        (check) =>
          (check.tone === 'bad' || check.tone === 'warn') &&
          /replac|upgrad|code/i.test(check.text)
      );
      expect(warnsAboutCode).toBe(true);
    });
  }

  test('aimed at the safe itself, it says THIS SAFE (the safe-handover wording)', async () => {
    const sentence = await describeAction(
      callAction('SendAsyncCall', SAFE, UPGRADEABLE),
      SAFE
    );
    expect(sentence).toMatch(/THIS SAFE/);
  });
});
