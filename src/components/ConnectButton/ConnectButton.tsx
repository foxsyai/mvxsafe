import { useCallback } from 'react';
import { AddressLine } from 'components/Address';
import { Tip } from 'components/Info';
import {
  getAccountProvider,
  UnlockPanelManager,
  useGetAccount,
  useGetIsLoggedIn
} from 'lib';
import { ALLOWED_WALLETS } from 'lib/sdkDapp/sdkDapp.constants';

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

  return (
    <div className='flex items-center gap-3'>
      {/* No room for the name on a phone; the board marks your own address
          with YOU on every safe instead. */}
      <span className='hidden sm:inline-flex'>
        <AddressLine
          address={address}
          className='text-xs whitespace-nowrap text-[#9AA0A6]'
        />
      </span>
      <Tip text='Forgets your wallet here. Your safes stay in the list.'>
        <button
          type='button'
          onClick={disconnect}
          className='rounded-lg border border-[#2A2A32] px-3 py-2 text-xs text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'
        >
          Disconnect
        </button>
      </Tip>
    </div>
  );
};
