// Found in the mainnet test on 7 Oct 2026: proposing a board member as a
// proposer "did nothing". Propose was disabled while the last transaction was
// being confirmed, and the reason was only at the top of the page; and what a
// membership change would do was said only once it was proposed.
import '../../__audit__/web/fixSetImmediate';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProposePanel } from 'components/Propose/ProposePanel';

jest.mock('multisig/actions', () => ({
  proposeSendToken: jest.fn(), proposeSendEgld: jest.fn(), proposeAddBoardMember: jest.fn(),
  proposeAddProposer: jest.fn(), proposeRemoveUser: jest.fn(), proposeChangeQuorum: jest.fn()
}));

const SAFE = 'erd1qqqqqqqqqqqqqpgq4a8ursp5sf376rpqecz89p56pzjh9cv76qlsljglrq';
const CEO = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const COO = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';
const CTO = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const SPARE = 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd';

const panel = (extra: Record<string, unknown> = {}) =>
  render(
    <ProposePanel
      safe={SAFE}
      signer={{ address: SPARE, nonce: 1 }}
      tokens={[]}
      boardSize={4}
      boardMembers={[CEO, COO, CTO, SPARE]}
      proposers={[]}
      quorum={2}
      onProposed={jest.fn()}
      {...extra}
    />
  );

test('making a board member a proposer says, before proposing, that it takes them off the board', () => {
  panel();
  fireEvent.click(screen.getByRole('button', { name: 'Add proposer' }));
  fireEvent.change(screen.getByPlaceholderText('erd1...'), { target: { value: SPARE } });
  expect(screen.getByText(/takes them off the board/)).toBeInTheDocument();
});

test('a quorum equal to the board warns while choosing it', () => {
  panel();
  fireEvent.click(screen.getByRole('button', { name: 'Change quorum' }));
  fireEvent.change(screen.getByPlaceholderText('4'), { target: { value: '4' } });
  expect(screen.getByText(/one lost wallet would lock the safe/)).toBeInTheDocument();
});

test('a disabled Propose says why, next to the button', () => {
  panel({ disabled: true, disabledReason: 'Waiting for the network to confirm the last transaction.' });
  expect(screen.getByRole('button', { name: 'Propose' })).toBeDisabled();
  expect(screen.getByText('Waiting for the network to confirm the last transaction.')).toBeInTheDocument();
});

// Asked in the mainnet test on 7 Oct 2026: removing an address that holds no
// role is accepted by the contract and changes nothing but the fees.
test('a change that would do nothing is flagged as a warning while typing it', () => {
  panel();
  fireEvent.click(screen.getByRole('button', { name: 'Remove member' }));
  fireEvent.change(screen.getByPlaceholderText('erd1...'), {
    target: { value: 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3' }
  });
  const note = screen.getByText(/this changes nothing/);
  expect(note.className).toMatch(/FBBF24/);
});

