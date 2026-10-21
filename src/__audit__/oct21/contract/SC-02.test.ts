/**
 * @jest-environment node
 *
 * SC-02 (high): the legacy multisig ACCEPTS a quorum of 0 (proven on devnet by
 * proofs/SC-02.mjs: changeQuorum(0) proposed, performed, getQuorum == 0 on the
 * exact mainnet bytecode). With quorum 0, quorumReached is true for EVERY
 * action -- even one with no signatures -- so any single board member or
 * proposer can carry out anything, and the safe's whole protection is gone.
 *
 * mvxsafe's own propose form blocks quorum < 1, but a ChangeQuorum(0) filed with
 * another tool reaches the pending card, where its sentence is built from
 * describeAction + membershipNote. describeAction says only "Change the number
 * of signatures needed to 0"; membershipNote, which DOES warn when a quorum
 * equals or exceeds the board, adds NOTHING for 0 -- the most dangerous value.
 * A signer is shown a safe-destroying action as a mundane number change.
 *
 * Correct behaviour: a quorum of 0 (and, generally, a quorum below 1) must be
 * called out as removing the board's control, as the sibling cases already are.
 */
import { membershipNote } from 'multisig/reads';

const A = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const B = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';
const C = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const state = { quorum: 2, boardMembers: [A, B, C], proposers: [] as string[] };
const changeQuorum = (n: number) => ({ name: 'ChangeQuorum', fields: [n] });

test('control: a sane quorum change (2 on a board of 3) needs no warning', () => {
  expect(membershipNote(changeQuorum(2), state)).toBe('');
});

test('control: the existing quorum-equals-board warning still fires', () => {
  expect(membershipNote(changeQuorum(3), state)).toMatch(/lock|every action/);
});

test('a ChangeQuorum(0) must warn that it removes the board control', () => {
  const note = membershipNote(changeQuorum(0), state);
  // Today this is '' -- no warning at all for the most dangerous value.
  expect(note).not.toBe('');
  expect(note).toMatch(
    /signature|anyone|without|protection|no longer|any (single )?board/i
  );
});
