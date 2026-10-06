// Reading a safe. Nothing here signs or sends anything: every call below is a
// view on the contract or a GET on the public API.
//
// Queries go through the legacy ABI (src/abi/multisig-legacy.abi.json), which
// matches the contract our safes, and most multisigs deployed before 2025, run.
// The SDK's own multisig ABI describes a newer build and CRASHES while decoding
// a pending action on ours, which is how this was found (devnet, 6 Oct 2026).

import { Address, SmartContractController } from '@multiversx/sdk-core';
import { legacyAbi } from './legacyCalls';
import { api, cached, chainId, networkProvider } from './network';

const contracts = new SmartContractController({
  chainID: chainId,
  networkProvider,
  abi: legacyAbi
});

const query = async <T>(safe: string, fn: string, args: any[] = []): Promise<T> => {
  const [value] = await contracts.query({
    contract: Address.newFromBech32(safe),
    function: fn,
    arguments: args
  });
  return value as T;
};

export interface TokenBalance {
  identifier: string;
  ticker: string;
  name: string;
  balance: string;
  decimals: number;
  /** The balance as a human number, already divided by the decimals. */
  amount: number;
  /** What the API says it is worth, when the token has a market price. */
  valueUsd?: number;
}

export interface SafeOverview {
  address: string;
  egld: number;
  egldPrice: number;
  worthUsd: number;
  tokens: TokenBalance[];
  nftCount: number;
  /** Null when the address is not a multisig we can read. */
  quorum: number | null;
  boardMembers: string[];
  proposerCount: number;
  actionCount: number;
  pendingCount: number;
}

export interface PendingAction {
  actionId: number;
  description: string;
  signerCount: number;
  signers: string[];
  quorumReached: boolean;
}

export interface HistoryEntry {
  txHash: string;
  timestamp: number;
  sender: string;
  functionName: string;
  status: string;
}

const toNumber = (balance: string, decimals: number) =>
  Number(balance) / Math.pow(10, decimals);

const asNumber = (value: any) => Number(value?.toString?.() ?? value ?? 0);

const asAddress = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toBech32 === 'function') return value.toBech32();
  if (value.bech32) return String(value.bech32);
  return String(value);
};

const bytesOf = (value: any): Uint8Array | null => {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value.type === 'Buffer' && Array.isArray(value.data)) return new Uint8Array(value.data);
  return null;
};

const asText = (value: any): string => {
  if (typeof value === 'string') return value;
  const bytes = bytesOf(value);
  return bytes ? new TextDecoder().decode(bytes) : '';
};

/** A decoded buffer read as a number, which is how amounts arrive in arguments. */
const asRaw = (value: any): bigint => {
  const bytes = bytesOf(value);
  if (!bytes || bytes.length === 0) return 0n;
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) + BigInt(byte);
  return result;
};

const asBigInt = (value: any): bigint => {
  try {
    return BigInt(value?.toString?.() ?? value ?? 0);
  } catch {
    return 0n;
  }
};

interface AccountResponse {
  balance: string;
}

interface TokenResponse {
  identifier: string;
  ticker?: string;
  name?: string;
  balance: string;
  decimals?: number;
  valueUsd?: number;
}

/**
 * The EGLD price, from the same API as everything else. Read once and kept for
 * the usual minute, like any other answer.
 */
export const readEgldPrice = async (): Promise<number> => {
  try {
    const economics = await cached('economics', () =>
      api<{ price?: number }>('/economics')
    );
    return Number(economics?.price ?? 0);
  } catch {
    return 0;
  }
};

/** What the safe holds. */
export const readBalances = async (address: string, withNfts = true) => {
  const [account, tokens, nftCount] = await Promise.all([
    api<AccountResponse>(`/accounts/${address}`),
    api<TokenResponse[]>(`/accounts/${address}/tokens?size=50`),
    withNfts ? api<number>(`/accounts/${address}/nfts/count`).catch(() => 0) : Promise.resolve(0)
  ]);

  return {
    egld: toNumber(account.balance ?? '0', 18),
    nftCount: Number(nftCount) || 0,
    tokens: tokens.map((token) => ({
      identifier: token.identifier,
      ticker: token.ticker ?? token.identifier.split('-')[0],
      name: token.name ?? token.identifier,
      balance: token.balance,
      decimals: token.decimals ?? 18,
      amount: toNumber(token.balance, token.decimals ?? 18),
      valueUsd: typeof token.valueUsd === 'number' ? token.valueUsd : undefined
    }))
  };
};

