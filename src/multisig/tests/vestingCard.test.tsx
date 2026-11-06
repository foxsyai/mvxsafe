// The card of a vesting action (6 Nov 2026): what a signer reads before
// signing. Green only for the pinned mvxvest running an accepted release and
// a payment that matches its fees now; any other contract is red; every
// vesting is listed with its dates and amounts; a cancel says what goes to the
// beneficiary and what comes back to the safe. The chain reads of mvxvest are
// replaced here (vestingReads.ts reads them on devnet); the network's own
// answers come from the audit's fixtures.
jest.mock('multisig/network', () => {
  const base = require('./contractsMock').contractsNetworkMock;
  return {
    ...base,
    api: async (path: string) => {
      const held = /^\/accounts\/[^/]+\/nfts\/(.+)$/.exec(path);
      if (held) {
        if (mockHeld.has(held[1])) return { identifier: held[1], balance: '1' };
        throw new Error(`${path} answered 404`);
      }
      return base.api(path);
    }
  };
});
jest.mock('multisig/vestingReads', () => ({
  ...jest.requireActual('multisig/vestingReads'),
  readVestingFacts: jest.fn(async () => mockFacts.current),
  readVestingOfCancelKey: jest.fn(async () => mockVesting.current)
}));

import '../../__audit__/display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { Address } from '@multiversx/sdk-core';
import { render, screen } from '@testing-library/react';
import { ActionChecks } from 'components/Pending/ActionChecks';
import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import { predictSafeAddress } from 'multisig/legacyCalls';
import {
  batchActionBytes,
  buildProposeCancelVesting,
  buildProposeVestings,
  mvxvestFor,
  trancheSchedule,
  VestingFacts,
  vestingGasNeed
} from 'multisig/vesting';
import type { VestingState } from 'multisig/vestingReads';
import { ALICE, BOB, CAROL, SAFE } from '../../__audit__/display/fixtures';

const mockHeld = new Set<string>();
const V4 = '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246';
const UNIT = 10n ** 18n;
const DAY = 86400;
const TOKEN = 'FOXSY-5d5f3e';
const pin = mvxvestFor('devnet')!;
const NOW = Math.floor(Date.now() / 1000);
const FIRST = NOW + 30 * DAY;

const factsWith = (over: Partial<VestingFacts> = {}): VestingFacts => ({
  codeHash: V4,
  creationPaused: false,
  claimKeyIssued: true,
  cancelKeyIssued: true,
  claimKeyCollection: pin.claimKey,
  cancelKeyCollection: pin.cancelKey,
  fee: 0n,
  tokenFeeBps: 0,
  safePayableBySc: true,
  safeBalance: 1000n * UNIT,
  safeEgld: UNIT,
  ...over
});
const mockFacts: { current: VestingFacts } = { current: factsWith() };
const mockVesting: { current: VestingState | null } = { current: null };

