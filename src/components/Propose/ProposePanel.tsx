import { useEffect, useState } from 'react';
import {
  proposeAddBoardMember,
  proposeAddProposer,
  proposeChangeQuorum,
  proposeRemoveUser,
  proposeSendEgld,
  proposeSendToken,
  Signer
} from 'multisig/actions';
import { explainWalletFailure } from 'multisig/walletFailure';
import { Info, Tip } from 'components/Info';
import { TokenBalance } from 'multisig/reads';

// Proposing changes nothing on its own: it puts a request in front of the board,
// which then has to reach the quorum. Every field here ends up in the action
// description the other signers read, so the wording of the form matters.

type Kind = 'token' | 'egld' | 'addBoard' | 'addProposer' | 'remove' | 'quorum';

const TABS: { kind: Kind; label: string }[] = [
  { kind: 'token', label: 'Send tokens' },
  { kind: 'egld', label: 'Send EGLD' },
  { kind: 'addBoard', label: 'Add board member' },
  { kind: 'addProposer', label: 'Add proposer' },
  { kind: 'remove', label: 'Remove member' },
  { kind: 'quorum', label: 'Change quorum' }
];

// One sentence per kind of action, shown next to the form rather than in a
// manual nobody opens.
const EXPLAIN: Record<Kind, string> = {
  token:
    'Send a token the safe holds to any address. The board has to approve it before anything moves.',
  egld: 'Send EGLD, the network coin, rather than a token.',
  addBoard:
    'A board member can propose actions, sign them and carry them out. Adding one is itself an action the board has to approve.',
  addProposer:
    'A proposer can only suggest actions, never approve them. Useful for someone who prepares payments while the board keeps the say over them.',
  remove: 'Take a board member or a proposer out. Needs the board\'s approval like anything else.',
  quorum:
    'How many signatures an action needs. Raising it makes the safe stricter, lowering it makes it easier to use. It can never be higher than the number of board members.'
};

const input =
  'w-full rounded-lg border border-[#2A2A32] bg-[#0E0E12] px-3 py-2 text-sm text-white placeholder-[#4B5563]';
const field = 'mt-3';
const hint = 'mt-1 text-xs text-[#6B7280]';

interface ProposePanelProps {
  safe: string;
  signer: Signer;
  tokens: TokenBalance[];
  boardSize: number;
  onProposed: () => void;
}

