import { getAccountProvider, UnlockPanelManager, useGetAccount, useGetIsLoggedIn } from 'lib';
import { shortAddress } from 'multisig/reads';

// Connecting proves which address you are, nothing more. It cannot move
// anything: every action is a separate transaction your wallet has to sign.
export const ConnectButton = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();

  const unlockPanel = UnlockPanelManager.init({
    loginHandler: () => undefined,
    onClose: async () => undefined
  });

  if (!isLoggedIn) {
    return (
      <button
        type='button'
        onClick={() => unlockPanel.openUnlockPanel()}
        className='rounded-lg bg-[#FF6E0A] px-4 py-2 text-sm font-semibold text-black hover:bg-[#ff8534]'
      >
        Connect
      </button>
    );
  }

  return (
    <div className='flex items-center gap-3'>
      <span className='font-mono text-xs text-[#9AA0A6]'>{shortAddress(address)}</span>
      <button
        type='button'
        onClick={async () => {
          await getAccountProvider().logout();
        }}
        className='rounded-lg border border-[#2A2A32] px-3 py-2 text-xs text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white'
      >
        Disconnect
      </button>
    </div>
  );
};
