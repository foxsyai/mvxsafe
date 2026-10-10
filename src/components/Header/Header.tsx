import { Link } from 'react-router-dom';
import { networkName } from 'multisig/network';
import { ConnectButton } from '../ConnectButton';
import { Logo } from '../Logo';

export const Header = () => (
  <header className='border-b border-[#1F1F27] bg-[#0E0E12]'>
    <div className='mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4'>
      <Link to='/'>
        <Logo />
      </Link>
      {/* Tighter on a phone, and the link never wraps: connected, the header
          used to push "How it works" onto two lines against the logo. */}
      <div className='flex items-center gap-3 sm:gap-5'>
        <Link
          to='/guide'
          className='text-sm whitespace-nowrap text-[#9AA0A6] hover:text-white'
        >
          How it works
        </Link>
        {/* A status label, not a button: an outline with a dot, so it never
            looks like the filled Connect button beside it. Green for the real
            network, orange for the play one, and the play one stays visible on
            a phone too, because it is the warning. */}
        {networkName === 'mainnet' ? (
          <span className='hidden items-center gap-2 rounded-full border border-[#22C55E]/40 bg-[#22C55E]/10 px-3 py-1 text-xs font-semibold tracking-widest text-[#4ADE80] uppercase sm:inline-flex'>
            <span
              className='h-1.5 w-1.5 rounded-full bg-[#4ADE80]'
              aria-hidden
            />
            {networkName}
          </span>
        ) : (
          <span className='inline-flex items-center gap-2 rounded-full border border-[#FF6E0A]/50 bg-[#FF6E0A]/10 px-3 py-1 text-xs font-semibold tracking-widest text-[#FF8A3D] uppercase'>
            <span
              className='h-1.5 w-1.5 rounded-full bg-[#FF8A3D]'
              aria-hidden
            />
            {networkName}
          </span>
        )}
        <ConnectButton />
      </div>
    </div>
  </header>
);
