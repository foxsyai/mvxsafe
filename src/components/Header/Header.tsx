import { Link } from 'react-router-dom';
import { networkName } from 'multisig/network';
import { Logo } from '../Logo';

// Deliberately bare for the read-only milestone: no wallet button, because
// nothing here can sign. The connect button arrives with the signing milestone.
export const Header = () => (
  <header className='border-b border-[#1F1F27] bg-[#0E0E12]'>
    <div className='mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4'>
      <Link to='/'>
        <Logo />
      </Link>
      <span className='rounded-full border border-[#2A2A32] px-3 py-1 text-xs tracking-widest text-[#9AA0A6] uppercase'>
        {networkName}
      </span>
    </div>
  </header>
);
