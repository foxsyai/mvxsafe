// Reading a safe. Nothing here signs or sends anything: every call below is a
// view on the contract or a GET on the public API.
//
// Queries go through the legacy ABI (src/abi/multisig-legacy.abi.json), which
// matches the contract our safes, and most multisigs deployed before 2025, run.
// The SDK's own multisig ABI describes a newer build and CRASHES while decoding
// a pending action on ours, which is how this was found (devnet, 6 Oct 2026).

import { Address, SmartContractController } from '@multiversx/sdk-core';
import { describeAction, toBigInt } from './describe';
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
  /** Null when the pending actions could not be read. */
  pendingCount: number | null;
}

export interface PendingAction {
  actionId: number;
  description: string;
  /** Signatures that count: only from addresses on the board today. */
  signerCount: number;
  /** Everyone who signed and still sits on the board. */
  signers: string[];
  /** Who signed and has since left the board. The contract ignores them. */
  formerSigners: string[];
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
/**
 * The token a safe's tile and card lead with: the most valuable one it holds,
 * or the first when no price is known. It used to be FOXSY whatever the safe,
 * which made sense for one organisation and not for a public tool.
 */
export const featuredToken = (tokens: TokenBalance[]): TokenBalance | undefined =>
  [...tokens].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))[0];

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
  // The rest is absent on cards cached by an older version of the page.
  boardSize?: number | null;
  /** Actions waiting for signatures right now. */
  pendingCount?: number | null;
  /** Every action ever proposed, carried out or discarded included. */
  actionCount?: number | null;
  /** Who the next number was counted for: a card never speaks for another wallet. */
  viewer?: string;
  /** Pending actions the viewer, a board member, has not signed and that still need signatures. */
  needsViewer?: number | null;
  /** Pending actions with enough signatures, waiting only to be carried out. */
  readyCount?: number | null;
}

/**
 * Enough for one card of the list: what it holds, how many signatures it needs
 * out of how many members, what is waiting and how much has been proposed so
 * far. The contract reads share their cache keys with the safe page, so
 * opening a safe after the list costs nothing more.
 */
export const readCard = async (address: string, viewer = ''): Promise<SafeCard> => {
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

  const card: SafeCard = {
    address,
    tokens: balances.tokens,
    egld: balances.egld,
    quorum,
    worthUsd: worthOf(balances.egld, balances.tokens, egldPrice),
    boardSize: null,
    pendingCount: null,
    actionCount: null,
    viewer,
    needsViewer: null,
    readyCount: null
  };
  if (quorum === null) return card;

  const [board, last, pending] = await Promise.allSettled([
    cached(`board:${address}`, () => query<any>(address, 'getAllBoardMembers')),
    cached(`actions:${address}`, () => query<any>(address, 'getActionLastIndex')),
    cached(`pending:${address}`, () => query<any>(address, 'getPendingActionFullInfo'))
  ]);
  const members =
    board.status === 'fulfilled'
      ? (Array.isArray(board.value) ? board.value : [board.value]).map(asAddress).filter(Boolean)
      : null;
  if (members) card.boardSize = members.length;
  if (last.status === 'fulfilled') card.actionCount = asNumber(last.value);
  if (pending.status === 'fulfilled') {
    const list = (
      Array.isArray(pending.value) ? pending.value : pending.value ? [pending.value] : []
    ).filter(Boolean);
    card.pendingCount = list.length;
    const validSigners = (action: any) =>
      ((action.signers ?? []).map(asAddress) as string[]).filter((signer) =>
        members?.includes(signer)
      ).length;
    if (members) {
      card.readyCount = list.filter((action: any) => validSigners(action) >= (quorum ?? Infinity)).length;
    }
    // Only for a board member, and only signatures that count, as on the safe page.
    if (viewer && members?.includes(viewer)) {
      card.needsViewer = list.filter((action: any) => {
        const signers: string[] = (action.signers ?? []).map(asAddress);
        const valid = signers.filter((signer) => members.includes(signer)).length;
        return !signers.includes(viewer) && valid < (quorum ?? 0);
      }).length;
    }
  }
  return card;
};

export const readOverview = async (address: string): Promise<SafeOverview> => {
  const [balances, state, pending, egldPrice] = await Promise.all([
    readBalances(address),
    readMultisigState(address),
    readPendingActions(address).catch(() => null),
    readEgldPrice()
  ]);

  return {
    address,
    ...balances,
    ...state,
    egldPrice,
    worthUsd: worthOf(balances.egld, balances.tokens, egldPrice),
    pendingCount: pending ? pending.length : null
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
 * so the decoding happens here, in describe.ts, rather than in a view.
 *
 * Only signatures from CURRENT board members count, exactly as the contract
 * counts them: a former member's signature stays in the list but no longer
 * moves anything, and it no longer blocks a discard (display audit DISP-05).
 *
 * A failed read THROWS. It used to answer "no pending actions", which put
 * "Nothing is waiting for a signature" on a page that simply could not see
 * (DISP-11).
 */
export const readPendingActions = async (address: string): Promise<PendingAction[]> => {
  const [pending, state] = await Promise.all([
    cached(`pending:${address}`, () => query<any>(address, 'getPendingActionFullInfo')),
    readMultisigState(address)
  ]);
  if (state.quorum === null) {
    throw new Error('The board and quorum of this safe could not be read.');
  }
  const board = new Set(state.boardMembers);
  const list = (Array.isArray(pending) ? pending : pending ? [pending] : []).filter(Boolean);

  return Promise.all(
    list.map(async (action: any) => {
      const everyone: string[] = (action.signers ?? []).map(asAddress).filter(Boolean);
      const signers = everyone.filter((signer) => board.has(signer));
      return {
        actionId: asNumber(action.action_id ?? action.actionId),
        description: await describeAction(action.action_data ?? action.actionData, address),
        signerCount: signers.length,
        signers,
        formerSigners: everyone.filter((signer) => !board.has(signer)),
        quorumReached: signers.length >= (state.quorum ?? Number.MAX_SAFE_INTEGER)
      };
    })
  );
};

export const formatRaw = (raw: bigint, decimals = 18, maximumFractionDigits = 4) => {
  const amount = Number(raw) / Math.pow(10, decimals);
  return amount.toLocaleString('en-US', { maximumFractionDigits });
};

export const formatAmount = (value: unknown, decimals = 18, maximumFractionDigits = 4) =>
  formatRaw(toBigInt(value) ?? 0n, decimals, maximumFractionDigits);

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

export interface ContractInfo {
  /** Who may replace the contract's code. For a safe set up right, itself. */
  ownerAddress: string;
  codeHash: string;
  /** False when the address holds no contract yet, for example mid-creation. */
  exists: boolean;
}

/**
 * Ownership and code of a contract. A safe that is not its own owner can have
 * its code replaced by that owner alone, whatever the board thinks, so the page
 * says so in red.
 */
export const readContractInfo = async (address: string): Promise<ContractInfo> => {
  const account = await cached(`contract:${address}`, () =>
    api<{ ownerAddress?: string; codeHash?: string }>(`/accounts/${address}`)
  );
  return {
    ownerAddress: account?.ownerAddress ?? '',
    codeHash: account?.codeHash ?? '',
    exists: Boolean(account?.codeHash)
  };
};
