// What RED-02 and RED-06 do not pin: the two routes of dnsRegister as they ran
// on devnet (redteam/REPORT.md), the words for each of the safe's own endpoints,
// the trial of a self-call, the form, and what stays as it was.
jest.mock(
  'multisig/network',
  () => require('../../../multisig/tests/contractsMock').contractsNetworkMock
);
jest.mock('multisig/actions', () => ({
  proposeCall: jest.fn(async () => 'session')
}));

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { Address } from '@multiversx/sdk-core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CallForm } from 'components/Propose/CallForm';
import { describeAction } from 'multisig/describe';
import { inspectAction, trialCheck } from 'multisig/inspect';
import { predictSafeAddress, shardOf } from 'multisig/legacyCalls';
import { membershipNote } from 'multisig/reads';
import {
  contract,
  mockAccounts,
  mockCode,
  mockTrial
} from '../../../multisig/tests/contractsMock';
import {
  ALICE,
  BOB,
  CAROL,
  ESDT_SYSTEM_SC,
  SAFE,
  utf8
} from '../../display/fixtures';

const pk = (who: string) => Address.newFromBech32(who).getPublicKey();
const EGLD = 10n ** 16n;
const selfCall = (
  endpoint: string,
  args: Uint8Array[] = [],
  egld = 0n,
  name = 'SendAsyncCall'
) => ({
  name,
  fields: [
    {
      to: SAFE,
      egld_amount: egld,
      endpoint_name: utf8(endpoint),
      arguments: args
    }
  ]
});
const redOf = async (action: any) =>
  (await inspectAction(action, SAFE)).checks.filter(
    (check) => check.tone === 'bad'
  );

beforeEach(() => {
  mockTrial.answer = async () => ({ gasLimit: 3800000 });
});

