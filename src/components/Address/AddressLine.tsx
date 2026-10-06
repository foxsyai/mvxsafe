import { MouseEvent, useState } from 'react';
import { explorerUrl } from 'multisig/network';
import { shortAddress } from 'multisig/reads';

// An address you can read, copy and open in the explorer. Shown shortened,
// copied in full: nobody checks an address by reading the middle of it, but
// everybody needs the whole thing to paste somewhere.
interface AddressLineProps {
  address: string;
  short?: boolean;
  className?: string;
}

export const AddressLine = ({ address, short = true, className = '' }: AddressLineProps) => {
  const [copied, setCopied] = useState(false);

  const copy = async (event: MouseEvent) => {
    // The card around this is a link. Copying is not opening it.
    event.stopPropagation();
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused, for example without https. The explorer link still works.
    }
  };

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <a
        href={`${explorerUrl}/accounts/${address}`}
        target='_blank'
        rel='noreferrer'
        onClick={(event) => event.stopPropagation()}
        title='Open in the MultiversX explorer'
        className='font-mono hover:text-[#FF6E0A]'
      >
        {short ? shortAddress(address, 10, 6) : address}
      </a>
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
    </span>
  );
};
