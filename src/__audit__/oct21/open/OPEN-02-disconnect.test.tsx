// Open point 2 of the audit of 21 Oct 2026 (the web auditor's suspicion that
// "disconnect swallows a rejected logout"), checked by the main session: with
// the real sdk-dapp store and DappProvider, a wallet whose own logout fails
// (a WalletConnect relay that does not answer) must still leave this page
// disconnected, not connected with no word.
jest.mock('multisig/addressBook', () => ({
  getLabel: () => '',
  readHerotag: async () => ''
}));

import '../../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { getIsLoggedIn } from '@multiversx/sdk-dapp/out/methods/account/getIsLoggedIn';
import { DappProvider } from '@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider';
import { setAccountProvider } from '@multiversx/sdk-dapp/out/providers/helpers/accountProvider';
import { setAccount } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { loginAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConnectButton } from 'components/ConnectButton';

const ALICE = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';

const connect = (logout: () => Promise<boolean>) => {
  loginAction({ address: ALICE, providerType: 'walletConnect' } as any);
  setAccount({
    address: ALICE,
    nonce: 1,
    balance: '0',
    isGuarded: false
  } as any);
  setAccountProvider(
    new DappProvider({
      init: async () => true,
      isInitialized: () => true,
      getType: () => 'walletConnect',
      getAddress: async () => ALICE,
      login: async () => ({ address: ALICE, signature: '' }),
      logout,
      signTransactions: async (transactions: unknown[]) => transactions
    } as any)
  );
};

beforeEach(() =>
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
);

test('control: a wallet that logs out cleanly leaves the page disconnected', async () => {
  connect(async () => true);
  render(<ConnectButton />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  });
  expect(getIsLoggedIn()).toBe(false);
  expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
});

test('a wallet whose own logout fails still leaves the page disconnected', async () => {
  connect(async () => {
    throw new Error('WalletConnect relay did not answer');
  });
  render(<ConnectButton />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  });
  expect(getIsLoggedIn()).toBe(false);
  expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
});
