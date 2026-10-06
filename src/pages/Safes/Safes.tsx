import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PRIMARY_TOKEN } from 'config/safes';
import { RoleBadge, Role } from 'components/RoleBadge';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { readUserRole } from 'multisig/reads';
import { clearCache } from 'multisig/network';
import { formatAmount, readOverview, shortAddress, SafeOverview } from 'multisig/reads';
import {
  addSafe,
  getAllSafes,
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
  const [overviews, setOverviews] = useState<Record<string, SafeOverview>>({});
  const [newAddress, setNewAddress] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Record<string, Role>>({});

  const isLoggedIn = useGetIsLoggedIn();
  const { address: connected } = useGetAccount();

  const load = useCallback(async (list: KnownSafe[]) => {
    setLoading(true);
    // One after another on purpose: the public API allows about two requests a
    // second per visitor, and a burst of seven safes would be throttled.
    for (const safe of list) {
      try {
        const overview = await readOverview(safe.address);
        setOverviews((current) => ({ ...current, [safe.address]: overview }));
      } catch {
        // A safe that cannot be read is shown without numbers rather than
        // breaking the page for the others.
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load(safes);
  }, [safes, load]);

  // Safes are the ones you added: a wallet that was added to a board but has
  // never touched it leaves no trace on chain, so there is nothing to discover
  // (Sebastian, 6 Oct 2026). Connecting does not change the list, it changes
  // what you may do with each entry, which is what the badge shows.
  useEffect(() => {
    if (!isLoggedIn || !connected) {
      setRoles({});
      return;
    }
    let cancelled = false;
    (async () => {
      for (const safe of safes) {
        const role = (await readUserRole(safe.address, connected)) as Role;
        if (cancelled) return;
        setRoles((current) => ({ ...current, [safe.address]: role }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, connected, safes]);

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

  const handleRefresh = () => {
    clearCache();
    setOverviews({});
    load(safes);
  };

  return (
    <div className='mx-auto w-full max-w-5xl px-4 py-10'>
      <div className='flex items-end justify-between gap-4'>
        <div>
          <p className='text-xs font-semibold tracking-[0.25em] text-[#FF6E0A]'>
            MULTIVERSX MULTISIG
          </p>
          <h1 className='mt-2 text-3xl font-semibold text-white'>Safes</h1>
          <p className='mt-1 text-sm text-[#9AA0A6]'>
            Add any MultiversX multisig to watch it. Connect your wallet and the ones
            you sit on the board of become yours to act on.
          </p>
        </div>
        <button
          type='button'
          onClick={handleRefresh}
          className='rounded-lg border border-[#2A2A32] px-4 py-2 text-sm text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
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
          const overview = overviews[safe.address];
          const primary = overview?.tokens.find(
            (token) => token.identifier === PRIMARY_TOKEN
          );

          return (
            <div
              key={safe.address}
              className={
                roles[safe.address] === 'BoardMember' || roles[safe.address] === 'Proposer'
                  ? panelMine
                  : panel
              }
            >
              <div className='flex items-start justify-between gap-3'>
                <Link to={`/safe/${safe.address}`} className='group'>
                  <h2 className='text-lg font-semibold text-white group-hover:text-[#FF6E0A]'>
                    {safe.name}
                  </h2>
                  <p className='mt-1 font-mono text-xs text-[#6B7280]'>
                    {shortAddress(safe.address, 12, 8)}
                  </p>
                </Link>
                <div className='flex flex-col items-end gap-2'>
                  <RoleBadge role={roles[safe.address] ?? 'Unknown'} />
                  <button
                    type='button'
                    onClick={() => handleRemove(safe.address)}
                    className='text-xs text-[#6B7280] hover:text-[#FF6E0A]'
                  >
                    remove
                  </button>
                </div>
              </div>

              <dl className='mt-4 grid grid-cols-3 gap-3 text-sm'>
                <div>
                  <dt className='text-xs text-[#6B7280]'>
                    {primary ? primary.ticker : 'Tokens'}
                  </dt>
                  <dd className='mt-1 text-white'>
                    {overview
                      ? primary
                        ? primary.amount.toLocaleString('en-US', {
                            maximumFractionDigits: 0
                          })
                        : overview.tokens.length
                      : '...'}
                  </dd>
                </div>
                <div>
                  <dt className='text-xs text-[#6B7280]'>Quorum</dt>
                  <dd className='mt-1 text-white'>
                    {overview?.quorum
                      ? `${overview.quorum} of ${overview.boardMembers.length}`
                      : overview
                        ? 'not a safe'
                        : '...'}
                  </dd>
                </div>
                <div>
                  <dt className='text-xs text-[#6B7280]'>Pending</dt>
                  <dd className='mt-1 text-white'>
                    {overview ? overview.pendingCount : '...'}
                  </dd>
                </div>
              </dl>

              <Link
                to={`/safe/${safe.address}`}
                className='mt-4 inline-block text-sm text-[#FF6E0A] hover:underline'
              >
                Open
              </Link>
            </div>
          );
        })}
      </div>

      <div className='mt-10 rounded-xl border border-[#2A2A32] bg-[#121218] p-5'>
        <h2 className='text-sm font-semibold text-white'>Add a safe</h2>
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
          <button
            type='button'
            onClick={handleAdd}
            className='rounded-lg bg-[#FF6E0A] px-5 py-2 text-sm font-semibold text-black hover:bg-[#ff8534]'
          >
            Add
          </button>
        </div>
        {error && <p className='mt-2 text-xs text-[#F87171]'>{error}</p>}
      </div>
    </div>
  );
};
