// The audit's network fixtures, plus what the upgrade and call checks read:
// contracts with code, an owner and metadata, and the network's trial of a
// call sent as the safe. Imports nothing of the app, so a jest.mock factory
// can require it.
import { blake2b } from '@noble/hashes/blake2b';
import { networkMock } from '../../__audit__/display/fixtures';

// Code for the hashes handed out by mockCode, so that a contract's code and
// its code hash agree, as they do on chain. The app hashes the code itself
// (EXT-01, 21 Oct 2026); a hash given to contract() without coming from here
// gets code that does not match it, which is how a lying API looks.
const codes = new Map<string, string>();

/** The code hash of a made-up contract code, whose code contract() then carries. */
export const mockCode = (seed: string, bytes = 26540): string => {
  const head = Buffer.from(seed).toString('hex');
  const code = head + 'ab'.repeat(bytes - head.length / 2);
  const hash = Buffer.from(
    blake2b(Uint8Array.from(Buffer.from(code, 'hex')), { dkLen: 32 })
  ).toString('hex');
  codes.set(hash, code);
  return hash;
};

/** /accounts/{address} answers, by address. */
export const mockAccounts: Record<string, unknown> = {};

/** How the network answers a simulation; tests replace it. */
export const mockTrial: {
  answer: (transaction: any) => Promise<{ gasLimit: number }>;
} = {
  answer: async () => ({ gasLimit: 3800000 })
};

/** A contract as the API describes it. */
export const contract = ({
  owner,
  hash,
  bytes = 26540,
  upgradeable = true,
  readable = true,
  payable = false,
  payableBySc = false
}: {
  owner: string;
  hash: string;
  bytes?: number;
  upgradeable?: boolean;
  readable?: boolean;
  payable?: boolean;
  payableBySc?: boolean;
}) => ({
  balance: '0',
  ownerAddress: owner,
  codeHash: Buffer.from(hash, 'hex').toString('base64'),
  code: codes.get(hash) ?? 'ab'.repeat(bytes),
  isUpgradeable: upgradeable,
  isReadable: readable,
  isPayable: payable,
  isPayableBySmartContract: payableBySc
});

export const contractsNetworkMock = {
  ...networkMock,
  api: async (path: string) => {
    const account = /^\/accounts\/(erd1[0-9a-z]+)$/.exec(path);
    if (account && mockAccounts[account[1]]) return mockAccounts[account[1]];
    return networkMock.api(path);
  },
  networkProvider: {
    ...networkMock.networkProvider,
    estimateTransactionCost: (transaction: any) => mockTrial.answer(transaction)
  }
};