export const ProposePanel = ({
  safe,
  signer,
  tokens,
  boardSize,
  onProposed
}: ProposePanelProps) => {
  const [kind, setKind] = useState<Kind>('token');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [tokenId, setTokenId] = useState(tokens[0]?.identifier ?? '');
  const [quorum, setQuorum] = useState('');
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [error, setError] = useState('');

  // An xPortal request dismissed on the phone never comes back as a refusal, so
  // the button would say "Waiting for your wallet" until the page is reloaded.
  // After a while the panel offers a way out, without claiming anything about
  // what the wallet did (Sebastian, 6 Oct 2026).
  useEffect(() => {
    if (!busy) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), 25000);
    return () => clearTimeout(timer);
  }, [busy]);

  const token = tokens.find((candidate) => candidate.identifier === tokenId);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      switch (kind) {
        case 'token':
          if (!token) throw new Error('Choose a token.');
          await proposeSendToken(signer, safe, to, token.identifier, amount, token.decimals);
          break;
        case 'egld':
          await proposeSendEgld(signer, safe, to, amount);
          break;
        case 'addBoard':
          await proposeAddBoardMember(signer, safe, to);
          break;
        case 'addProposer':
          await proposeAddProposer(signer, safe, to);
          break;
        case 'remove':
          await proposeRemoveUser(signer, safe, to);
          break;
        case 'quorum': {
          const value = Number(quorum);
          if (!Number.isInteger(value) || value < 1 || value > boardSize) {
            throw new Error(`The quorum has to be a whole number between 1 and ${boardSize}.`);
          }
          await proposeChangeQuorum(signer, safe, value);
          break;
        }
      }
      setTo('');
      setAmount('');
      setQuorum('');
      onProposed();
    } catch (failure: unknown) {
      setError(explainWalletFailure(failure, 'The proposal'));
    }
    setBusy(false);
  };

  const needsAddress = kind !== 'quorum';
  const needsAmount = kind === 'token' || kind === 'egld';

  return (
    <section className='mt-8 rounded-xl border border-[#2A2A32] bg-[#121218] p-5'>
      <h2 className='flex items-center text-lg font-semibold text-white'>
        Propose an action
        <Info text='Proposing puts a request in front of the board. It costs a small network fee and changes nothing on its own.' />
      </h2>
      <p className={hint}>
        Nothing moves until the signatures reach the quorum and somebody carries it out.
      </p>

      <div className='mt-4 flex flex-wrap gap-2'>
        {TABS.map((tab) => (
          <Tip key={tab.kind} text={EXPLAIN[tab.kind]}>
            <button
              type='button'
              onClick={() => setKind(tab.kind)}
              className={
                kind === tab.kind
                  ? 'rounded-lg bg-[#FF6E0A] px-3 py-1.5 text-xs font-semibold text-black'
                  : 'rounded-lg border border-[#2A2A32] px-3 py-1.5 text-xs text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'
              }
            >
              {tab.label}
            </button>
          </Tip>
        ))}
      </div>

      <p className='mt-4 rounded-lg border border-[#2A2A32] bg-[#0E0E12] p-3 text-xs leading-relaxed text-[#9AA0A6]'>
        {EXPLAIN[kind]}
      </p>

      {kind === 'token' && (
        <div className={field}>
          <label className='text-xs text-[#6B7280]'>Token</label>
          <select
            value={tokenId}
            onChange={(event) => setTokenId(event.target.value)}
            className={input}
          >
            {tokens.length === 0 && <option value=''>This safe holds no tokens</option>}
            {tokens.map((candidate) => (
              <option key={candidate.identifier} value={candidate.identifier}>
                {candidate.ticker} ({candidate.amount.toLocaleString('en-US')})
              </option>
            ))}
          </select>
        </div>
      )}

      {needsAddress && (
        <div className={field}>
          <label className='flex items-center text-xs text-[#6B7280]'>
            {kind === 'addBoard' || kind === 'addProposer'
              ? 'Address to add'
              : kind === 'remove'
                ? 'Address to remove'
                : 'Recipient'}
            <Info text='A MultiversX address, starting with erd1. Check it twice: the board approves exactly what is written here.' />
          </label>
          <input
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder='erd1...'
            className={`${input} font-mono`}
          />
        </div>
      )}

      {needsAmount && (
        <div className={field}>
          <label className='flex items-center text-xs text-[#6B7280]'>
            Amount
            <Info text='Written the way you would say it, for example 1500.5. The decimals are handled for you.' />
          </label>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder='0.00'
            className={input}
          />
        </div>
      )}

      {kind === 'quorum' && (
        <div className={field}>
          <label className='flex items-center text-xs text-[#6B7280]'>
            New quorum
            <Info text='The number of signatures every future action will need.' />
          </label>
          <input
            value={quorum}
            onChange={(event) => setQuorum(event.target.value)}
            placeholder={String(boardSize)}
            className={input}
          />
          <p className={hint}>
            How many signatures an action needs. The board has {boardSize} members.
          </p>
        </div>
      )}

      {error && <p className='mt-3 text-xs text-[#F87171]'>{error}</p>}

      <div className='mt-4'>
        <Tip text='Puts the request in front of the board. Your wallet will ask you to sign this proposal, which costs a small network fee and moves nothing by itself.'>
          <button
            type='button'
            disabled={busy}
            onClick={submit}
            className='rounded-lg bg-[#FF6E0A] px-5 py-2 text-sm font-semibold text-black hover:bg-[#ff8534] disabled:opacity-50'
          >
            {busy ? 'Waiting for your wallet...' : 'Propose'}
          </button>
        </Tip>
        {busy && stuck && (
          <p className='mt-3 text-xs text-[#6B7280]'>
            Your wallet has not answered. If you dismissed the request,{' '}
            <button
              type='button'
              onClick={() => setBusy(false)}
              className='text-[#FF6E0A] hover:underline'
            >
              start over
            </button>
            . If you did sign it, it is on its way and will appear above by itself.
          </p>
        )}
      </div>
    </section>
  );
};
