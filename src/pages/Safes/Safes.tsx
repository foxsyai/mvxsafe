import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PRIMARY_TOKEN } from 'config/safes';
import { AddressLine } from 'components/Address';
import { Info, Tip } from 'components/Info';
import { RoleBadge, Role } from 'components/RoleBadge';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { clearCache } from 'multisig/network';
import { formatUsd, readCard, readUserRole, SafeCard, shortAddress } from 'multisig/reads';
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
    try {
      return JSON.parse(window.sessionStorage.getItem('mvxsafe.cards') ?? '{}');
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

  const isLoggedIn = useGetIsLoggedIn();
  const { address: connected } = useGetAccount();

  // One pass over the list: each safe's numbers and, when a wallet is connected,
  // what that wallet may do with it. Sequential on purpose, the public API
  // allows about two requests a second per visitor.
  const load = useCallback(
    async (list: KnownSafe[], connectedAddress: string) => {
      setLoading(true);
      setDone(0);

      // Three safes at a time. The queue underneath paces the individual
      // requests, so this only decides how many conversations run at once.
      const pending = [...list];
      const worker = async () => {
        for (;;) {
          const safe = pending.shift();
          if (!safe) return;
          try {
            const card = await readCard(safe.address);
            setCards((current) => {
              const next = { ...current, [safe.address]: card };
              try {
                window.sessionStorage.setItem('mvxsafe.cards', JSON.stringify(next));
              } catch {
                // A browser that refuses storage simply does not remember.
              }
              return next;
            });
            if (connectedAddress) {
              const role = (await readUserRole(safe.address, connectedAddress)) as Role;
              setRoles((current) => ({ ...current, [safe.address]: role }));
            }
          } catch {
            // A safe that cannot be read is shown without numbers rather than
            // breaking the page for the others.
          }
          setDone((count) => count + 1);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    load(safes, isLoggedIn ? connected : '');
  }, [safes, isLoggedIn, connected, load]);

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
            keep their own row and all three share one width. */}
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
        <div className='flex shrink-0 items-center gap-2'>
          <Tip text='Writes your list to a file: names and addresses only, nothing secret.'>
            <button
              type='button'
              onClick={handleExport}
              disabled={safes.length === 0}
              className='min-w-[9.5rem] rounded-lg border border-[#2A2A32] px-3 py-2 text-center text-sm text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white disabled:opacity-40'
            >
              Export
            </button>
          </Tip>
          <Tip text='Reads a list back, on another browser or another machine. Safes already here are left alone.'>
            <label className='min-w-[9.5rem] cursor-pointer rounded-lg border border-[#2A2A32] px-3 py-2 text-center text-sm text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'>
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
              className='min-w-[9.5rem] rounded-lg border border-[#2A2A32] px-3 py-2 text-center text-sm whitespace-nowrap text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'
            >
              {loading ? `Reading ${done} of ${safes.length}...` : 'Refresh'}
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
          const primary =
            card?.tokens.find((token) => token.identifier === PRIMARY_TOKEN) ??
            card?.tokens[0];

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
                  <RoleBadge role={roles[safe.address] ?? 'Unknown'} />
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
                    {card ? (card.quorum ? card.quorum : 'not a multisig') : '...'}
                  </dd>
                </div>
              </dl>

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
    </div>
  );
};
