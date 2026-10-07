/**
 * @jest-environment node
 *
 * Found in the mainnet test on 7 Oct 2026, while the public API answered 429:
 * a role that could not be read came back as "None" ("You are not on this
 * board"), and a quorum that could not be read made a card say "not a
 * multisig". A refused read is not an answer.
 */
jest.mock('multisig/network', () => require('../../__audit__/display/fixtures').networkMock);
import { readCard, readUserRole } from 'multisig/reads';
import { ALICE, BOB, CAROL, SAFE, useChain, useFailing } from '../../__audit__/display/fixtures';

beforeEach(() => {
  useChain({ quorum: 2, board: [ALICE, BOB, CAROL], pending: [], roles: { [ALICE]: 2 } });
  useFailing([]);
});

test('control: a role that can be read is read', async () => {
  expect(await readUserRole(SAFE, ALICE)).toBe('BoardMember');
});

test('a role the API refused is not reported as "None"', async () => {
  useFailing(['userRole']);
  await expect(readUserRole(SAFE, ALICE)).rejects.toThrow();
});

test('a card whose quorum the API refused is not "not a multisig"', async () => {
  useFailing(['getQuorum']);
  await expect(readCard(SAFE, ALICE)).rejects.toThrow();
});
