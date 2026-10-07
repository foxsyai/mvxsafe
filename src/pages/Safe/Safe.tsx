import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AddressLine } from 'components/Address';
import { Info, Tip } from 'components/Info';
import { ProposePanel } from 'components/Propose';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import {
  discardAction,
  handOverSafe,
  performAction,
  signAction,
  unsignAction
} from 'multisig/actions';
import { clearCache, explorerUrl, forget } from 'multisig/network';
import { explainWalletFailure } from 'multisig/walletFailure';
import {
  ContractInfo,
  formatUsd,
  HistoryEntry,
  PendingAction,
  readHistory,
  readOverview,
  readContractInfo,
  readPendingActions,
  readUserRole,
  SafeOverview,
  shortAddress,
  featuredToken
} from 'multisig/reads';
import { isValidSafeAddress, nameFor } from 'multisig/savedSafes';

const card = 'rounded-xl border border-[#2A2A32] bg-[#121218] p-5';
const label = 'text-xs text-[#6B7280]';

/**
 * The route. It refuses anything that is not an address before touching the
 * network (/safe/__proto__ used to unmount the whole app, web audit WEB-03),
 * and gives every safe its own instance of the page: kept as one instance, a
 * Treasury -> Team change showed Treasury's actions under Team's title, and
 * Sign then sent Treasury's action id to the Team safe (WEB-01). The key
 * throws away the old state, its pending reads and its timers.
 */
export const Safe = () => {
  const { address = '' } = useParams();
  if (!isValidSafeAddress(address)) {
    return (
      <div className='mx-auto w-full max-w-5xl px-4 py-10'>
        <Link to='/' className='text-sm text-[#9AA0A6] hover:text-[#FF6E0A]'>
          &larr; All safes
        </Link>
        <p className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          That is not a MultiversX address, so there is no safe to show.
        </p>
      </div>
    );
  }
  return <SafeView key={address} address={address} />;
};

