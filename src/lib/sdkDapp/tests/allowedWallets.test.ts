import { getProvidersList } from '@multiversx/sdk-dapp/out/managers/UnlockPanelManager/helpers/getProviderList';
import { ALLOWED_WALLETS } from '../sdkDapp.constants';

// The list the connect panel draws, built by sdk-dapp's own code from the list
// we pass it, so a renamed or dropped provider type shows here.
const offered = () =>
  getProvidersList([], ALLOWED_WALLETS).map((provider) => provider.name);

describe('The wallets the connect panel offers', () => {
  it('are xPortal, the extension, a Ledger, the web wallet and MetaMask, in that order', () => {
    expect(offered()).toEqual([
      'xPortal App',
      'MultiversX Wallet Extension',
      'Ledger',
      'MultiversX Web Wallet',
      'MetaMask Snap'
    ]);
  });

  it('leave out passkeys, which are not offered for a tool that moves treasuries', () => {
    expect(offered()).not.toContain('Passkey');
    expect(ALLOWED_WALLETS).toHaveLength(5);
  });
});
