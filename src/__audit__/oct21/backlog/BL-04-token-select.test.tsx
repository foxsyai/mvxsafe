// Backlog of the audit of 21 Oct 2026 (web report: "the token select loses its
// selection when the token list changes"), proven by the main session: the
// propose form keeps the chosen token by identifier. When that token leaves
// the list (its balance read again as nothing), React shows the FIRST token in
// the select while the form still holds the one that left, and Propose
// answers "Choose a token." under a select that shows one. A form that then
// quietly took the first token would be worse: a proposal to send a token
// nobody chose.
//
// Correct behaviour: the select shows exactly what Propose would send, and
// shows that nothing is chosen when the chosen token has gone.
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ProposePanel } from 'components/Propose/ProposePanel';
import * as actions from 'multisig/actions';

jest.mock('multisig/actions', () => ({
  proposeSendToken: jest.fn(async () => 'session'),
  proposeSendEgld: jest.fn(async () => 'session'),
  proposeAddBoardMember: jest.fn(async () => 'session'),
  proposeAddProposer: jest.fn(async () => 'session'),
  proposeRemoveUser: jest.fn(async () => 'session'),
  proposeChangeQuorum: jest.fn(async () => 'session')
}));

const SAFE = 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy';
const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const BOB = 'erd1cus9zpgyg8ztpvr48j8w8lqack3u7gtlnxlum22cdl0k0vfwm3eq54npug';
const token = (identifier: string) => ({
  identifier,
  ticker: identifier.split('-')[0],
  name: identifier,
  balance: '5000000',
  decimals: 6,
  amount: 5
});
const WEGLD = {
  ...token('WEGLD-a28c59'),
  balance: '5000000000000000000',
  decimals: 18
};
const USDC = token('USDC-350c4e');

const panel = (tokens: (typeof USDC)[]) => (
  <ProposePanel
    safe={SAFE}
    signer={{ address: ALICE, nonce: 1 }}
    tokens={tokens}
    boardSize={3}
    onProposed={jest.fn()}
  />
);
const select = () => screen.getByRole('combobox') as HTMLSelectElement;
const propose = async () => {
  fireEvent.change(screen.getByPlaceholderText('erd1...'), {
    target: { value: BOB }
  });
  fireEvent.change(screen.getByPlaceholderText('0.00'), {
    target: { value: '1' }
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
  });
};
/** What Propose sent, or '' when it sent nothing. */
const sent = () =>
  (actions.proposeSendToken as jest.Mock).mock.calls[0]?.[3] ?? '';

beforeEach(() => jest.clearAllMocks());

test('control: the token chosen is the token proposed', async () => {
  render(panel([WEGLD, USDC]));
  fireEvent.change(select(), { target: { value: USDC.identifier } });
  await propose();
  expect(sent()).toBe(USDC.identifier);
});

test('the chosen token leaves the list: the select shows no choice, and nothing else is proposed', async () => {
  const view = render(panel([WEGLD, USDC]));
  fireEvent.change(select(), { target: { value: USDC.identifier } });
  view.rerender(panel([WEGLD]));
  // What the select shows is what Propose would send.
  expect(select().value).toBe('');
  await propose();
  expect(sent()).toBe('');
  // The form says so, besides the select's own "Choose a token".
  expect(
    screen
      .getAllByText(/Choose a token/)
      .some((node) => node.tagName !== 'OPTION')
  ).toBe(true);
});

test('a list that arrives after the form opened: what the select shows is what is proposed', async () => {
  const view = render(panel([]));
  view.rerender(panel([WEGLD, USDC]));
  const shown = select().value;
  await propose();
  expect(sent()).toBe(shown);
});
