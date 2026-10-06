import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AddressLine } from 'components/Address';
import { Info, Tip } from 'components/Info';
import { ProposePanel } from 'components/Propose';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import {
  discardAction,
  performAction,
  signAction,
  unsignAction
} from 'multisig/actions';
import { PRIMARY_TOKEN } from 'config/safes';
import { clearCache, explorerUrl } from 'multisig/network';
import {
  HistoryEntry,
  PendingAction,
  readHistory,
  readOverview,
  readPendingActions,
  readUserRole,
  SafeOverview,
  shortAddress
} from 'multisig/reads';
import { nameFor } from 'multisig/savedSafes';

const card = 'rounded-xl border border-[#2A2A32] bg-[#121218] p-5';
const label = 'text-xs text-[#6B7280]';

export const Safe = () => {
  const { address = '' } = useParams();
  const [overview, setOverview] = useState<SafeOverview | null>(null);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [role, setRole] = useState('None');
  const [working, setWorking] = useState(0);

  const isLoggedIn = useGetIsLoggedIn();
  const account = useGetAccount();
  const signer = { address: account.address, nonce: Number(account.nonce ?? 0) };
  const canPropose = role === 'BoardMember' || role === 'Proposer';
  const canSign = role === 'BoardMember';

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setOverview(await readOverview(address));
      setPending(await readPendingActions(address));
      setHistory(await readHistory(address));
      setRole(isLoggedIn ? await readUserRole(address, account.address) : 'None');
    } catch {
      setFailed(true);
    }
    setLoading(false);
  }, [address, isLoggedIn, account.address]);

  // Every one of these ends in the visitor's wallet asking them to confirm.
  const run = async (actionId: number, work: () => Promise<unknown>) => {
    setWorking(actionId);
    try {
      await work();
      clearCache();
      await load();
    } catch {
      // The wallet was closed or the transaction was refused: nothing happened.
    }
    setWorking(0);
  };

  useEffect(() => {
    load();
  }, [load]);

  const title = nameFor(address) || 'Safe';
  const tokens = overview?.tokens ?? [];
  const primary = tokens.find((token) => token.identifier === PRIMARY_TOKEN);
  const others = tokens.filter((token) => token.identifier !== PRIMARY_TOKEN);

  return (
    <div className='mx-auto w-full max-w-5xl px-4 py-10'>
      <Link to='/' className='text-sm text-[#9AA0A6] hover:text-[#FF6E0A]'>
        &larr; All safes
      </Link>

      <div className='mt-4 flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='text-3xl font-semibold text-white'>{title}</h1>
          <AddressLine address={address} short={false} className='mt-2 text-xs text-[#6B7280]' />
          {isLoggedIn && (
            <p className='mt-2 text-xs text-[#6B7280]'>
              You are{' '}
              <span className='text-[#9AA0A6]'>
                {role === 'BoardMember'
                  ? 'a board member here: you can propose, sign and carry out actions'
                  : role === 'Proposer'
                    ? 'a proposer here: you can propose, but not sign'
                    : 'not on this board, so you can only look'}
              </span>
              .
            </p>
          )}
        </div>
        <Tip text='Reads everything from the chain again, ignoring what was remembered.'>
          <button
            type='button'
            onClick={() => {
              clearCache();
              load();
            }}
            className='rounded-lg border border-[#2A2A32] px-4 py-2 text-sm text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </Tip>
      </div>

      {failed && (
        <p className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          This address could not be read from the network.
        </p>
      )}

      <div className='mt-6 grid gap-4 md:grid-cols-3'>
        <div className={card}>
          <p className={label + ' flex items-center'}>
            Quorum
            <Info text='How many of the board members have to sign before an action can be carried out.' />
          </p>
          <p className='mt-1 text-2xl font-semibold text-white'>
            {overview?.quorum
              ? `${overview.quorum} of ${overview.boardMembers.length}`
              : loading
                ? '...'
                : 'unknown'}
          </p>
          <p className='mt-2 text-xs text-[#6B7280]'>
            {overview ? `${overview.proposerCount} proposers` : ''}
          </p>
        </div>
        <div className={card}>
          <p className={label}>{primary ? primary.ticker : 'Tokens'}</p>
          <p className='mt-1 text-2xl font-semibold text-white'>
            {primary
              ? primary.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
              : tokens.length}
          </p>
          <p className='mt-2 text-xs text-[#6B7280]'>
            {overview ? `${overview.egld.toFixed(4)} EGLD` : ''}
          </p>
        </div>
        <div className={card}>
          <p className={label + ' flex items-center'}>
            Actions
            <Info text='Waiting for signatures right now. The number underneath counts every action ever proposed, carried out or discarded.' />
          </p>
          <p className='mt-1 text-2xl font-semibold text-white'>
            {overview ? overview.pendingCount : '...'}
          </p>
          <p className='mt-2 text-xs text-[#6B7280]'>
            {overview ? `${overview.actionCount} in total since deployment` : ''}
          </p>
        </div>
      </div>

      <section className='mt-8'>
        <h2 className='flex items-center text-lg font-semibold text-white'>
          Pending actions
          <Info text='Each one is written in plain words. Read it before signing: this is what the safe will do.' />
        </h2>
        {pending.length === 0 ? (
          <p className='mt-3 text-sm text-[#6B7280]'>
            {loading ? 'Loading...' : 'Nothing is waiting for a signature.'}
          </p>
        ) : (
          <div className='mt-3 space-y-3'>
            {pending.map((action) => (
              <div key={action.actionId} className={card}>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <p className='text-white'>
                    <span className='mr-2 font-mono text-xs text-[#6B7280]'>
                      #{action.actionId}
                    </span>
                    {action.description}
                  </p>
                  <span
                    className={
                      action.quorumReached
                        ? 'rounded-full bg-[#FF6E0A]/15 px-3 py-1 text-xs text-[#FF6E0A]'
                        : 'rounded-full bg-[#2A2A32] px-3 py-1 text-xs text-[#9AA0A6]'
                    }
                  >
                    {action.signerCount} of {overview?.quorum ?? '?'} signatures
                  </span>
                </div>
                {action.signers.length > 0 && (
                  <p className='mt-2 font-mono text-xs text-[#6B7280]'>
                    signed by {action.signers.map((s) => shortAddress(s)).join(', ')}
                  </p>
                )}

                {isLoggedIn && (canSign || canPropose) && (
                  <div className='mt-3 flex flex-wrap items-center gap-2'>
                    {canSign &&
                      (action.signers.includes(account.address) ? (
                        <Tip text='Takes your approval back. Possible for as long as the action is still waiting.'><button
                          type='button'
                          disabled={working === action.actionId}
                          onClick={() =>
                            run(action.actionId, () =>
                              unsignAction(signer, address, action.actionId)
                            )
                          }
                          className='rounded-lg border border-[#2A2A32] px-3 py-1.5 text-xs text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white disabled:opacity-50'
                        >
                          Remove my signature
                        </button></Tip>
                      ) : (
                        <Tip text='Approves this action. It still needs the rest of the quorum before anything happens.'><button
                          type='button'
                          disabled={working === action.actionId}
                          onClick={() =>
                            run(action.actionId, () =>
                              signAction(signer, address, action.actionId)
                            )
                          }
                          className='rounded-lg bg-[#FF6E0A] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#ff8534] disabled:opacity-50'
                        >
                          Sign
                        </button></Tip>
                      ))}

                    {action.quorumReached && (
                      <Tip text='Makes it happen. Enough signatures are in, and any board member may press this.'><button
                        type='button'
                        disabled={working === action.actionId}
                        onClick={() =>
                          run(action.actionId, () =>
                            performAction(signer, address, action.actionId)
                          )
                        }
                        className='rounded-lg bg-[#F5F5F5] px-4 py-1.5 text-xs font-semibold text-black hover:bg-white disabled:opacity-50'
                      >
                        Carry it out
                      </button></Tip>
                    )}

                    <Tip text='Throws the action away without doing it. Nothing moves and nothing is spent.'>
                      <button
                        type='button'
                        disabled={working === action.actionId}
                        onClick={() =>
                          run(action.actionId, () =>
                            discardAction(signer, address, action.actionId)
                          )
                        }
                        className='rounded-lg border border-[#2A2A32] px-3 py-1.5 text-xs text-[#6B7280] hover:border-[#F87171] hover:text-[#F87171] disabled:opacity-50'
                      >
                        Discard
                      </button>
                    </Tip>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {isLoggedIn && canPropose && overview && (
        <ProposePanel
          safe={address}
          signer={signer}
          tokens={overview.tokens}
          boardSize={overview.boardMembers.length}
          onProposed={() => {
            clearCache();
            load();
          }}
        />
      )}

      <div className='mt-8 grid gap-4 md:grid-cols-2'>
        <section className={card}>
          <h2 className='flex items-center text-lg font-semibold text-white'>
            Board
            <Info text='The addresses that may sign. A proposer, if there is one, can suggest actions but not approve them.' />
          </h2>
          <ul className='mt-3 space-y-2'>
            {(overview?.boardMembers ?? []).map((member) => (
              <li key={member} className='flex items-center justify-between gap-2'>
                <AddressLine address={member} className='text-xs text-[#9AA0A6]' />
                {member === account.address && (
                  <span className='text-[10px] tracking-wider text-[#FF6E0A] uppercase'>you</span>
                )}
              </li>
            ))}
            {!loading && (overview?.boardMembers.length ?? 0) === 0 && (
              <li className='text-sm text-[#6B7280]'>No board members found.</li>
            )}
          </ul>
        </section>

        <section className={card}>
          <h2 className='text-lg font-semibold text-white'>Holdings</h2>
          <ul className='mt-3 space-y-2 text-sm'>
            <li className='flex justify-between'>
              <span className='text-[#9AA0A6]'>EGLD</span>
              <span className='text-white'>{(overview?.egld ?? 0).toFixed(4)}</span>
            </li>
            {primary && (
              <li className='flex justify-between'>
                <span className='text-[#9AA0A6]'>{primary.ticker}</span>
                <span className='text-white'>
                  {primary.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
              </li>
            )}
            {others.map((token) => (
              <li key={token.identifier} className='flex justify-between'>
                <span className='text-[#9AA0A6]'>{token.ticker}</span>
                <span className='text-white'>
                  {token.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
              </li>
            ))}
            {overview && overview.nftCount > 0 && (
              <li className='flex justify-between'>
                <span className='text-[#9AA0A6]'>NFTs</span>
                <span className='text-white'>{overview.nftCount}</span>
              </li>
            )}
          </ul>
        </section>
      </div>

      <section className='mt-8'>
        <h2 className='text-lg font-semibold text-white'>History</h2>
        <div className='mt-3 overflow-hidden rounded-xl border border-[#2A2A32]'>
          <table className='w-full text-left text-sm'>
            <thead className='bg-[#121218] text-xs text-[#6B7280]'>
              <tr>
                <th className='px-4 py-3'>When</th>
                <th className='px-4 py-3'>Action</th>
                <th className='px-4 py-3'>By</th>
                <th className='px-4 py-3'>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.txHash} className='border-t border-[#2A2A32]'>
                  <td className='px-4 py-3 text-[#9AA0A6]'>
                    {new Date(entry.timestamp * 1000).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC'
                    })}
                  </td>
                  <td className='px-4 py-3 text-white'>{entry.functionName}</td>
                  <td className='px-4 py-3 font-mono text-xs text-[#6B7280]'>
                    {shortAddress(entry.sender)}
                  </td>
                  <td className='px-4 py-3'>
                    <a
                      href={`${explorerUrl}/transactions/${entry.txHash}`}
                      target='_blank'
                      rel='noreferrer'
                      className='font-mono text-xs text-[#FF6E0A] hover:underline'
                    >
                      {entry.txHash.slice(0, 10)}...
                    </a>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className='px-4 py-6 text-center text-sm text-[#6B7280]'>
                    {loading ? 'Loading...' : 'No transactions found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