/** Everything a safe holds, in dollars, as far as the API knows prices. */
export const worthOf = (egld: number, tokens: TokenBalance[], egldPrice: number) =>
  egld * egldPrice + tokens.reduce((total, token) => total + (token.valueUsd ?? 0), 0);

/** $1,234 for real money, $0.42 for small change, nothing when unknown. */
export const formatUsd = (value?: number): string => {
  if (!value || !Number.isFinite(value)) return '';
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
};

/**
 * The multisig side: who is on the board, how many signatures an action needs
 * and how many actions there have been. An address that is not a multisig
 * answers with an error, reported as quorum null rather than as a crash.
 */
export const readMultisigState = async (address: string) => {
  try {
    const [quorum, board, proposers, actionCount] = await Promise.all([
      cached(`quorum:${address}`, () => query<any>(address, 'getQuorum')),
      cached(`board:${address}`, () => query<any>(address, 'getAllBoardMembers')),
      cached(`proposers:${address}`, () => query<any>(address, 'getNumProposers')),
      cached(`actions:${address}`, () => query<any>(address, 'getActionLastIndex'))
    ]);

    return {
      quorum: asNumber(quorum),
      boardMembers: (Array.isArray(board) ? board : [board]).map(asAddress).filter(Boolean),
      proposerCount: asNumber(proposers),
      actionCount: asNumber(actionCount)
    };
  } catch {
    return { quorum: null, boardMembers: [], proposerCount: 0, actionCount: 0 };
  }
};

export interface SafeCard {
  address: string;
  tokens: TokenBalance[];
  egld: number;
  /** Null when the address is not a multisig we can read. */
  quorum: number | null;
  /** What the whole safe is worth, when the API knows the prices. */
  worthUsd: number;
}

/**
 * Just enough for one row of the list: what it holds and how many signatures it
 * needs. Three requests instead of the eight a full overview costs, which
 * matters because the public API allows about two a second per visitor and the
 * list asks for every safe at once.
 */
export const readCard = async (address: string): Promise<SafeCard> => {
  const [balances, egldPrice] = await Promise.all([
    readBalances(address, false),
    readEgldPrice()
  ]);
  let quorum: number | null = null;
  try {
    quorum = asNumber(await cached(`quorum:${address}`, () => query<any>(address, 'getQuorum')));
  } catch {
    quorum = null;
  }
  return {
    address,
    tokens: balances.tokens,
    egld: balances.egld,
    quorum,
    worthUsd: worthOf(balances.egld, balances.tokens, egldPrice)
  };
};

export const readOverview = async (address: string): Promise<SafeOverview> => {
  const [balances, state, pending, egldPrice] = await Promise.all([
    readBalances(address),
    readMultisigState(address),
    readPendingActions(address),
    readEgldPrice()
  ]);

  return {
    address,
    ...balances,
    ...state,
    egldPrice,
    worthUsd: worthOf(balances.egld, balances.tokens, egldPrice),
    pendingCount: pending.length
  };
};

/** What the connected address may do here: BoardMember, Proposer or None. */
export const readUserRole = async (safe: string, user: string): Promise<string> => {
  if (!user) return 'None';
  try {
    const role = await cached(`role:${safe}:${user}`, () =>
      query<any>(safe, 'userRole', [Address.newFromBech32(user)])
    );
    return String(role?.name ?? role ?? 'None');
  } catch {
    return 'None';
  }
};

/**
 * Actions still waiting for signatures, each turned into a sentence. A signer's
 * only defence against approving something unexpected is reading it in words,
 * so the decoding happens here rather than in a view.
 */
