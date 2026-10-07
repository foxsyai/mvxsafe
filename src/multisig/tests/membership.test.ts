/**
 * @jest-environment node
 *
 * One address holds one role in this contract. A membership proposal has to
 * say what it really does to that address, and when the contract will refuse
 * it (raised in the mainnet test, 7 Oct 2026).
 */
import { membershipNote } from 'multisig/reads';

const CEO = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const COO = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';
const CTO = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const SPARE = 'erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0';

const state = { quorum: 2, boardMembers: [CEO, COO, CTO], proposers: [SPARE] };
const action = (name: string, who: string) => ({ name, fields: [who] });

test('adding a proposer to the board says it is a promotion', () => {
  expect(membershipNote(action('AddBoardMember', SPARE), state)).toMatch(/a proposer today: the board seat replaces that role/);
});

test('adding a board member as a proposer says it takes them off the board', () => {
  expect(membershipNote(action('AddProposer', CTO), state)).toMatch(/takes them off the board/);
});

test('removing whoever is on the board or proposing says which', () => {
  expect(membershipNote(action('RemoveUser', CTO), state)).toBe(' (on the board today)');
  expect(membershipNote(action('RemoveUser', SPARE), state)).toBe(' (a proposer today)');
});

test('no-ops say so', () => {
  expect(membershipNote(action('AddBoardMember', CEO), state)).toMatch(/already on the board/);
  expect(membershipNote(action('AddProposer', SPARE), state)).toMatch(/already a proposer/);
  expect(membershipNote(action('RemoveUser', 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3'), state)).toMatch(/holds no role today/);
});

test('what the contract will refuse is said before anyone signs', () => {
  const tight = { quorum: 3, boardMembers: [CEO, COO, CTO], proposers: [] };
  expect(membershipNote(action('RemoveUser', CTO), tight)).toMatch(/leave 2 board members for the 3 signatures needed.*refuse/);
  expect(membershipNote(action('AddProposer', COO), tight)).toMatch(/refuse/);
});

test('a plain new member or proposer needs no note', () => {
  const fresh = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
  expect(membershipNote(action('AddBoardMember', fresh), state)).toBe('');
  expect(membershipNote(action('AddProposer', fresh), state)).toBe('');
  expect(membershipNote({ name: 'ChangeQuorum', fields: [2] }, state)).toBe('');
});
