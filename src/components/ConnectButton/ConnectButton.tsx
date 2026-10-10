import { useCallback } from 'react';
import { Tip } from 'components/Info';
import {
  getAccountProvider,
  UnlockPanelManager,
  useGetAccount,
  useGetIsLoggedIn
} from 'lib';
import { ALLOWED_WALLETS } from 'lib/sdkDapp/sdkDapp.constants';
import { AccountName } from './AccountName';

// Connecting proves which address you are, nothing more. It cannot move
// anything: every action is a separate transaction your wallet has to sign.
//
// The panel is built when the button is pressed, NOT in the render body. Built
// on every render it was rebuilt dozens of times while the list loaded, which
// is what made the browser crawl (6 Oct 2026).
export const ConnectButton = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();

  const openPanel = useCallback(() => {
    UnlockPanelManager.init({
      allowedProviders: ALLOWED_WALLETS,
      loginHandler: () => undefined,
      onClose: async () => undefined
    }).openUnlockPanel();
  }, []);

  const disconnect = useCallback(async () => {
    await getAccountProvider().logout();
  }, []);

  if (!isLoggedIn) {
    return (
      <Tip text='Proves which address you are, with xPortal, the browser extension, a Ledger or the web wallet. It cannot move anything by itself.'>
        <button
          type='button'
          onClick={openPanel}
          className='rounded-lg bg-[#FF6E0A] px-4 py-2 text-sm font-semibold text-black hover:bg-[#ff8534]'
        >
          Connect
        </button>
      </Tip>
    );
  }

  // Connected: who you are, then a door to leave by. The icon replaced the
  // word "Disconnect", which left no room for the name on a phone.
  return (
    <div className='flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:gap-3'>
      <AccountName address={address} />
      <Tip text='Disconnect. Forgets your wallet here; your safes stay in the list.'>
        <button
          type='button'
          onClick={disconnect}
          aria-label='Disconnect'
          className='shrink-0 rounded-lg border border-[#2A2A32] p-2 text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'
        >
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            aria-hidden
          >
            <path
              d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'
              stroke='currentColor'
              strokeWidth='1.8'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
            <path
              d='M16 17l5-5-5-5M21 12H9'
              stroke='currentColor'
              strokeWidth='1.8'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        </button>
      </Tip>
    </div>
  );
};
