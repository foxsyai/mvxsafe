// TX-07: a token transfer larger than the safe holds is proposed without a word.
//
// ProposePanel knows the balance of every token it offers (tokens[].amount and
// tokens[].balance, straight from the API) and still hands any amount to
// proposeSendToken. The contract accepts the proposal, the board signs it, and
// at performAction this build of the multisig CLEARS THE ACTION BEFORE issuing
// the async ESDTTransfer when the recipient is in the safe's shard: the
// transfer fails for lack of funds, the tokens stay, the action is gone and the
// board's signatures are consumed for nothing. For a recipient in another
// shard the perform fails and the action is stuck with its signatures until
// everybody unsigns. Proven on devnet, see proofs/TX-07.mjs and the report.
//
// Correct behaviour: refuse, at the propose step, an amount above the balance
// the panel already displays in its own token selector.
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

// What the safe on devnet actually holds: 2.5 WEGLD.
const tokens = [
  {
    identifier: 'WEGLD-a28c59',
    ticker: 'WEGLD',
    name: 'WrappedEGLD',
    balance: '2500000000000000000',
    decimals: 18,
    amount: 2.5
  }
];

const propose = async (amount: string) => {
  const onProposed = jest.fn();
  render(
    <ProposePanel
      safe={SAFE}
      signer={{ address: ALICE, nonce: 1 }}
      tokens={tokens}
      boardSize={3}
      onProposed={onProposed}
    />
  );
  fireEvent.change(screen.getByPlaceholderText('erd1...'), { target: { value: BOB } });
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: amount } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
  });
  // Let the async submit settle, whichever way it goes.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return onProposed;
};

describe('TX-07: the propose form refuses a token amount the safe does not hold', () => {
  beforeEach(() => jest.clearAllMocks());

  test('1000 WEGLD out of a safe holding 2.5 is not proposed', async () => {
    const onProposed = await propose('1000');
    expect(actions.proposeSendToken).not.toHaveBeenCalled();
    expect(onProposed).not.toHaveBeenCalled();
  });

  test('2.500000000000000001 WEGLD, one unit over the balance, is not proposed', async () => {
    const onProposed = await propose('2.500000000000000001');
    expect(actions.proposeSendToken).not.toHaveBeenCalled();
    expect(onProposed).not.toHaveBeenCalled();
  });

  test('the whole balance, 2.5 WEGLD, is still proposed (control)', async () => {
    const onProposed = await propose('2.5');
    expect(actions.proposeSendToken).toHaveBeenCalledWith(
      { address: ALICE, nonce: 1 },
      SAFE,
      BOB,
      'WEGLD-a28c59',
      '2.5',
      18
    );
    expect(onProposed).toHaveBeenCalled();
  });
});
