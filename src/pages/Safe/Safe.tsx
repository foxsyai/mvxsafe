import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PRIMARY_TOKEN } from 'config/safes';
import { clearCache, explorerUrl } from 'multisig/network';
import {
  HistoryEntry,
  PendingAction,
  readHistory,
  readOverview,
  readPendingActions,
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

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setOverview(await readOverview(address));
      setPending(await readPendingActions(address));
      setHistory(await readHistory(address));
    } catch {
      setFailed(true);
    }
    setLoading(false);
  }, [address]);

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
          <a
            href={`${explorerUrl}/accounts/${address}`}
            target='_blank'
            rel='noreferrer'
            className='mt-2 inline-block font-mono text-xs text-[#6B7280] hover:text-[#FF6E0A]'
          >
            {address}
          </a>
        </div>
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
      </div>

      {failed && (
        <p className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          This address could not be read from the network.
        </p>
      )}

      <div className='mt-6 grid gap-4 md:grid-cols-3'>
        <div className={card}>
          <p className={label}>Quorum</p>
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
          <p className={label}>Actions</p>
          <p className='mt-1 text-2xl font-semibold text-white'>
            {overview ? overview.pendingCount : '...'}
          </p>
          <p className='mt-2 text-xs text-[#6B7280]'>
            {overview ? `${overview.actionCount} in total since deployment` : ''}
          </p>
        </div>
      </div>

      <section className='mt-8'>
        <h2 className='text-lg font-semibold text-white'>Pending actions</h2>
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
              </div>
            ))}
          </div>
        )}
      </section>

      <div className='mt-8 grid gap-4 md:grid-cols-2'>
        <section className={card}>
          <h2 className='text-lg font-semibold text-white'>Board</h2>
          <ul className='mt-3 space-y-2'>
            {(overview?.boardMembers ?? []).map((member) => (
              <li key={member}>
                <a
                  href={`${explorerUrl}/accounts/${member}`}
                  target='_blank'
                  rel='noreferrer'
                  className='font-mono text-xs text-[#9AA0A6] hover:text-[#FF6E0A]'
                >
                  {shortAddress(member, 14, 10)}
                </a>
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
