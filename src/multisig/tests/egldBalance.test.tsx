// Found in the mainnet test on 7 Oct 2026: proposing to send 2 EGLD out of a
// safe holding 1 opened the wallet. Signed by the board, it could only fail
// when carried out. The token path refused this since the audit (TX-07); the
// EGLD path did not.
import '../../__audit__/web/fixSetImmediate';
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

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const ME = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const RECIPIENT = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const ONE_EGLD = '1000000000000000000';

const proposeEgld = async (amount: string) => {
  render(
    <ProposePanel
      safe={SAFE}
      signer={{ address: ME, nonce: 1 }}
      tokens={[]}
      egldBalance={ONE_EGLD}
      boardSize={3}
      onProposed={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send EGLD' }));
  fireEvent.change(screen.getByPlaceholderText('erd1...'), { target: { value: RECIPIENT } });
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: amount } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

describe('the propose form refuses EGLD the safe does not hold', () => {
  beforeEach(() => jest.clearAllMocks());

  test('2 EGLD out of a safe holding 1 is not proposed, and says why', async () => {
    await proposeEgld('2');
    expect(actions.proposeSendEgld).not.toHaveBeenCalled();
    expect(screen.getByText(/holds 1 EGLD/)).toBeInTheDocument();
  });

  test('one unit over the balance is not proposed either', async () => {
    await proposeEgld('1.000000000000000001');
    expect(actions.proposeSendEgld).not.toHaveBeenCalled();
  });

  test('control: 0.5 EGLD out of 1 is proposed', async () => {
    await proposeEgld('0.5');
    expect(actions.proposeSendEgld).toHaveBeenCalledTimes(1);
  });
});