const SafeView = ({ address }: { address: string }) => {
  const [overview, setOverview] = useState<SafeOverview | null>(null);
  // Null when the pending actions could not be read, which is NOT the same as none.
  const [pending, setPending] = useState<PendingAction[] | null>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Null while unknown: nobody is told they are not on a board before it was checked.
  const [role, setRole] = useState<string | null>(null);
  const [working, setWorking] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [problem, setProblem] = useState('');
  const [contract, setContract] = useState<ContractInfo | null>(null);
  const [handingOver, setHandingOver] = useState(false);
  // True while the propose form waits for the wallet.
  const [proposing, setProposing] = useState(false);
  // True when the last read was refused and the page shows the one before.
  const [stale, setStale] = useState(false);

  // Set by the create page: the deploy was just sent, so for a little while an
  // address that cannot be read yet is expected, not a failure.
  const creating = Boolean((useLocation().state as { creating?: boolean } | null)?.creating);
  const [waitedFor, setWaitedFor] = useState(0);

  const isLoggedIn = useGetIsLoggedIn();
  const account = useGetAccount();
  const signer = { address: account.address, nonce: Number(account.nonce ?? 0) };
  const canPropose = role === 'BoardMember' || role === 'Proposer';
  const canSign = role === 'BoardMember';

  // False once this view is gone: a read that finishes later changes nothing.
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    },
    []
  );

  // Each part is read on its own, and a part the network refused keeps what
  // was read before: a failed refresh used to replace a safe with "unknown",
  // "No board members found" and "not on this board" (7 Oct 2026). Only a
  // first read that fails is shown as a failure. While anything is out of
  // date, nothing can be signed or carried out.
  const readBefore = useRef({ overview: false, pending: false });
  const load = useCallback(async () => {
    if (!alive.current) return;
    setLoading(true);
    let fresh = true;
    readContractInfo(address)
      .then(setContract)
      .catch(() => undefined);
    try {
      setOverview(await readOverview(address));
      readBefore.current.overview = true;
      setFailed(false);
    } catch {
      fresh = false;
      if (!readBefore.current.overview) setFailed(true);
    }
    try {
      setPending(await readPendingActions(address));
      readBefore.current.pending = true;
    } catch {
      fresh = false;
      if (!readBefore.current.pending) setPending(null);
    }
    try {
      setHistory(await readHistory(address));
    } catch {
      fresh = false;
    }
    try {
      setRole(isLoggedIn ? await readUserRole(address, account.address) : 'None');
    } catch {
      fresh = false;
    }
    if (alive.current) {
      setStale(!fresh && (readBefore.current.overview || readBefore.current.pending));
      setLoading(false);
    }
  }, [address, isLoggedIn, account.address]);

  // A different safe or a different wallet: what was known about the role no
  // longer applies until it has been read again.
  useEffect(() => {
    setRole(null);
  }, [address, isLoggedIn, account.address]);

  // Every one of these ends in the visitor's wallet asking them to confirm.
  // Whatever goes wrong is shown: this used to swallow failures, so a signed
  // transaction that the node refused looked exactly like nothing happening.
  const run = async (actionId: number, work: () => Promise<unknown>) => {
    // One wallet prompt at a time: every action button is disabled while this
    // runs, or a second transaction could be built on the same nonce (WEB-08).
    if (working !== 0 || proposing) return;
    setWorking(actionId);
    setProblem('');
    try {
      await work();
    } catch (failure: unknown) {
      setProblem(explainWalletFailure(failure, 'That'));
    }
    // Success or not, read the chain again: a send whose answer was lost may
    // have gone through, and only the chain can say (WEB-07).
    setWorking(0);
    forget(address);
    await load();
    readAgainShortly();
  };

  // A wallet that never answers, an xPortal request dismissed on the phone for
  // example, would leave the buttons disabled until the page is reloaded.
  useEffect(() => {
    if (!working) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), 25000);
    return () => clearTimeout(timer);
  }, [working]);

  useEffect(() => {
    load();
  }, [load]);

  // A safe that was just created takes a few seconds to exist. Keep reading for
  // up to two minutes instead of declaring it unreadable.
  useEffect(() => {
    if (!creating || !failed || waitedFor >= 40) return;
    const timer = setTimeout(() => {
      setWaitedFor((count) => count + 1);
      forget(address);
      load();
    }, 3000);
    return () => clearTimeout(timer);
  }, [creating, failed, waitedFor, load]);

  const ownsItself = !contract?.exists || contract.ownerAddress === address;
  const youOwnIt = isLoggedIn && contract?.ownerAddress === account.address;

  const handOver = async () => {
    if (working !== 0 || proposing) return;
    setHandingOver(true);
    setProblem('');
    try {
      await handOverSafe(signer, address);
    } catch (failure: unknown) {
      setProblem(explainWalletFailure(failure, 'The handover'));
    }
    setHandingOver(false);
    readAgainShortly();
  };

  // A transaction sent from this page lands seconds after the wallet returns, so
  // the page reads everything again at that moment rather than waiting for the
  // visitor to press Refresh.
  useEffect(() => {
    const again = (event: Event) => {
      const touched: string[] | undefined = (event as CustomEvent).detail?.addresses;
      if (touched && !touched.includes(address)) return;
      forget(address);
      load();
    };
    window.addEventListener('mvxsafe:settled', again);
    return () => window.removeEventListener('mvxsafe:settled', again);
  }, [load]);

  // The event above comes from a socket the SDK opens, which a strict content
  // policy can block, ours did. So the page also reads again a few times after
  // anything is sent, and then it no longer depends on that socket at all.
  const readAgainShortly = useCallback(() => {
    [4000, 10000, 20000].forEach((delay) =>
      timers.current.push(
        setTimeout(() => {
          forget(address);
          load();
        }, delay)
      )
    );
  }, [load]);

  const title = nameFor(address) || 'Safe';
  const tokens = overview?.tokens ?? [];
  const primary = featuredToken(tokens);
  const others = tokens.filter((token) => token !== primary);
  const sharedTickers = new Set(
    tokens
      .map((token) => token.ticker)
      .filter((ticker, at, all) => all.indexOf(ticker) !== at)
  );

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
                {role === null
                  ? 'being checked against this board'
                  : role === 'BoardMember'
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

      {failed &&
        (creating && waitedFor < 40 ? (
          <p className='mt-6 rounded-lg border border-[#2A2A32] bg-[#121218] p-4 text-sm text-[#9AA0A6]'>
            Being created. The network needs a few seconds to run the two transactions; this page
            fills in by itself as soon as the safe exists.
          </p>
        ) : (
          <p className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
            This address could not be read from the network.
          </p>
        ))}

      {!ownsItself && (
        <div className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          <p>
            This safe is not in its own hands. Its owner can replace the contract's code alone,
            without the board:
          </p>
          <AddressLine address={contract?.ownerAddress ?? ''} short={false} className='mt-2 text-xs' />
          {youOwnIt ? (
            <div className='mt-3 flex flex-wrap items-center gap-3'>
              <button
                type='button'
                disabled={handingOver}
                onClick={handOver}
                className='rounded-lg bg-[#FF6E0A] px-4 py-2 text-xs font-semibold text-black hover:bg-[#ff8534] disabled:opacity-50'
              >
                {handingOver ? 'Waiting for your wallet...' : 'Hand it to itself now'}
              </button>
              <span className='text-xs text-[#F87171]/80'>
                That owner is you. One transaction makes the safe its own owner, after which only
                the board, by quorum, can change it.
              </span>
            </div>
          ) : (
            <p className='mt-2 text-xs text-[#F87171]/80'>
              Ask that owner to hand the safe to itself before trusting it with funds.
            </p>
          )}
        </div>
      )}

      {problem && (
        <p className='mt-6 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
          {problem}
        </p>
      )}

      {stale && !failed && (
        <p className='mt-6 rounded-lg border border-[#FBBF24]/30 bg-[#FBBF24]/5 p-4 text-sm text-[#FBBF24]'>
          The network did not answer just now, so this is what was read a moment ago. It
          updates by itself; nothing can be signed or carried out until it does.
        </p>
      )}

      {working > 0 && stuck && (
        <p className='mt-6 rounded-lg border border-[#2A2A32] bg-[#121218] p-4 text-sm text-[#9AA0A6]'>
          Your wallet has not answered. If you dismissed the request,{' '}
          <button
            type='button'
            onClick={() => setWorking(0)}
            className='text-[#FF6E0A] hover:underline'
          >
            start over
          </button>
          . If you did sign it, it is on its way and this page will show it by itself.
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
            {primary?.valueUsd ? (
              <span className='ml-2 text-sm font-normal text-[#6B7280]'>
                {formatUsd(primary.valueUsd)}
              </span>
            ) : null}
          </p>
          {/* No subtotal here: the holdings card below already lists EGLD and
              the total, and repeating it made the tile say the same thing twice. */}
        </div>
        <div className={card}>
          <p className={label + ' flex items-center'}>
            Actions
            <Info text='Waiting for signatures right now. The number underneath counts every action ever proposed, carried out or discarded.' />
          </p>
          <p className='mt-1 text-2xl font-semibold text-white'>
            {overview ? (overview.pendingCount ?? '?') : '...'}
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
        {pending === null ? (
          <p className='mt-3 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-4 text-sm text-[#F87171]'>
            The actions waiting for a signature could not be read. Refresh before signing
            anything.
          </p>
        ) : pending.length === 0 ? (
          <p className='mt-3 text-sm text-[#6B7280]'>
            {loading ? 'Loading...' : 'Nothing is waiting for a signature.'}
          </p>
        ) : (
          <div className='mt-3 space-y-3'>
            {pending.map((action) => (
              <div key={action.actionId} className={card}>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  {/* Full addresses and identifiers make this long; it wraps
                      anywhere rather than hiding the part that matters. */}
                  <p className='min-w-0 flex-1 text-white [overflow-wrap:anywhere]'>
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
                  <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6B7280]'>
                    <span>signed by</span>
                    {action.signers.map((who) => (
                      <AddressLine key={who} address={who} className='text-xs text-[#6B7280]' />
                    ))}
                  </div>
                )}
                {action.formerSigners.length > 0 && (
                  <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6B7280]'>
                    <span>also signed, but has left the board and does not count:</span>
                    {action.formerSigners.map((who) => (
                      <AddressLine key={who} address={who} className='text-xs text-[#6B7280] line-through' />
                    ))}
                  </div>
                )}

                {isLoggedIn && (canSign || canPropose) && (
                  <div className='mt-3 flex flex-wrap items-center gap-2'>
                    {canSign &&
                      (action.signers.includes(account.address) ? (
                        <Tip text='Takes your approval back. Possible for as long as the action is still waiting.'><button
                          type='button'
                          disabled={working !== 0 || proposing || stale}
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
                          disabled={working !== 0 || proposing || stale}
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
                        disabled={working !== 0 || proposing || stale}
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

                    <Tip
                      text={
                        action.signerCount > 0
                          ? 'Cannot be discarded while it carries signatures. The contract refuses it. Everyone who signed has to remove their signature first.'
                          : 'Throws the action away without doing it. Nothing moves and nothing is spent.'
                      }
                    >
                      <button
                        type='button'
                        disabled={working !== 0 || proposing || stale || action.signerCount > 0}
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
          egldBalance={overview.egldRaw}
          boardSize={overview.boardMembers.length}
          disabled={working !== 0 || stale}
          onBusyChange={setProposing}
          onProposed={() => {
            forget(address);
            load();
            readAgainShortly();
          }}
        />
      )}

      <div className='mt-8 grid gap-4 md:grid-cols-2'>
        <section className={card}>
          <h2 className='flex items-center text-lg font-semibold text-white'>
            Board
            <Info text='The addresses that may sign. A proposer, if there is one, can suggest actions but not approve them. The pencil gives an address a name, kept in this browser and carried in the export file.' />
          </h2>
          <ul className='mt-3 space-y-2'>
            {(overview?.boardMembers ?? []).map((member) => (
              <li key={member} className='flex items-center justify-between gap-2'>
                <AddressLine address={member} nameable className='text-xs text-[#9AA0A6]' />
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
          <h2 className='flex items-center text-lg font-semibold text-white'>
            Holdings
            <Info text='Dollar values come from the same MultiversX API as the balances, and only exist for tokens that have a market price.' />
          </h2>
          <ul className='mt-3 space-y-2 text-sm'>
            <li className='flex justify-between'>
              <span className='text-[#9AA0A6]'>EGLD</span>
              <span className='text-white'>
                {(overview?.egld ?? 0).toFixed(4)}
                {overview?.egldPrice && overview.egld > 0 ? (
                  <span className='ml-2 text-xs text-[#6B7280]'>
                    {formatUsd(overview.egld * overview.egldPrice)}
                  </span>
                ) : null}
              </span>
            </li>
            {[primary, ...others].filter(Boolean).map((token: any) => (
              <li key={token.identifier} className='flex justify-between'>
                {/* Two tokens can share a ticker; then only the identifier tells them apart. */}
                <span className='text-[#9AA0A6]'>
                  {sharedTickers.has(token.ticker) ? token.identifier : token.ticker}
                </span>
                <span className='text-white'>
                  {token.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  {token.valueUsd ? (
                    <span className='ml-2 text-xs text-[#6B7280]'>
                      {formatUsd(token.valueUsd)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
            {overview && overview.worthUsd > 0 && (
              <li className='flex justify-between border-t border-[#2A2A32] pt-2'>
                <span className='text-[#9AA0A6]'>Total</span>
                <span className='text-white'>{formatUsd(overview.worthUsd)}</span>
              </li>
            )}
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
