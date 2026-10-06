import { useState } from 'react';
import {
  proposeAddBoardMember,
  proposeAddProposer,
  proposeChangeQuorum,
  proposeRemoveUser,
  proposeSendEgld,
  proposeSendToken,
  Signer
} from 'multisig/actions';
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
  const [error, setError] = useState('');

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
    } catch (failure: any) {
      setError(failure?.message ?? 'That could not be proposed.');
    }
    setBusy(false);
  };

  const needsAddress = kind !== 'quorum';
  const needsAmount = kind === 'token' || kind === 'egld';

  return (
    <section className='mt-8 rounded-xl border border-[#2A2A32] bg-[#121218] p-5'>
      <h2 className='text-lg font-semibold text-white'>Propose an action</h2>
      <p className={hint}>
        This only asks the board. Nothing moves until the signatures reach the quorum and
        somebody carries it out.
      </p>

      <div className='mt-4 flex flex-wrap gap-2'>
        {TABS.map((tab) => (
          <button
            key={tab.kind}
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
        ))}
      </div>

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
          <label className='text-xs text-[#6B7280]'>
            {kind === 'addBoard' || kind === 'addProposer'
              ? 'Address to add'
              : kind === 'remove'
                ? 'Address to remove'
                : 'Recipient'}
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
          <label className='text-xs text-[#6B7280]'>Amount</label>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder='0.00'
            className={input}
          />
          <p className={hint}>
            Written as you would say it, for example 1500.5. The decimals are handled for you.
          </p>
        </div>
      )}

      {kind === 'quorum' && (
        <div className={field}>
          <label className='text-xs text-[#6B7280]'>New quorum</label>
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

      <button
        type='button'
        disabled={busy}
        onClick={submit}
        className='mt-4 rounded-lg bg-[#FF6E0A] px-5 py-2 text-sm font-semibold text-black hover:bg-[#ff8534] disabled:opacity-50'
      >
        {busy ? 'Waiting for your wallet...' : 'Propose'}
      </button>
    </section>
  );
};
