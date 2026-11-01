/**
 * @jest-environment node
 *
 * FND-04: an upgrade from a source whose code has no `upgrade` function cannot
 * succeed, and the card says nothing.
 *
 * Since protocol 1.6 the network runs the NEW code's `upgrade` function when a
 * contract is upgraded, and fails the upgrade when there is none
 * (mx-chain-vm-go, performCodeDeploymentAtContractUpgrade ->
 * callUpgradeFunction -> ErrFuncNotFound). The legacy multisig itself exports
 * none, like every contract built before mx-sdk-rs 0.45 (November 2023). Proven
 * on devnet with the exact bytecode: an SCUpgradeFromSource whose source runs
 * the multisig code was carried out, failed with "invalid function (not found)"
 * on upgradeContract, and used the action up, with every signature
 * (6044ddcc2d0fa00f59d94faf10af8c94f1b3e29907e55886a82377530fd9ed9d).
 *
 * inspectUpgrade already fetches and hashes the source's code (EXT-01). The
 * wasm's export section says in a few bytes whether `upgrade` is there.
 *
 * Correct behaviour, asserted here: a source without an `upgrade` export gets
 * a blocking red check saying the upgrade will fail after the signatures; a
 * source with one does not.
 */
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blake2b } from '@noble/hashes/blake2b';
import { inspectUpgrade } from 'multisig/inspect';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  contract,
  mockAccounts,
  mockCode
} from '../../../multisig/tests/contractsMock';
import { ALICE, CAROL, SAFE } from '../../display/fixtures';

const TARGET = predictSafeAddress(CAROL, 40);
const SOURCE = predictSafeAddress(ALICE, 60); // shard 1, the safe's
const fields = [TARGET, 0n, SOURCE, Uint8Array.of(0x05, 0x00), []];

/** The API's answer for a source running `code`, hash and code agreeing. */
const sourceRunning = (code: Uint8Array) => ({
  balance: '0',
  ownerAddress: ALICE,
  codeHash: Buffer.from(blake2b(code, { dkLen: 32 })).toString('base64'),
  code: Buffer.from(code).toString('hex'),
  isUpgradeable: false,
  isReadable: true,
  isPayable: false,
  isPayableBySmartContract: false
});

// The legacy multisig: init, deposit, sign... and no upgrade.
const LEGACY_MULTISIG = new Uint8Array(
  readFileSync(join(__dirname, '../../../../public/contracts/multisig.wasm'))
);
// A minimal wasm exporting init and upgrade (two empty functions).
const WITH_UPGRADE = Uint8Array.from(
  Buffer.from(
    '0061736d01000000010401600000030302000007120204696e69740000077570677261646500010a070202000b02000b',
    'hex'
  )
);

const blocking = (
  checks: { tone: string; advisory?: boolean; text: string }[]
) => checks.filter((check) => check.tone === 'bad' && !check.advisory);

beforeEach(() => {
  mockAccounts[TARGET] = contract({ owner: SAFE, hash: mockCode('old') });
});

test('control: a source whose code exports upgrade is not held', async () => {
  mockAccounts[SOURCE] = sourceRunning(WITH_UPGRADE);
  const { checks, upgrade } = await inspectUpgrade(fields, SAFE);
  expect(upgrade?.sourceHash).toBe(
    Buffer.from(blake2b(WITH_UPGRADE, { dkLen: 32 })).toString('hex')
  );
  expect(
    blocking(checks).filter((check) =>
      /upgrade function|no upgrade|upgrade\(\)/i.test(check.text)
    )
  ).toEqual([]);
});

test('a source whose code has no upgrade function is red: the upgrade will fail and use the action up', async () => {
  mockAccounts[SOURCE] = sourceRunning(LEGACY_MULTISIG);
  const { checks } = await inspectUpgrade(fields, SAFE);
  const held = blocking(checks).filter((check) =>
    /upgrade function|no upgrade|upgrade\(\)/i.test(check.text)
  );
  expect(held).not.toEqual([]);
  expect(held[0].text).toMatch(/fail/i);
});
