import { Link } from 'react-router-dom';
import { useGetIsLoggedIn } from 'lib';
import { networkName } from 'multisig/network';
import { ConnectButton } from '../ConnectButton';
import { Logo } from '../Logo';

export const Header = () => {
  const isLoggedIn = useGetIsLoggedIn();
  return (
    <header className='border-b border-[#1F1F27] bg-[#0E0E12]'>
      {/* The test network says so on every screen. On a phone the warning is a
          strip of its own above the header, because inside the header row it
          took the room the wallet name needs. */}
      {networkName !== 'mainnet' && (
        <div className='bg-[#FF6E0A]/15 px-4 py-1 text-center text-[11px] font-semibold tracking-widest text-[#FF8A3D] uppercase sm:hidden'>
          {networkName}: test network, no real money
        </div>
      )}
      <div className='mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-4 py-4'>
        <Link to='/' className='shrink-0'>
          <Logo compact={isLoggedIn} />
        </Link>
        {/* Tighter on a phone, and the link never wraps: connected, the header
          used to push "How it works" onto two lines against the logo. On a
          phone this side takes the rest of the row, so the wallet name gets
          whatever room is left. */}
        <div className='flex min-w-0 flex-1 items-center justify-end gap-3 sm:flex-none sm:gap-5'>
          <Link
            to='/guide'
            className='shrink-0 text-sm whitespace-nowrap text-[#9AA0A6] hover:text-white'
          >
            How it works
          </Link>
          {/* A status label, not a button: an outline with a dot, so it never
            looks like the filled Connect button beside it. Green for the real
            network, orange for the play one. On a phone neither sits here:
            the play one becomes the strip above the header. */}
          {networkName === 'mainnet' ? (
            <span className='hidden shrink-0 items-center gap-2 rounded-full border border-[#22C55E]/40 bg-[#22C55E]/10 px-3 py-1 text-xs font-semibold tracking-widest text-[#4ADE80] uppercase sm:inline-flex'>
              <span
                className='h-1.5 w-1.5 rounded-full bg-[#4ADE80]'
                aria-hidden
              />
              {networkName}
            </span>
          ) : (
            <span className='hidden shrink-0 items-center gap-2 rounded-full border border-[#FF6E0A]/50 bg-[#FF6E0A]/10 px-3 py-1 text-xs font-semibold tracking-widest text-[#FF8A3D] uppercase sm:inline-flex'>
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
};
