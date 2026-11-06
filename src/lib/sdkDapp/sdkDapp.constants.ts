import { ProviderTypeEnum } from '@multiversx/sdk-dapp/out/providers/types/providerFactory.types';

export {
  ACCOUNTS_ENDPOINT,
  TRANSACTIONS_ENDPOINT
} from '@multiversx/sdk-dapp/out/apiCalls/endpoints';
export {
  GAS_PRICE,
  VERSION
} from '@multiversx/sdk-dapp/out/constants/mvx.constants';
export { fallbackNetworkConfigurations } from '@multiversx/sdk-dapp/out/constants/network.constants';

/**
 * The wallets the connect panel offers, in this order: xPortal (WalletConnect),
 * the MultiversX browser extension, a Ledger, the web wallet and MetaMask with
 * the MultiversX Snap. The Snap runs in an iframe from the network's
 * iframeWalletAddress, https://snap.multiversx.com on mainnet and
 * https://devnet-snap.multiversx.com on devnet, and each site's content policy
 * admits exactly its own one in frame-src. It was hidden while the policy
 * refused that frame (ops audit OPS-09, 7 Oct 2026). Like the web wallet's, the
 * Snap's answers count only from that origin. sdk-dapp-ui shows no MetaMask
 * button below 640 px wide, so none on a phone held upright. Passkey wallets are not offered for a tool that moves
 * treasuries.
 */
export const ALLOWED_WALLETS = [
  ProviderTypeEnum.walletConnect,
  ProviderTypeEnum.extension,
  ProviderTypeEnum.ledger,
  ProviderTypeEnum.crossWindow,
  ProviderTypeEnum.metamask
];