describe('dnsRegister says what its route does', () => {
  const args = [pk(ALICE), utf8('zzzname')];

  test('proposeTransferExecute: the EGLD really leaves', async () => {
    const sentence = await describeAction(
      selfCall('dnsRegister', args, EGLD, 'SendTransferExecute'),
      SAFE
    );
    expect(sentence).toContain(
      `Send 0.01 EGLD out of this safe to ${ALICE}, calling register(zzzname) there`
    );
    expect(sentence).toMatch(/really goes/);
    expect(sentence).not.toMatch(/used up/);
  });

  test('proposeAsyncCall: it failed on devnet, and the action is used up', async () => {
    const sentence = await describeAction(
      selfCall('dnsRegister', args, EGLD),
      SAFE
    );
    expect(sentence).toContain(
      `Try to send 0.01 EGLD out of this safe to ${ALICE}, calling register(zzzname) there`
    );
    expect(sentence).toMatch(/stayed in the safe and the action was used up/);
  });

  test('malformed: the arguments stay raw, and it stays red', async () => {
    const action = selfCall('dnsRegister', [utf8('zzzname')], EGLD);
    expect(await describeAction(action, SAFE)).toMatch(
      /Call dnsRegister\(zzzname.*on this safe itself, sending 0\.01 EGLD/
    );
    expect((await redOf(action)).length).toBeGreaterThan(0);
  });
});

test.each([
  ['sign', [Uint8Array.of(2)], /approve action #2 on the board's behalf/],
  ['unsign', [Uint8Array.of(2)], /take back its own approval of action #2/],
  ['performAction', [Uint8Array.of(2)], /carry out action #2 on the board's/],
  ['discardAction', [Uint8Array.of(2)], /throw away action #2/],
  [
    'proposeAddBoardMember',
    [pk(BOB)],
    new RegExp(`adding ${BOB} to the board`)
  ],
  ['proposeAddProposer', [pk(BOB)], new RegExp(`adding ${BOB} as a proposer`)],
  ['proposeRemoveUser', [pk(BOB)], new RegExp(`removing ${BOB}`)],
  ['proposeChangeQuorum', [Uint8Array.of(1)], /signatures needed to 1/],
  [
    'proposeTransferExecute',
    [pk(BOB), Uint8Array.of(1), utf8('claim')],
    new RegExp(`sending 0.000000000000000001 EGLD to ${BOB}, calling claim`)
  ]
])(
  '%s on the safe itself is said for what it does, in red',
  async (endpoint, args, words) => {
    const action = selfCall(endpoint as string, args as Uint8Array[]);
    expect(await describeAction(action, SAFE)).toMatch(words as RegExp);
    const red = await redOf(action);
    expect(red.some((check) => check.text.includes(endpoint as string))).toBe(
      true
    );
  }
);

test('an unknown function on the safe itself keeps its raw arguments, and is red', async () => {
  const action = selfCall('deposit');
  expect(await describeAction(action, SAFE)).toMatch(
    /Call deposit\(\) on this safe itself/
  );
  expect((await redOf(action)).length).toBeGreaterThan(0);
});

test('sign with an argument that is no action id is not read as one', async () => {
  const action = selfCall('sign', [utf8('not an id')]);
  expect(await describeAction(action, SAFE)).toMatch(
    /Call sign\(.*on this safe itself/
  );
});

test('control: a token sent through the safe itself stays a token move, named with its recipient, not red', async () => {
  const action = selfCall('ESDTNFTTransfer', [
    utf8('LKMEX-aab910'),
    Uint8Array.of(1),
    Uint8Array.of(1),
    pk(ALICE)
  ]);
  expect(await describeAction(action, SAFE)).toContain(`to ${ALICE}`);
  expect(await redOf(action)).toEqual([]);
});

describe('a trial that gives no figure', () => {
  const noFigure = { need: null, how: 'unmeasured' } as const;
  const sameShard = predictSafeAddress(ALICE, 60);
  const otherShard = predictSafeAddress(CAROL, 40);

  test('premises', () => {
    expect(shardOf(sameShard)).toBe(shardOf(SAFE));
    expect(shardOf(otherShard)).not.toBe(shardOf(SAFE));
  });
  test('on the safe itself: never another shard', () => {
    const { text } = trialCheck(noFigure, { to: SAFE, safe: SAFE });
    expect(text).not.toMatch(/another shard/);
    expect(text).toMatch(/on the safe itself/);
  });
  test("in the safe's shard: never another shard", () => {
    const { text } = trialCheck(noFigure, { to: sameShard, safe: SAFE });
    expect(text).not.toMatch(/another shard/);
  });
  test('control: in another shard, and in the metachain, it is another shard', () => {
    for (const to of [otherShard, ESDT_SYSTEM_SC]) {
      expect(trialCheck(noFigure, { to, safe: SAFE }).text).toMatch(
        /another shard/
      );
    }
  });
  test('the card of a 600,000,001 trial of a self-call has the true wording', async () => {
    mockTrial.answer = async () => ({ gasLimit: 600000001 });
    const { checks } = await inspectAction(
      selfCall('dnsRegister', [pk(ALICE), utf8('zzzname')], EGLD),
      SAFE
    );
    expect(checks.some((check) => /another shard/.test(check.text))).toBe(
      false
    );
  });
});

test('the form names the refusal, with no green owner line and no trial', async () => {
  mockAccounts[SAFE] = contract({ owner: SAFE, hash: mockCode('the safe') });
  const trial = jest.fn(async () => ({ gasLimit: 3800000 }));
  mockTrial.answer = trial;
  render(
    <CallForm
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      onProposed={jest.fn()}
    />
  );
  fireEvent.change(screen.getByPlaceholderText('erd1qqqqqqqqqqqqqpgq...'), {
    target: { value: SAFE }
  });
  fireEvent.change(screen.getByPlaceholderText('setFee'), {
    target: { value: 'sign' }
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 900)));
  expect(screen.getByText(/This is the safe itself/)).toHaveAttribute(
    'data-tone',
    'bad'
  );
  expect(screen.queryByText('The safe owns this contract.')).toBeNull();
  expect(trial).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Propose' })).toBeDisabled();
});

describe('a board seat for what is not a wallet', () => {
  const state = { quorum: 2, boardMembers: [ALICE, BOB], proposers: [] };
  const OTHER_CONTRACT = predictSafeAddress(CAROL, 7);

  test('this very safe is named as such, on the note and in red', async () => {
    const action = { name: 'AddBoardMember', fields: [SAFE] };
    expect(membershipNote(action, state, SAFE)).toMatch(/THIS SAFE/);
    const { checks } = await inspectAction(action, SAFE);
    expect(checks[0].tone).toBe('bad');
    expect(checks[0].text).toMatch(/THIS SAFE/);
  });
  test('another contract is named as a contract, in amber', async () => {
    const action = { name: 'AddBoardMember', fields: [OTHER_CONTRACT] };
    expect(membershipNote(action, state, SAFE)).toMatch(
      /a contract, not a wallet/
    );
    const { checks } = await inspectAction(action, SAFE);
    expect(checks[0].tone).toBe('warn');
  });
  test('a proposer who is a contract gets both notes', () => {
    const note = membershipNote(
      { name: 'AddBoardMember', fields: [OTHER_CONTRACT] },
      { ...state, proposers: [OTHER_CONTRACT] },
      SAFE
    );
    expect(note).toMatch(/a proposer today/);
    expect(note).toMatch(/a contract, not a wallet/);
  });
  test('control: a wallet carries neither', async () => {
    const action = { name: 'AddBoardMember', fields: [CAROL] };
    expect(membershipNote(action, state, SAFE)).toBe('');
    expect((await inspectAction(action, SAFE)).checks).toEqual([]);
  });
});
