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
      <div className='flex items-center gap-5'>
        <Link to='/guide' className='text-sm text-[#9AA0A6] hover:text-white'>
          How it works
        </Link>
        {/* Green for the real network, orange for the play one: the two must
            never look alike, and orange is also the Connect button beside it,
            so an orange mainnet badge would read as a second button. */}
        {networkName === 'mainnet' ? (
          <span className='hidden items-center gap-2 rounded-full border border-[#22C55E]/40 bg-[#22C55E]/10 px-3 py-1 text-xs font-semibold tracking-widest text-[#4ADE80] uppercase sm:inline-flex'>
            <span className='h-1.5 w-1.5 rounded-full bg-[#4ADE80]' aria-hidden />
            {networkName}
          </span>
        ) : (
          <span className='rounded-full bg-[#FF6E0A] px-3 py-1 text-xs font-semibold tracking-widest text-black uppercase'>
            {networkName}
          </span>
        )}
        <ConnectButton />
      </div>
    </div>
  </header>
);
