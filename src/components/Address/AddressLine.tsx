import { MouseEvent, useEffect, useState } from 'react';
import { getLabel, readHerotag, setLabel } from 'multisig/addressBook';
import { explorerUrl } from 'multisig/network';
import { shortAddress } from 'multisig/reads';

// An address you can read, name, copy and open in the explorer.
//
// What is shown, in order: the name you gave it, the account's herotag if it has
// one, otherwise the shortened address. The full address is always what gets
// copied and always what the explorer link points at, so a name never hides
// what the thing really is.
interface AddressLineProps {
  address: string;
  /** Show the whole address rather than the shortened form. */
  short?: boolean;
  /** Offer the pencil that sets a name. Off where it would clutter. */
  nameable?: boolean;
  className?: string;
}

/** A smart contract address starts with eight zero bytes. */
const isContract = (address: string) => address.startsWith('erd1qqqqqqqqqqqq');

export const AddressLine = ({
  address,
  short = true,
  nameable = false,
  className = ''
}: AddressLineProps) => {
  const [copied, setCopied] = useState(false);
  const [label, setLocalLabel] = useState(() => getLabel(address));
  const [herotag, setHerotag] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // A name typed in one place should appear everywhere it is shown.
  useEffect(() => {
    const refresh = () => setLocalLabel(getLabel(address));
    window.addEventListener('mvxsafe:labels', refresh);
    return () => window.removeEventListener('mvxsafe:labels', refresh);
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    // Contracts, safes included, practically never have a herotag; asking for
    // every safe on the list only slowed it down.
    if (!label && !isContract(address)) {
      readHerotag(address).then((name) => {
        if (!cancelled) setHerotag(name);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [address, label]);

  const copy = async (event: MouseEvent) => {
    // The card around this is often a link. Copying is not opening it.
    event.stopPropagation();
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused, for example without https. The explorer link works.
    }
  };

  const save = () => {
    setLabel(address, draft);
    setLocalLabel(draft.trim().slice(0, 40));
    setEditing(false);
  };

  const shown = label || herotag || (short ? shortAddress(address, 10, 6) : address);

  if (editing) {
    return (
      <span
        className={`inline-flex items-center gap-2 ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') setEditing(false);
          }}
          placeholder='A name for this address'
          className='w-48 rounded border border-[#2A2A32] bg-[#0E0E12] px-2 py-1 text-xs text-white placeholder-[#4B5563]'
        />
        <button type='button' onClick={save} className='text-xs text-[#FF6E0A]'>
          save
        </button>
        <button
          type='button'
          onClick={() => setEditing(false)}
          className='text-xs text-[#6B7280] hover:text-white'
        >
          cancel
        </button>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <a
        href={`${explorerUrl}/accounts/${address}`}
        target='_blank'
        rel='noreferrer'
        onClick={(event) => event.stopPropagation()}
        title={address}
        className={
          label || herotag ? 'hover:text-[#FF6E0A]' : 'font-mono hover:text-[#FF6E0A]'
        }
      >
        {shown}
      </a>

      {herotag && !label && (
        <span className='rounded bg-[#2A2A32] px-1.5 py-0.5 text-[10px] text-[#9AA0A6]'>
          herotag
        </span>
      )}

      <button
        type='button'
        onClick={copy}
        title='Copy the full address'
        aria-label='Copy the full address'
        className='text-[#6B7280] hover:text-[#FF6E0A]'
      >
        {copied ? (
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' aria-hidden>
            <path
              d='M5 13l4 4L19 7'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        ) : (
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' aria-hidden>
            <rect
              x='9'
              y='9'
              width='11'
              height='11'
              rx='2'
              stroke='currentColor'
              strokeWidth='1.8'
            />
            <path
              d='M5 15V5a2 2 0 0 1 2-2h10'
              stroke='currentColor'
              strokeWidth='1.8'
              strokeLinecap='round'
            />
          </svg>
        )}
      </button>

      {nameable && (
        <button
          type='button'
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            setDraft(label);
            setEditing(true);
          }}
          title={label ? 'Change this name' : 'Give this address a name'}
          aria-label={label ? 'Change this name' : 'Give this address a name'}
          className='text-[#6B7280] hover:text-[#FF6E0A]'
        >
          <svg width='13' height='13' viewBox='0 0 24 24' fill='none' aria-hidden>
            <path
              d='M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z'
              stroke='currentColor'
              strokeWidth='1.8'
              strokeLinejoin='round'
            />
          </svg>
        </button>
      )}
    </span>
  );
};
