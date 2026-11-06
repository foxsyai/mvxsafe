// VCD-05: a payment split into several transfers of the same token is read
// as its first transfer only. The card then says the action fails and shows
// less than it pays, while mvxvest adds the transfers up and accepts it.
//
// mvxvest sums every transfer it receives, per token (create.rs,
// received_payments): 10 FOXSY and 6.016 FOXSY in one MultiESDTNFTTransfer
// are 16.016 FOXSY to it, the exact deposit for two vestings of 16 with its
// 0.1% token fee. The card takes the first transfer of the token as "what is
// paid" (10), finds it short of the 16.016 mvxvest wants, and says in red:
// "This action pays 10 FOXSY and 0.2 EGLD. Carried out now it fails: the
// tokens come back to the safe and the action is used up." Under it, the
// details say "Paid: 10 FOXSY and 0.2 EGLD". Both are false: carried out, it
// pays 16.016 and creates the vestings listed.
//
// The card is not green, so nothing moves that the list does not show. But
// a signer is told the wrong amount and the wrong outcome.
//
// Expected: what the card calls paid is what the action pays, per token,
// added up as mvxvest adds it; and no line says it fails when it would not.
jest.mock('multisig/network', () => {
  const base =
    require('../../../multisig/tests/contractsMock').contractsNetworkMock;
  return { ...base };
});
jest.mock('multisig/vestingReads', () => ({
  ...jest.requireActual('multisig/vestingReads'),
  readVestingFacts: jest.fn(async () => mockFacts.current),
  readVestingOfCancelKey: jest.fn(async () => null)
}));

import '../../display/restoreSetImmediate';
import { Address } from '@multiversx/sdk-core';
import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import { topEncode } from 'multisig/legacyCalls';
import {
  encodeCreateBatchArgs,
  mvxvestFor,
  NewVesting,
  trancheSchedule,
  VestingFacts
} from 'multisig/vesting';
import { ALICE, BOB, SAFE } from '../../display/fixtures';

const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const DAY = 86400;
const TOKEN = 'FOXSY-5d5f3e';
const pin = mvxvestFor('devnet')!;
const NOW = Math.floor(Date.now() / 1000);
const FIRST = NOW + 30 * DAY;

/** mvxvest's fees now: 0.1 EGLD a vesting and 0.1% of each in the token. */
const facts: VestingFacts = {
  codeHash: V4,
  creationPaused: false,
  claimKeyIssued: true,
  cancelKeyIssued: true,
  claimKeyCollection: pin.claimKey,
  cancelKeyCollection: pin.cancelKey,
  fee: 10n ** 17n,
  tokenFeeBps: 10,
  safePayableBySc: true,
  safeBalance: 1000n * UNIT,
  safeEgld: UNIT
};
const mockFacts: { current: VestingFacts } = { current: facts };

const entries: NewVesting[] = [
  {
    beneficiary: ALICE,
    schedule: trancheSchedule([
      { time: FIRST, amount: 4n * UNIT },
      { time: FIRST + 182 * DAY, amount: 6n * UNIT }
    ])
  },
  {
    beneficiary: BOB,
    schedule: trancheSchedule([{ time: FIRST, amount: 6n * UNIT }])
  }
];
/** 16 for the vestings, 0.016 of token fee, 0.2 EGLD of fee: what mvxvest wants. */
const TOKEN_DUE = 16_016n * 10n ** 15n;
const EGLD_DUE = 2n * 10n ** 17n;

/** The safe's MultiESDTNFTTransfer to mvxvest with createBatch after it. */
const actionOf = (payments: [string, bigint][]) => ({
  name: 'SendAsyncCall',
  fields: [
    {
      to: SAFE,
      egld_amount: 0n,
      endpoint_name: Buffer.from('MultiESDTNFTTransfer'),
      arguments: [
        Buffer.from(Address.newFromBech32(pin.address).getPublicKey()),
        Buffer.from(topEncode(BigInt(payments.length))),
        ...payments.flatMap(([token, amount]) => [
          Buffer.from(token),
          Buffer.from(topEncode(0n)),
          Buffer.from(topEncode(amount))
        ]),
        Buffer.from('createBatch'),
        ...encodeCreateBatchArgs({
          cancelable: true,
          label: 'Grants 2026',
          entries
        }).map((arg) => Buffer.from(arg))
      ]
    }
  ]
});
const texts = (checks: { text: string }[]) =>
  checks.map((check) => check.text).join('\n');
const red = <T extends { tone: string; advisory?: boolean }>(checks: T[]) =>
  checks.filter((check) => check.tone === 'bad' && !check.advisory);

describe('VCD-05: a payment split into several transfers of one token', () => {
  it('control: paid in one transfer of the token and one of EGLD, the card is green and says what is paid', async () => {
    const inspection = await inspectAction(
      actionOf([
        [TOKEN, TOKEN_DUE],
        ['EGLD-000000', EGLD_DUE]
      ]),
      SAFE
    );
    expect(red(inspection.checks)).toEqual([]);
    expect(texts(inspection.checks)).toMatch(
      /pays exactly what mvxvest wants now/
    );
    expect(inspection.vesting).toMatchObject({
      kind: 'create',
      paidToken: TOKEN_DUE,
      paidEgld: EGLD_DUE
    });
  });

  it('says what the action pays in all, as mvxvest adds it up', async () => {
    const inspection = await inspectAction(
      actionOf([
        [TOKEN, 10n * UNIT],
        [TOKEN, TOKEN_DUE - 10n * UNIT],
        ['EGLD-000000', EGLD_DUE]
      ]),
      SAFE
    );
    expect(inspection.vesting).toMatchObject({
      kind: 'create',
      paidToken: TOKEN_DUE,
      paidEgld: EGLD_DUE
    });
  });

  it('does not say it fails when mvxvest would accept it', async () => {
    const inspection = await inspectAction(
      actionOf([
        [TOKEN, 10n * UNIT],
        [TOKEN, TOKEN_DUE - 10n * UNIT],
        ['EGLD-000000', EGLD_DUE]
      ]),
      SAFE
    );
    expect(texts(inspection.checks)).not.toMatch(
      /Carried out now it fails: the tokens come back/
    );
  });

  // The same reading hides a second token altogether: with 16.016 FOXSY, the
  // fee and 1,000,000 of another token in one transfer, the sentence says
  // "Create 2 cancelable vestings of 16 FOXSY" and the red line says it
  // "pays 16.016 FOXSY and 0.2 EGLD". mvxvest refuses two tokens (ERR_ONE_TOKEN),
  // so nothing is lost; but a payment the signers approve is named nowhere.
  it('names every payment the action makes, a second token included', async () => {
    const action = actionOf([
      [TOKEN, TOKEN_DUE],
      ['EGLD-000000', EGLD_DUE],
      ['USDC-c76f1f', 1_000_000n]
    ]);
    const sentence = await describeAction(action, SAFE);
    const inspection = await inspectAction(action, SAFE);
    expect(`${sentence}\n${texts(inspection.checks)}`).toMatch(/USDC-c76f1f/);
  });
});
