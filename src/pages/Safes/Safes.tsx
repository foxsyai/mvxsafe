import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AddressLine } from 'components/Address';
import { Info, Tip } from 'components/Info';
import { RoleBadge, Role } from 'components/RoleBadge';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { clearCache, forget } from 'multisig/network';
import { formatUsd, readCard, readUserRole, SafeCard, shortAddress,
  featuredToken
} from 'multisig/reads';
import {
  addSafe,
  exportSafes,
  getAllSafes,
  importSafes,
  isValidSafeAddress,
  removeSafe
} from 'multisig/savedSafes';
import { KnownSafe } from 'config/safes';

const panel =
  'rounded-xl border border-[#2A2A32] bg-[#121218] p-5 transition-colors hover:border-[#FF6E0A]/70';
// A safe you sit on the board of is outlined, so your own safes stand out in a
// list that may also hold ones you are only watching.
const panelMine = panel.replace('border-[#2A2A32]', 'border-[#FF6E0A]/50');

export const Safes = () => {
  const [safes, setSafes] = useState<KnownSafe[]>(getAllSafes());
  // The last numbers we saw, kept for this browser session only, so coming back
  // to the list shows something at once instead of seven rows of dots while the
  // API is asked again at two requests a second.
  const [cards, setCards] = useState<Record<string, SafeCard>>(() => {
    // Only cards that look like cards: storage can hold anything, and one with
    // no token list used to take the whole page down (web audit WEB-05).
    try {
      const stored = JSON.parse(window.sessionStorage.getItem('mvxsafe.cards') ?? '{}');
      const kept: Record<string, SafeCard> = {};
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [address, card] of Object.entries(stored as Record<string, any>)) {
          if (Array.isArray(card?.tokens) && typeof card?.egld === 'number') {
            // Balances may show at once from the last visit; what is pending and
            // for whom may not: a "needs you" from before a signature landed is
            // worse than "...", so those wait for a fresh read (7 Oct 2026).
            const {
              pendingCount: _pending,
              readyCount: _ready,
              needsViewer: _needs,
              actionCount: _actions,
              viewer: _viewer,
              ...balances
            } = card as SafeCard;
            kept[address] = balances as SafeCard;
          }
        }
      }
      return kept;
    } catch {
      return {};
    }
  });
  const [done, setDone] = useState(0);
  const navigate = useNavigate();
  const [newAddress, setNewAddress] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  // Safes whose last read was refused; they are being asked again.
  const [unread, setUnread] = useState<Set<string>>(new Set());

  const listAlive = useRef(true);
  useEffect(() => {
    listAlive.current = true;
    return () => {
      listAlive.current = false;
    };
  }, []);

  const isLoggedIn = useGetIsLoggedIn();
  const { address: connected } = useGetAccount();

  // One pass over the list: each safe's numbers and, when a wallet is connected,
  // what that wallet may do with it. Sequential on purpose, the public API
  // allows about two requests a second per visitor.
  // One safe: its role first (one request, it decides the badge and the
  // highlight), then its card. Errors leave that safe without numbers rather
  // than breaking the page for the others.
  const readOne = useCallback(async (safe: KnownSafe, connectedAddress: string): Promise<boolean> => {
    if (connectedAddress) {
      try {
        const role = (await readUserRole(safe.address, connectedAddress)) as Role;
        setRoles((current) => ({ ...current, [safe.address]: role }));
      } catch {
        // No role shown is the honest answer when it could not be read.
      }
    }
    try {
      const card = await readCard(safe.address, connectedAddress);
      setCards((current) => {
        const next = { ...current, [safe.address]: card };
        try {
          window.sessionStorage.setItem('mvxsafe.cards', JSON.stringify(next));
        } catch {
          // A browser that refuses storage simply does not remember.
        }
        return next;
      });
      setUnread((current) => {
        if (!current.has(safe.address)) return current;
        const next = new Set(current);
        next.delete(safe.address);
        return next;
      });
      return true;
    } catch {
      // Refused or lost: marked, and asked again by itself (see retryLater).
      setUnread((current) => new Set(current).add(safe.address));
      return false;
    }
  }, []);

  // Cards whose read was refused are read again by themselves, 5 s, 10 s,
  // then every 30 s, for as long as the list is open: two cards used to stay
  // on "..." for good after a slow moment of the API (7 Oct 2026).
  const retryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => retryTimers.current.forEach(clearTimeout), []);

  // Every pass over the list has a number, and only the newest one counts.
  // Pressing Refresh while the list was reading used to leave the older pass
  // running: its reads went on counting toward "N of 7" (up to "12 of 7") and
  // its end switched the button back to Refresh while the new pass still read
  // (10 Oct 2026).
  const round = useRef(0);

  const retryLater = useCallback(
    (failed: KnownSafe[], connectedAddress: string, attempt: number) => {
      const delay = Math.min(30000, 5000 * Math.pow(2, attempt));
      const mine = round.current;
      retryTimers.current.push(
        setTimeout(async () => {
          const still: KnownSafe[] = [];
          for (const safe of failed) {
            if (!listAlive.current || round.current !== mine) return;
            if (!(await readOne(safe, connectedAddress))) still.push(safe);
          }
          if (still.length > 0 && listAlive.current && round.current === mine) {
            retryLater(still, connectedAddress, attempt + 1);
          }
        }, delay)
      );
    },
    [readOne]
  );

  const load = useCallback(
    async (list: KnownSafe[], connectedAddress: string) => {
      const mine = ++round.current;
      // This pass reads every safe, so the retries an older pass left behind go.
      retryTimers.current.forEach(clearTimeout);
      retryTimers.current = [];
      setLoading(true);
      setDone(0);
      // Roles belong to one wallet: none survive a disconnect, a new wallet or
      // a safe that cannot be read this time (web audit WEB-02).
      setRoles({});

      // Three safes at a time. The queue underneath paces the individual
      // requests, so this only decides how many conversations run at once.
      const pending = [...list];
      const failed: KnownSafe[] = [];
      const worker = async () => {
        for (;;) {
          // Left the list, or a newer pass started: stop, so nothing queues
          // behind it and nothing counts twice.
          if (!listAlive.current || round.current !== mine) return;
          const safe = pending.shift();
          if (!safe) return;
          const read = await readOne(safe, connectedAddress);
          if (round.current !== mine) return;
          if (!read) failed.push(safe);
          setDone((count) => count + 1);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (round.current !== mine) return;
      setLoading(false);
      if (failed.length > 0 && listAlive.current) retryLater(failed, connectedAddress, 0);
    },
    [readOne, retryLater]
  );

  useEffect(() => {
    load(safes, isLoggedIn ? connected : '');
  }, [safes, isLoggedIn, connected, load]);

  // A transaction sent from any page lands seconds later. The list reads
  // again when it has, instead of showing a count from before it landed.
  useEffect(() => {
    // Only the safes the transaction touched are read again; the others keep
    // their cached answers and their cards as they are.
    const again = (event: Event) => {
      const touched: string[] = (event as CustomEvent).detail?.addresses ?? [];
      for (const safe of safes.filter((candidate) => touched.includes(candidate.address))) {
        forget(safe.address);
        readOne(safe, isLoggedIn ? connected : '');
      }
    };
    window.addEventListener('mvxsafe:settled', again);
    return () => window.removeEventListener('mvxsafe:settled', again);
  }, [safes, isLoggedIn, connected, readOne]);

  const handleAdd = () => {
    const address = newAddress.trim();
    if (!isValidSafeAddress(address)) {
      setError('That does not look like a MultiversX address.');
      return;
    }
    addSafe({ name: newName.trim() || 'Safe', address });
    setNewAddress('');
    setNewName('');
    setError('');
    setSafes(getAllSafes());
  };

  const handleRemove = (address: string) => {
    removeSafe(address);
    setSafes(getAllSafes());
  };

  const handleExport = () => {
    const blob = new Blob([exportSafes()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mvxsafe-safes.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    try {
      const { added, skipped } = importSafes(await file.text());
      setSafes(getAllSafes());
      setError(
        added === 0 && skipped === 0
          ? 'That file held nothing to add.'
          : `Added ${added}${skipped ? `, skipped ${skipped} already here or invalid` : ''}.`
      );
    } catch (failure: any) {
      setError(failure?.message ?? 'That file could not be read.');
    }
  };

  const handleRefresh = () => {
    clearCache();
    setCards({});
    setRoles({});
    load(safes, isLoggedIn ? connected : '');
  };

  return (
    <div className='mx-auto w-full max-w-5xl px-4 py-10'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        {/* The intro runs the full width of the cards underneath; the buttons
            keep their own row and all three share one width. On a phone they
            split the row in three equal columns, so the page never scrolls
            sideways (it did while "Reading 5 of 7..." was showing). */}
        <div className='min-w-[18rem] flex-1'>
          <p className='text-xs font-semibold tracking-[0.25em] text-[#FF6E0A]'>
            MULTIVERSX MULTISIG
          </p>
          <h1 className='mt-2 text-3xl font-semibold text-white'>Safes</h1>
          <p className='mt-1 text-sm text-[#9AA0A6]'>
            Add any MultiversX multisig to watch it. Connect your wallet and the ones
            you sit on the board of become yours to act on.
          </p>
        </div>
        <div className='grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center'>
          <Tip text='Writes your list to a file: names and addresses only, nothing secret.'>
            <button
              type='button'
              onClick={handleExport}
              disabled={safes.length === 0}
              className='w-full rounded-lg border border-[#2A2A32] px-3 py-2 text-center text-sm text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white disabled:opacity-40 sm:w-auto sm:min-w-[9.5rem]'
            >
              Export
            </button>
          </Tip>
          <Tip text='Reads a list back, on another browser or another machine. Safes already here are left alone.'>
            <label className='w-full cursor-pointer rounded-lg border border-[#2A2A32] px-3 py-2 text-center text-sm text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white sm:w-auto sm:min-w-[9.5rem]'>
              Import
              <input
                type='file'
                accept='application/json,.json'
                className='hidden'
                onChange={(event) => handleImport(event.target.files?.[0])}
              />
            </label>
          </Tip>
          <Tip text='Reads every safe from the chain again, ignoring what was remembered.'>
            <button
              type='button'
              onClick={handleRefresh}
              aria-label={loading ? `Reading ${done} of ${safes.length} safes` : undefined}
              className='w-full rounded-lg border border-[#2A2A32] px-3 py-2 text-center text-sm whitespace-nowrap text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white sm:w-auto sm:min-w-[9.5rem]'
            >
              {loading ? (
                <>
                  <span className='hidden sm:inline'>Reading </span>
                  {done} of {safes.length}...
                </>
              ) : (
                'Refresh'
              )}
            </button>
          </Tip>
        </div>
      </div>

      {safes.length === 0 && (
        <div className='mt-6 rounded-xl border border-dashed border-[#2A2A32] bg-[#121218] p-8 text-center'>
          <p className='text-white'>No safes yet.</p>
          <p className='mx-auto mt-2 max-w-md text-sm text-[#6B7280]'>
            Add a multisig contract address below and it appears here, stored in this
            browser only. Nothing is sent anywhere and no account is needed.
          </p>
        </div>
      )}

      <div className='mt-8 grid gap-4 sm:grid-cols-2'>
        {safes.map((safe) => {
          const card = cards[safe.address];
          const primary = card ? featuredToken(card.tokens) : undefined;

          return (
            <div
              key={safe.address}
              role='link'
              tabIndex={0}
              onClick={() => navigate(`/safe/${safe.address}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(`/safe/${safe.address}`);
                }
              }}
              className={`relative cursor-pointer ${
                roles[safe.address] === 'BoardMember' || roles[safe.address] === 'Proposer'
                  ? panelMine
                  : panel
              }`}
            >
              <div>
                <h2 className='pr-7 text-lg font-semibold text-white'>{safe.name}</h2>

                {/* The badge sits on the address line, hard against the right
                    edge, so the X can live in the corner without pushing it out
                    of alignment. */}
                <div className='mt-1 flex flex-wrap items-center justify-between gap-2'>
                  <AddressLine address={safe.address} className='text-xs text-[#6B7280]' />
                  <RoleBadge role={isLoggedIn ? (roles[safe.address] ?? 'Unknown') : 'None'} />
                </div>

                {/* Top right, like closing a window. */}
                <button
                  type='button'
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemove(safe.address);
                  }}
                  title='Take this safe out of your list. The safe itself is untouched.'
                  aria-label='Remove this safe from the list'
                  className='absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded text-[#6B7280] hover:bg-[#FF6E0A]/10 hover:text-[#FF6E0A]'
                >
                  <svg width='13' height='13' viewBox='0 0 24 24' fill='none' aria-hidden>
                    <path
                      d='M6 6l12 12M18 6L6 18'
                      stroke='currentColor'
                      strokeWidth='2.2'
                      strokeLinecap='round'
                    />
                  </svg>
                </button>
              </div>

              <dl className='mt-4 flex items-start justify-between gap-6 text-sm'>
                <div>
                  <dt className='text-xs text-[#6B7280]'>
                    {primary ? primary.ticker : 'EGLD'}
                  </dt>
                  <dd className='mt-1 text-white'>
                    {card
                      ? primary
                        ? primary.amount.toLocaleString('en-US', {
                            maximumFractionDigits: 0
                          })
                        : card.egld.toFixed(2)
                      : '...'}
                    {primary?.valueUsd ? (
                      <span className='ml-1.5 text-xs text-[#6B7280]'>
                        {formatUsd(primary.valueUsd)}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className='text-right'>
                  <dt className='text-xs text-[#6B7280]'>Signatures needed</dt>
                  <dd className='mt-1 text-white'>
                    {card
                      ? card.quorum
                        ? card.boardSize
                          ? `${card.quorum} of ${card.boardSize}`
                          : card.quorum
                        : 'not a multisig'
                      : '...'}
                  </dd>
                </div>
              </dl>

              {unread.has(safe.address) && (
                <p className='mt-3 text-xs text-[#FBBF24]'>Not read yet, trying again...</p>
              )}

              {/* What is waiting, and for whom: at a glance, without opening the safe. */}
              {card?.quorum ? (
                <dl className='mt-3 flex items-start justify-between gap-6 border-t border-[#2A2A32] pt-3 text-sm'>
                  <div>
                    <dt className='text-xs text-[#6B7280]'>Pending actions</dt>
                    <dd className='mt-1 flex flex-wrap items-baseline gap-x-2'>
                      {/* Orange while something still needs signatures, green when
                          all that is pending only waits to be carried out. */}
                      <span
                        className={
                          (card.pendingCount ?? 0) > (card.readyCount ?? 0)
                            ? 'font-semibold text-[#FF6E0A]'
                            : (card.pendingCount ?? 0) > 0
                              ? 'font-semibold text-[#4ADE80]'
                              : 'text-white'
                        }
                      >
                        {card.pendingCount ?? '...'}
                      </span>
                      {card.viewer === connected &&
                        isLoggedIn &&
                        (card.needsViewer ?? 0) > 0 && (
                          <span className='text-xs text-[#FF6E0A]'>
                            {card.needsViewer} need{card.needsViewer === 1 ? 's' : ''} you
                          </span>
                        )}
                      {(card.readyCount ?? 0) > 0 && (
                        <span className='text-xs text-[#4ADE80]'>
                          {card.readyCount} ready to carry out
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className='text-right'>
                    <dt className='text-xs text-[#6B7280]'>Proposed so far</dt>
                    <dd className='mt-1 text-white'>{card.actionCount ?? '...'}</dd>
                  </div>
                </dl>
              ) : null}

            </div>
          );
        })}
      </div>

      <div className='mt-10 rounded-xl border border-[#2A2A32] bg-[#121218] p-5'>
        <h2 className='flex items-center text-sm font-semibold text-white'>
          Add a safe
          <Info text='The contract address of a multisig, starting with erd1qqq. Adding it only puts it in your list, it gives you no rights over it.' />
        </h2>
        <p className='mt-1 text-xs text-[#6B7280]'>
          Any MultiversX multisig address. It is kept in this browser only.
        </p>
        <div className='mt-4 flex flex-col gap-3 sm:flex-row'>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder='Name'
            className='w-full rounded-lg border border-[#2A2A32] bg-[#0E0E12] px-3 py-2 text-sm text-white placeholder-[#4B5563] sm:w-48'
          />
          <input
            value={newAddress}
            onChange={(event) => setNewAddress(event.target.value)}
            placeholder='erd1...'
            className='w-full flex-1 rounded-lg border border-[#2A2A32] bg-[#0E0E12] px-3 py-2 font-mono text-sm text-white placeholder-[#4B5563]'
          />
          <Tip text='Puts this safe in your list. Watching costs nothing and gives you no rights over it.'>
            <button
              type='button'
              onClick={handleAdd}
              className='rounded-lg bg-[#FF6E0A] px-5 py-2 text-sm font-semibold text-black hover:bg-[#ff8534]'
            >
              Add
            </button>
          </Tip>
        </div>
        {error && <p className='mt-2 text-xs text-[#F87171]'>{error}</p>}
      </div>

      <div className='mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#2A2A32] bg-[#121218] p-5'>
        <div>
          <h2 className='text-sm font-semibold text-white'>Create a new safe</h2>
          <p className='mt-1 text-xs text-[#6B7280]'>
            Choose the board and how many signatures it needs.
          </p>
        </div>
        <Link
          to='/create'
          className='rounded-lg border border-[#FF6E0A] px-5 py-2 text-sm font-semibold text-[#FF6E0A] hover:bg-[#FF6E0A] hover:text-black'
        >
          Create a safe
        </Link>
      </div>
    </div>
  );
};