export const readPendingActions = async (address: string): Promise<PendingAction[]> => {
  try {
    const [pending, state] = await Promise.all([
      cached(`pending:${address}`, () => query<any>(address, 'getPendingActionFullInfo')),
      readMultisigState(address)
    ]);
    const list = Array.isArray(pending) ? pending : pending ? [pending] : [];
    const quorum = state.quorum ?? Number.MAX_SAFE_INTEGER;

    return list.filter(Boolean).map((action: any) => {
      const signers: string[] = (action.signers ?? []).map(asAddress);
      return {
        actionId: asNumber(action.action_id ?? action.actionId),
        description: describeAction(action.action_data ?? action.actionData),
        signerCount: signers.length,
        signers,
        quorumReached: signers.length >= quorum
      };
    });
  } catch {
    return [];
  }
};

/**
 * Plain language for one action, from the decoded enum. Anything unrecognised
 * is reported as unknown rather than guessed at, which is the safe failure: a
 * signer who cannot read what an action does should not sign it.
 */
export const describeAction = (action: any): string => {
  if (!action) return 'Unknown action';
  const name = String(action.name ?? action.type ?? 'Unknown');
  const fields = action.fields ?? [];
  const first = fields[0];

  switch (name) {
    case 'Nothing':
      return 'Already carried out or discarded';
    case 'AddBoardMember':
      return `Add ${shortAddress(asAddress(first))} to the board`;
    case 'AddProposer':
      return `Add ${shortAddress(asAddress(first))} as a proposer`;
    case 'RemoveUser':
      return `Remove ${shortAddress(asAddress(first))}`;
    case 'ChangeQuorum':
      return `Change the quorum to ${asNumber(first)}`;
    case 'SendTransferExecute':
    case 'SendAsyncCall': {
      const data = first ?? {};
      const to = shortAddress(asAddress(data.to));
      const egldAmount = asBigInt(data.egld_amount);
      const endpoint = asText(data.endpoint_name);
      const rawArgs = data.arguments ?? [];

      // How a token transfer looks on this build: an async call asking the
      // recipient to run ESDTTransfer with the token and the amount.
      if (endpoint === 'ESDTTransfer' && rawArgs.length >= 2) {
        const token = asText(rawArgs[0]);
        return `Send ${formatRaw(asRaw(rawArgs[1]), 18)} ${token.split('-')[0]} to ${to}`;
      }
      if (egldAmount > 0n && !endpoint) {
        return `Send ${formatRaw(egldAmount, 18)} EGLD to ${to}`;
      }
      if (endpoint) {
        return `Call ${endpoint} on ${to}${
          egldAmount > 0n ? ` with ${formatRaw(egldAmount, 18)} EGLD` : ''
        }`;
      }
      // No function, no amount: the action does nothing readable. Say so rather
      // than dressing it up, because a signer should refuse what cannot be read.
      return `Unreadable call to ${to}, do not sign without checking the explorer`;
    }
    case 'SCDeployFromSource':
      return 'Deploy a smart contract';
    case 'SCUpgradeFromSource':
      return 'Upgrade a smart contract';
    default:
      return `Unknown action (${name})`;
  }
};

export const formatRaw = (raw: bigint, decimals = 18, maximumFractionDigits = 4) => {
  const amount = Number(raw) / Math.pow(10, decimals);
  return amount.toLocaleString('en-US', { maximumFractionDigits });
};

export const formatAmount = (value: unknown, decimals = 18, maximumFractionDigits = 4) =>
  formatRaw(asBigInt(value), decimals, maximumFractionDigits);

export const shortAddress = (address: string, lead = 8, tail = 6) =>
  !address ? '' : `${address.slice(0, lead)}...${address.slice(-tail)}`;

/** The last transactions the safe took part in, newest first. */
export const readHistory = async (address: string): Promise<HistoryEntry[]> => {
  const transactions = await api<any[]>(
    `/accounts/${address}/transactions?size=25&fields=txHash,timestamp,sender,function,status`
  ).catch(() => []);

  return transactions.map((transaction) => ({
    txHash: transaction.txHash,
    timestamp: Number(transaction.timestamp ?? 0),
    sender: transaction.sender ?? '',
    functionName: transaction.function ?? 'transfer',
    status: transaction.status ?? ''
  }));
};
