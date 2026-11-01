// RED-06 (redteam audit, 1 Nov 2026): a proposal that becomes dangerous after
// a later one. The safe on its own board, and a call on the safe itself that
// signs for it.
//
// Step 1, an odd but innocent-looking action: "Add erd1qqqq...<this safe> to
// the board". The board list accepts any address, and the sentence carries no
// note that the address is a contract, let alone this very safe (the Create
// page does warn about a contract on a board; the propose form and the card
// do not).
// Step 2, the rogue member proposes #2, the drain, which they sign themselves
// (1 of 2), and #3: proposeAsyncCall(to = the safe, "sign", 2). Its sentence:
//   "Call sign(2) on this safe itself. Do not sign without checking it in the
//    explorer."
// An honest member who signs #3 (one more signature, 2 of 2) makes the safe
// call its own sign(2) as a board member: #2 is at quorum and the rogue
// carries it out. The honest member read "sign(2)", never that it approves
// action #2 on the board's behalf.
//
// Every endpoint of the multisig reached this way (sign, unsign,
// performAction, discardAction, propose*, dnsRegister, deposit) is described
// only as "Call X(...) on this safe itself"; none is red.
jest.mock(
  'multisig/network',
  () => require('../../display/fixtures').networkMock
);

import { describeAction } from 'multisig/describe';
import { inspectAction } from 'multisig/inspect';
import { membershipNote } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, utf8 } from '../../display/fixtures';

const state = { quorum: 2, boardMembers: [ALICE, BOB, CAROL], proposers: [] };
const ANOTHER_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqntmhxqa29ar4juhlprjjxaq790ykcj3uaujq2l9dzg';

test('control: adding a wallet that holds no role carries no note', () => {
  // A devnet rehearsal wallet (docs/upgrade-and-calls.md), not on this board.
  const note = membershipNote(
    {
      name: 'AddBoardMember',
      fields: ['erd1wdqwnz0kdswj6njp0yzllkd5q4km9ygvtkme4zlg5kn026mdzc0s77fspw']
    },
    state
  );
  expect(note).toBe('');
});

test('adding THIS SAFE to its own board is said for what it is', () => {
  const note = membershipNote(
    { name: 'AddBoardMember', fields: [SAFE] },
    state
  );
  expect(note).toMatch(/itself|this safe|contract/i);
});

test('adding a contract to the board says it is a contract', () => {
  const note = membershipNote(
    { name: 'AddBoardMember', fields: [ANOTHER_CONTRACT] },
    state
  );
  expect(note).toMatch(/contract/i);
});

const signSelf = {
  name: 'SendAsyncCall',
  fields: [
    {
      to: SAFE,
      egld_amount: 0n,
      endpoint_name: utf8('sign'),
      arguments: [Uint8Array.of(2)]
    }
  ]
};

test("a call to sign(2) on the safe itself says it approves action #2 on the board's behalf, and is red", async () => {
  const sentence = await describeAction(signSelf, SAFE);
  // Today: "Call sign(2) on this safe itself. Do not sign without checking it
  // in the explorer." The effect, a signature on #2 that counts toward the
  // quorum, is not said.
  expect(sentence).toMatch(/signature|quorum|approve/i);
  const { checks } = await inspectAction(signSelf, SAFE);
  expect(checks.some((check) => check.tone === 'bad')).toBe(true);
});