const entries = [
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
const context = { chainId: 'D', sender: ALICE, nonce: 1, safe: SAFE };
const batch = (over: Record<string, any> = {}) =>
  buildProposeVestings(context, {
    pin,
    facts: factsWith(),
    token: TOKEN,
    cancelable: true,
    label: 'Grants 2026',
    entries,
    now: NOW,
    ...over
  });

/** A proposal's data as the safe stores it and the card reads it back. */
const actionOf = (transaction: { data: Uint8Array }, to?: string) => {
  const parts = Buffer.from(transaction.data).toString().split('@');
  return {
    name: 'SendAsyncCall',
    fields: [
      {
        to: to ?? Address.newFromHex(parts[1]).toBech32(),
        egld_amount: BigInt(`0x${parts[2] || '0'}`),
        endpoint_name: Buffer.from(parts[3], 'hex'),
        arguments: parts.slice(4).map((part) => Buffer.from(part, 'hex'))
      }
    ]
  };
};
const red = <T extends { tone: string; advisory?: boolean }>(checks: T[]) =>
  checks.filter((check) => check.tone === 'bad' && !check.advisory);
const texts = (checks: { text: string }[]) =>
  checks.map((check) => check.text).join('\n');

beforeEach(() => {
  mockFacts.current = factsWith();
  mockVesting.current = null;
  mockHeld.clear();
});

describe('a batch to the pinned mvxvest', () => {
  it('is said for what it does, every vesting listed, and green', async () => {
    const action = actionOf(await batch());
    expect(await describeAction(action, SAFE)).toBe(
      `Create 2 cancelable vestings of 16 ${TOKEN} in all on mvxvest (${pin.address}), labelled "Grants 2026". Its cancel keys come to this safe. Each vesting is listed below`
    );
    const inspection = await inspectAction(action, SAFE);
    expect(red(inspection.checks)).toEqual([]);
    expect(texts(inspection.checks)).toMatch(/runs a release mvxsafe accepts/);
    expect(texts(inspection.checks)).toMatch(/fees read zero now/);
    expect(texts(inspection.checks)).toMatch(
      /one cancel key per vesting, 2 in all/
    );
    expect(inspection.vesting).toMatchObject({
      kind: 'create',
      contract: pin.address,
      token: TOKEN,
      cancelable: true,
      label: 'Grants 2026',
      paidToken: 16n * UNIT,
      paidEgld: 0n
    });
    expect(
      inspection.vesting?.kind === 'create' &&
        inspection.vesting.entries.map((entry) => entry.beneficiary)
    ).toEqual([ALICE, BOB]);
  });

  it('is carried out with what devnet measured, not the 10M default for a call it cannot try', async () => {
    const inspection = await inspectAction(actionOf(await batch()), SAFE);
    const need = vestingGasNeed({
      entries,
      cancelable: true,
      feesPaid: false,
      // The safe reads the stored action back before the call leaves.
      actionBytes: batchActionBytes({
        pin,
        safe: SAFE,
        token: TOKEN,
        cancelable: true,
        label: 'Grants 2026',
        entries,
        facts: factsWith()
      })
    });
    expect(inspection.perform).toMatchObject({
      simulate: false,
      known: true,
      need
    });
  });

  it('paying fees that match mvxvest now: green, and the fees are named', async () => {
    mockFacts.current = factsWith({ fee: 10n ** 17n, tokenFeeBps: 10 });
    const action = actionOf(
      await batch({ facts: factsWith({ fee: 10n ** 17n, tokenFeeBps: 10 }) })
    );
    expect(await describeAction(action, SAFE)).toMatch(
      new RegExp(
        `paying 0\\.016 ${TOKEN} of token fee and 0\\.2 EGLD of fee on top`
      )
    );
    const inspection = await inspectAction(action, SAFE);
    expect(red(inspection.checks)).toEqual([]);
    expect(texts(inspection.checks)).toMatch(
      /pays exactly what mvxvest wants now/
    );
  });

  it("red when mvxvest's fees changed since it was proposed: carried out, it would fail", async () => {
    const action = actionOf(await batch());
    mockFacts.current = factsWith({ fee: 10n ** 17n, tokenFeeBps: 10 });
    const checks = (await inspectAction(action, SAFE)).checks;
    expect(texts(checks)).toMatch(
      /Carried out now it fails: the tokens come back to the safe/
    );
  });

  it('red when mvxvest runs other code, or has paused creation', async () => {
    const action = actionOf(await batch());
    mockFacts.current = factsWith({ codeHash: 'ab'.repeat(32) });
    expect(texts(red((await inspectAction(action, SAFE)).checks))).toMatch(
      /not a release of mvxvest/
    );
    mockFacts.current = factsWith({ creationPaused: true });
    expect(texts((await inspectAction(action, SAFE)).checks)).toMatch(
      /paused the creation/
    );
  });

  it('red when the safe could not receive the keys, or holds less than it pays', async () => {
    const action = actionOf(await batch());
    mockFacts.current = factsWith({ safePayableBySc: false });
    expect(texts(red((await inspectAction(action, SAFE)).checks))).toMatch(
      /not payable by smart contracts/
    );
    mockFacts.current = factsWith({ safeBalance: UNIT });
    expect(texts((await inspectAction(action, SAFE)).checks)).toMatch(
      /less than this pays/
    );
  });

  it('amber when a tranche date has passed by the time it is signed', async () => {
    const soon = [
      {
        beneficiary: ALICE,
        schedule: trancheSchedule([{ time: NOW + 60, amount: UNIT }])
      }
    ];
    const action = actionOf(await batch({ entries: soon }));
    const later = jest.spyOn(Date, 'now').mockReturnValue((NOW + 3600) * 1000);
    try {
      expect(texts((await inspectAction(action, SAFE)).checks)).toMatch(
        /is in the past\. What it releases vests the moment/
      );
    } finally {
      later.mockRestore();
    }
  });

  it('a batch that cannot be cancelled says so in the sentence and in amber', async () => {
    const action = actionOf(await batch({ cancelable: false }));
    expect(await describeAction(action, SAFE)).toMatch(
      /Nobody will be able to cancel them/
    );
    expect(texts((await inspectAction(action, SAFE)).checks)).toMatch(
      /Not cancelable: once carried out, nobody can stop/
    );
  });
});

describe('arguments mvxvest would read differently (review of PR #26)', () => {
  it('a schedule with one byte too many is red, not green', async () => {
    const action = actionOf(await batch());
    const args = action.fields[0].arguments;
    // ESDTTransfer's token, amount, createBatch, cancelable, label, then the
    // entries: beneficiary, total, schedule. One byte after the first schedule.
    args[7] = Buffer.concat([args[7], Buffer.from([0])]);
    const inspection = await inspectAction(action, SAFE);
    expect(texts(red(inspection.checks))).toMatch(/could not be read/);
    expect(inspection.vesting).toBeUndefined();
  });

  it('a create with an extra argument is red, not green', async () => {
    const one = await batch({ entries: [entries[0]] });
    const parts = Buffer.from(one.data).toString().split('@');
    // Rebuild it as create(beneficiary, total, schedule, cancelable, label, extra).
    const action = actionOf(one);
    const [token, amount, , cancelable, label, beneficiary, total, schedule] =
      action.fields[0].arguments;
    action.fields[0].arguments = [
      token,
      amount,
      Buffer.from('create'),
      beneficiary,
      total,
      schedule,
      cancelable,
      label,
      Buffer.from('extra')
    ];
    expect(parts.length).toBeGreaterThan(8);
    expect(texts(red((await inspectAction(action, SAFE)).checks))).toMatch(
      /could not be read/
    );
  });

  it('a batch with no vestings is red: mvxvest refuses it (third review of PR #26)', async () => {
    const action = actionOf(await batch());
    // createBatch(cancelable, label) and nothing after: no entry, paid nothing.
    action.fields[0].arguments = [
      Buffer.from(TOKEN),
      Buffer.alloc(0),
      Buffer.from('createBatch'),
      Buffer.from([1]),
      Buffer.from('empty')
    ];
    expect(texts(red((await inspectAction(action, SAFE)).checks))).toMatch(
      /no vesting/
    );
  });

  it('control: the same create without the extra argument is read', async () => {
    const action = actionOf(await batch({ entries: [entries[0]] }));
    const [token, amount, , cancelable, label, beneficiary, total, schedule] =
      action.fields[0].arguments;
    action.fields[0].arguments = [
      token,
      amount,
      Buffer.from('create'),
      beneficiary,
      total,
      schedule,
      cancelable,
      label
    ];
    const inspection = await inspectAction(action, SAFE);
    expect(texts(red(inspection.checks))).not.toMatch(/could not be read/);
    expect(inspection.vesting).toMatchObject({
      kind: 'create',
      label: 'Grants 2026'
    });
  });
});

describe('the same call to any other contract', () => {
  it('keeps the plain sentence and is red', async () => {
    const other = predictSafeAddress(CAROL, 40);
    const action = actionOf(await batch(), other);
    expect(await describeAction(action, SAFE)).toMatch(
      new RegExp(`^Send 16 ${TOKEN} to ${other}, then call createBatch`)
    );
    const inspection = await inspectAction(action, SAFE);
    expect(texts(red(inspection.checks))).toMatch(
      /is not the mvxvest this site pins/
    );
    expect(inspection.vesting).toBeUndefined();
  });
});

describe('a cancel', () => {
  const KEY = `${pin.cancelKey}-05`;
  const state: VestingState = {
    id: 7,
    creator: SAFE,
    beneficiary: BOB,
    token: TOKEN,
    total: 10n * UNIT,
    schedule: trancheSchedule([
      { time: NOW - DAY, amount: 4n * UNIT },
      { time: NOW + 182 * DAY, amount: 6n * UNIT }
    ]),
    cancelable: true,
    createdAt: NOW - 10 * DAY,
    claimNonce: 9,
    cancelNonce: 5,
    label: 'Grants 2026',
    claimed: UNIT,
    cancelledAt: 0,
    vested: 4n * UNIT,
    claimable: 3n * UNIT,
    finalAmount: 0n,
    refunded: 0n,
    timestamp: NOW
  };
  const cancel = async () =>
    actionOf(
      await buildProposeCancelVesting(context, {
        pin,
        facts: factsWith(),
        collection: pin.cancelKey,
        nonce: 5
      })
    );

  it('names the key, and says what goes where now', async () => {
    mockHeld.add(KEY);
    mockVesting.current = state;
    const action = await cancel();
    expect(await describeAction(action, SAFE)).toBe(
      `Cancel the mvxvest vesting of the cancel key ${KEY}: this safe sends the key to mvxvest (${pin.address}), what has not vested yet comes back to this safe, and what has vested stays the beneficiary's`
    );
    const inspection = await inspectAction(action, SAFE);
    expect(red(inspection.checks)).toEqual([]);
    expect(texts(inspection.checks)).toMatch(
      new RegExp(
        `${KEY} cancels vesting #7 of ${BOB}, "Grants 2026"\\. Cancelled now: 3 ${TOKEN} has vested and stays theirs to claim \\(they have claimed 1 ${TOKEN} already\\)\\. 6 ${TOKEN} not yet vested comes back to this safe`
      )
    );
    expect(inspection.vesting).toMatchObject({
      kind: 'cancel',
      keys: [{ identifier: KEY, vesting: { id: 7 } }]
    });
  });

  it('red when the safe no longer holds the key, or the vesting was already cancelled', async () => {
    mockVesting.current = state;
    expect(texts((await inspectAction(await cancel(), SAFE)).checks)).toMatch(
      /does not hold .* now/
    );
    mockHeld.add(KEY);
    mockVesting.current = { ...state, cancelledAt: NOW - 60 };
    expect(texts((await inspectAction(await cancel(), SAFE)).checks)).toMatch(
      /already cancelled/
    );
  });

  it('red for a key of another collection, sent to the safe itself with cancel()', async () => {
    const forged = await cancel();
    forged.fields[0].arguments[0] = Buffer.from('VESTKEY-8f217c');
    expect(texts(red((await inspectAction(forged, SAFE)).checks))).toMatch(
      /is not one of mvxvest's cancel keys/
    );
  });
});

describe('a key leaving the safe any other way (review of PR #26)', () => {
  const KEY = `${pin.cancelKey}-05`;
  const keyState: VestingState = {
    id: 7,
    creator: SAFE,
    beneficiary: BOB,
    token: TOKEN,
    total: 10n * UNIT,
    schedule: trancheSchedule([{ time: NOW + 182 * DAY, amount: 10n * UNIT }]),
    cancelable: true,
    createdAt: NOW - 10 * DAY,
    claimNonce: 9,
    cancelNonce: 5,
    label: 'Grants 2026',
    claimed: 0n,
    cancelledAt: 0,
    vested: 0n,
    claimable: 0n,
    finalAmount: 0n,
    refunded: 0n,
    timestamp: NOW
  };
  const nftTransfer = (
    collection: string,
    receiver: string,
    after: string[] = []
  ) => ({
    name: 'SendAsyncCall',
    fields: [
      {
        to: SAFE,
        egld_amount: 0n,
        endpoint_name: Buffer.from('ESDTNFTTransfer'),
        arguments: [
          Buffer.from(collection),
          Buffer.from([5]),
          Buffer.from([1]),
          Buffer.from(Address.newFromBech32(receiver).getPublicKey()),
          ...after.map((part) => Buffer.from(part))
        ]
      }
    ]
  });

  it('a cancel key sent to a wallet is red, naming the vesting and what could be taken', async () => {
    mockVesting.current = keyState;
    const checks = (
      await inspectAction(nftTransfer(pin.cancelKey, ALICE), SAFE)
    ).checks;
    expect(texts(red(checks))).toMatch(
      new RegExp(
        `${KEY}, the cancel key of vesting #7 .*Whoever holds it can cancel that vesting and take what has not vested: 10 ${TOKEN} now`
      )
    );
  });

  it('a cancel key sent to mvxvest with another function, or to another contract with cancel, is red too', async () => {
    mockVesting.current = keyState;
    for (const action of [
      nftTransfer(pin.cancelKey, pin.address, ['claim']),
      nftTransfer(pin.cancelKey, predictSafeAddress(CAROL, 40), ['cancel'])
    ])
      expect(texts(red((await inspectAction(action, SAFE)).checks))).toMatch(
        /cancel key of vesting #7/
      );
  });

  it('a claim key the safe holds, sent away, is red', async () => {
    mockVesting.current = null;
    expect(
      texts(
        red(
          (await inspectAction(nftTransfer(pin.claimKey, ALICE), SAFE)).checks
        )
      )
    ).toMatch(/claim key.*Whoever holds it claims what the vesting releases/);
  });

  it('control: the cancel the app proposes is not called a key leaving', async () => {
    mockHeld.add(KEY);
    mockVesting.current = keyState;
    const action = actionOf(
      await buildProposeCancelVesting(context, {
        pin,
        facts: factsWith(),
        collection: pin.cancelKey,
        nonce: 5
      })
    );
    expect(texts((await inspectAction(action, SAFE)).checks)).not.toMatch(
      /Whoever holds it/
    );
  });

  it('a cancel key in a MultiESDTNFTTransfer to anyone but mvxvest with cancel is red', async () => {
    mockVesting.current = keyState;
    const multi = {
      name: 'SendAsyncCall',
      fields: [
        {
          to: SAFE,
          egld_amount: 0n,
          endpoint_name: Buffer.from('MultiESDTNFTTransfer'),
          arguments: [
            Buffer.from(Address.newFromBech32(ALICE).getPublicKey()),
            Buffer.from([1]),
            Buffer.from(pin.cancelKey),
            Buffer.from([5]),
            Buffer.from([1])
          ]
        }
      ]
    };
    expect(texts(red((await inspectAction(multi, SAFE)).checks))).toMatch(
      new RegExp(`${KEY}, the cancel key of vesting #7 .*to ${ALICE}`)
    );
  });

  it('the same key twice in one cancel is red: a key is one of a kind', async () => {
    mockHeld.add(KEY);
    mockVesting.current = keyState;
    const twice = {
      name: 'SendAsyncCall',
      fields: [
        {
          to: SAFE,
          egld_amount: 0n,
          endpoint_name: Buffer.from('MultiESDTNFTTransfer'),
          arguments: [
            Buffer.from(Address.newFromBech32(pin.address).getPublicKey()),
            Buffer.from([2]),
            Buffer.from(pin.cancelKey),
            Buffer.from([5]),
            Buffer.from([1]),
            Buffer.from(pin.cancelKey),
            Buffer.from([5]),
            Buffer.from([1]),
            Buffer.from('cancel')
          ]
        }
      ]
    };
    expect(texts(red((await inspectAction(twice, SAFE)).checks))).toMatch(
      /sends .*-05 2 times/
    );
  });
});

describe('the card', () => {
  it('lists every vesting with its dates and amounts', async () => {
    const inspection = await inspectAction(actionOf(await batch()), SAFE);
    render(
      <ActionChecks
        action={{
          actionId: 3,
          description: '',
          checks: inspection.checks,
          vesting: inspection.vesting,
          perform: inspection.perform,
          signerCount: 0,
          signers: [],
          formerSigners: [],
          quorumReached: false
        }}
        showGas={false}
        gasText={undefined}
        onGasText={() => undefined}
      />
    );
    expect(screen.getByText(ALICE)).toBeInTheDocument();
    expect(screen.getByText(BOB)).toBeInTheDocument();
    const firstDate = `${new Date(FIRST * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    expect(screen.getAllByText(`${firstDate}:`)).toHaveLength(2);
    expect(screen.getByText(/2 vestings of/)).toBeInTheDocument();
  });
});
