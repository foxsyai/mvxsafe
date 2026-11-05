import { fireEvent, render, screen } from '@testing-library/react';
import { ALLOWED_WALLETS } from 'lib/sdkDapp/sdkDapp.constants';
import { ConnectButton } from '../ConnectButton';

const openUnlockPanel = jest.fn();
const init = jest.fn<{ openUnlockPanel: jest.Mock }, [unknown]>(() => ({
  openUnlockPanel
}));

jest.mock('lib', () => ({
  getAccountProvider: jest.fn(),
  UnlockPanelManager: { init: (options: unknown) => init(options) },
  useGetAccount: () => ({ address: '' }),
  useGetIsLoggedIn: () => false
}));

describe('Connect', () => {
  it('names every wallet the panel offers, MetaMask included', () => {
    render(<ConnectButton />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByRole('tooltip').textContent).toBe(
      'Proves which address you are, with xPortal, the browser extension, a Ledger, the web wallet or MetaMask. It cannot move anything by itself.'
    );
  });

  it('opens the panel with exactly those wallets', () => {
    render(<ConnectButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ allowedProviders: ALLOWED_WALLETS })
    );
    expect(openUnlockPanel).toHaveBeenCalled();
  });
});
