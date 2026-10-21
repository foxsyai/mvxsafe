// Reading a safe. Nothing here signs or sends anything: every call below is a
// view on the contract or a GET on the public API.
//
// Queries go through the legacy ABI (src/abi/multisig-legacy.abi.json), which
// matches the contract our safes, and most multisigs deployed before 2025, run.
// The SDK's own multisig ABI describes a newer build and CRASHES while decoding
// a pending action on ours, which is how this was found (devnet, 6 Oct 2026).

import {
  Address,
  SmartContractController,
  U32Value
} from '@multiversx/sdk-core';
import { describeAction, toBigInt } from './describe';
import { PerformPlan } from './gas';
import { Check, inspectAction, UpgradeFacts } from './inspect';
import { legacyAbi } from './legacyCalls';
import { api, cached, chainId, isTransient, networkProvider } from './network';

const contracts = new SmartContractController({
  chainID: chainId,
  networkProvider,
  abi: legacyAbi
});

const query = async <T>(
  safe: string,
  fn: string,
  args: any[] = []
): Promise<T> => {
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
  egldRaw: string;
  egldPrice: number;
  worthUsd: number;
  tokens: TokenBalance[];
  nftCount: number;
  /** Null when the address is not a multisig we can read. */
  quorum: number | null;
  boardMembers: string[];
  /** Who may propose without signing. Empty when there are none. */
  proposers: string[];
  proposerCount: number;
  actionCount: number;
  /** Null when the pending actions could not be read. */
  pendingCount: number | null;
}

export interface PendingAction {
  actionId: number;
  // The next four are absent on actions built by older code and tests.
  /** The kind of action, as the contract names it: SendAsyncCall, SCUpgradeFromSource... */
  name?: string;
  description: string;
  /** What was checked on chain about it, each green, amber or red. */
  checks?: Check[];
  /** For an upgrade: the code hashes and shards the card shows. */
  upgrade?: UpgradeFacts;
  /** How carrying it out gets its gas: simulated, or a budget the performer sees. */
  perform?: PerformPlan;
  /**
   * True when the contract cannot return this action's data (SC-01): it can
   * only have signatures removed and then be discarded, never signed or
   * carried out.
   */
  unreadable?: boolean;
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
    const economics = await api<{ price?: number }>('/economics');
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
    withNfts
      ? api<number>(`/accounts/${address}/nfts/count`).catch(() => 0)
      : Promise.resolve(0)
  ]);

  return {
    egld: toNumber(account.balance ?? '0', 18),
    /** The exact balance in base units, for checks that must not round. */
    egldRaw: account.balance ?? '0',
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
export const featuredToken = (
  tokens: TokenBalance[]
): TokenBalance | undefined =>
  [...tokens].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))[0];

export const worthOf = (
  egld: number,
  tokens: TokenBalance[],
  egldPrice: number
) =>
  egld * egldPrice +
  tokens.reduce((total, token) => total + (token.valueUsd ?? 0), 0);

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
      cached(`board:${address}`, () =>
        query<any>(address, 'getAllBoardMembers')
      ),
      cached(`proposers:${address}`, () =>
        query<any>(address, 'getNumProposers')
      ),
      cached(`actions:${address}`, () =>
        query<any>(address, 'getActionLastIndex')
      )
    ]);

    // The list of proposers, read on its own: a contract without the view is
    // still a safe, a refused read is still an error.
    let proposerList: string[] | null = null;
    try {
      const list = await cached(`proposerList:${address}`, () =>
        query<any>(address, 'getAllProposers')
      );
      proposerList = (Array.isArray(list) ? list : list ? [list] : [])
        .map(asAddress)
        .filter(Boolean);
    } catch (error) {
      if (isTransient(error)) throw error;
    }
    return {
      quorum: asNumber(quorum),
      boardMembers: (Array.isArray(board) ? board : [board])
        .map(asAddress)
        .filter(Boolean),
      proposers: proposerList ?? [],
      proposerCount: proposerList ? proposerList.length : asNumber(proposers),
      actionCount: asNumber(actionCount)
    };
  } catch (error) {
    // A refused or lost read is not an answer: the caller keeps what it had.
    // Anything else (no such function) means this is not a multisig we read.
    if (isTransient(error)) throw error;
    return {
      quorum: null,
      boardMembers: [],
      proposers: [],
      proposerCount: 0,
      actionCount: 0
    };
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
export const readCard = async (
  address: string,
  viewer = ''
): Promise<SafeCard> => {
  const [balances, egldPrice] = await Promise.all([
    readBalances(address, false),
    readEgldPrice()
  ]);
  let quorum: number | null = null;
  try {
    quorum = asNumber(
      await cached(`quorum:${address}`, () => query<any>(address, 'getQuorum'))
    );
  } catch (error) {
    // Refused is not "not a multisig": the list keeps the card it had.
    if (isTransient(error)) throw error;
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
    cached(`actions:${address}`, () =>
      query<any>(address, 'getActionLastIndex')
    ),
    cached(`pending:${address}`, () =>
      query<any>(address, 'getPendingActionFullInfo')
    )
  ]);
  const members =
    board.status === 'fulfilled'
      ? (Array.isArray(board.value) ? board.value : [board.value])
          .map(asAddress)
          .filter(Boolean)
      : null;
  if (members) card.boardSize = members.length;
  if (last.status === 'fulfilled') card.actionCount = asNumber(last.value);
  if (pending.status === 'fulfilled') {
    const list = (
      Array.isArray(pending.value)
        ? pending.value
        : pending.value
          ? [pending.value]
          : []
    ).filter(Boolean);
    card.pendingCount = list.length;
    const validSigners = (action: any) =>
      ((action.signers ?? []).map(asAddress) as string[]).filter((signer) =>
        members?.includes(signer)
      ).length;
    if (members) {
      card.readyCount = list.filter(
        (action: any) => validSigners(action) >= (quorum ?? Infinity)
      ).length;
    }
    // Only for a board member, and only signatures that count, as on the safe page.
    if (viewer && members?.includes(viewer)) {
      card.needsViewer = list.filter((action: any) => {
        const signers: string[] = (action.signers ?? []).map(asAddress);
        const valid = signers.filter((signer) =>
          members.includes(signer)
        ).length;
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
export const readUserRole = async (
  safe: string,
  user: string
): Promise<string> => {
  if (!user) return 'None';
  // A refused read throws: it used to come back as "None", and a board member
  // was told "You are not on this board" (7 Oct 2026).
  const role = await cached(`role:${safe}:${user}`, () =>
    query<any>(safe, 'userRole', [Address.newFromBech32(user)])
  );
  return String(role?.name ?? role ?? 'None');
};

/**
 * What a membership action really does to that address today. One address
 * holds one role: adding a proposer to the board promotes them, adding a
 * board member as a proposer demotes them, removing takes away whatever role
 * they have. And the contract refuses to carry out anything that would leave
 * fewer board members than the signatures needed.
 */
export const membershipNote = (
  action: any,
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] }
): string => {
  const name = String(action?.name ?? '');
  const board = state.boardMembers.length;

  // A quorum equal to the board means one lost wallet locks the safe for
  // good; above it, the contract refuses (raised in the mainnet test, 7 Oct).
  if (name === 'ChangeQuorum') {
    const next = Number(
      action?.fields?.[0]?.toString?.() ?? action?.fields?.[0] ?? 0
    );
    // The contract accepts 0, and then needs no signature at all (SC-02).
    if (next < 1) {
      return ' (a quorum of 0 means no signature is needed at all: any single board member or proposer could carry out any action, and the board would lose all control)';
    }
    if (next > board) {
      return ` (there are only ${board} board members, so the contract will refuse to carry it out)`;
    }
    if (board > 1 && next === board) {
      return ` (all ${board} board members would then have to sign every action: one lost wallet would lock the safe)`;
    }
    return '';
  }

  const who = asAddress(action?.fields?.[0]);
  if (!who) return '';
  const onBoard = state.boardMembers.includes(who);
  const proposer = state.proposers.includes(who);
  const quorum = state.quorum ?? 0;
  const left = state.boardMembers.length - 1;
  const refused = (what: string) =>
    ` (on the board today: ${what} would leave ${left} board member${left === 1 ? '' : 's'} for the ${quorum} signatures needed, so the contract will refuse to carry it out)`;

  switch (name) {
    case 'AddBoardMember':
      if (onBoard) return ' (already on the board: this changes nothing)';
      if (proposer)
        return ' (a proposer today: the board seat replaces that role)';
      return '';
    case 'AddProposer':
      if (proposer) return ' (already a proposer: this changes nothing)';
      if (onBoard) {
        return left < quorum
          ? refused('taking them off it')
          : ' (on the board today: this takes them off the board)';
      }
      return '';
    case 'RemoveUser':
      if (onBoard) {
        if (left < quorum) return refused('removing them');
        if (left > 1 && left === quorum) {
          return ` (on the board today: afterwards all ${left} remaining board members would have to sign every action)`;
        }
        return ' (on the board today)';
      }
      if (proposer) return ' (a proposer today)';
      return ' (holds no role today: this changes nothing)';
    default:
      return '';
  }
};

/**
 * Why a membership change should not be proposed at all, or '' when it can
 * be. Refused here, before any transaction: a change that does nothing only
 * costs fees, and one the contract refuses fails at "Carry it out", after
 * every signer has paid (7 Oct 2026).
 */
export const membershipProblem = (
  action: any,
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] }
): string => {
  const name = String(action?.name ?? '');
  const who = asAddress(action?.fields?.[0]);
  if (!who) return '';
  const onBoard = state.boardMembers.includes(who);
  const proposer = state.proposers.includes(who);
  const quorum = state.quorum ?? 0;
  const left = state.boardMembers.length - 1;
  const tooFew = `That would leave ${left} board member${left === 1 ? '' : 's'} for the ${quorum} signatures needed, which the contract refuses. Lower the quorum first.`;

  switch (name) {
    case 'AddBoardMember':
      return onBoard ? 'That address is already on the board.' : '';
    case 'AddProposer':
      if (proposer) return 'That address is already a proposer.';
      return onBoard && left < quorum ? tooFew : '';
    case 'RemoveUser':
      if (!onBoard && !proposer) {
        return 'That address is neither on the board nor a proposer, so there is nothing to remove.';
      }
      return onBoard && left < quorum ? tooFew : '';
    default:
      return '';
  }
};

/** A contract answer that is the contract refusing to decode, not the network failing. */
const isDecodeFailure = (error: unknown) =>
  /decode error|user error|execution failed|input too long/i.test(
    String((error as any)?.message ?? error ?? '')
  );

/** One action as the card needs it, from its decoded data and its signers. */
const pendingEntry = async (
  address: string,
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] },
  actionId: number,
  data: any,
  allSigners: any[]
): Promise<PendingAction> => {
  const board = new Set(state.boardMembers);
  const everyone: string[] = (allSigners ?? []).map(asAddress).filter(Boolean);
  const signers = everyone.filter((signer) => board.has(signer));
  const [description, inspection] = await Promise.all([
    describeAction(data, address),
    inspectAction(data, address)
  ]);
  return {
    actionId,
    name: String(data?.name ?? data?.type ?? ''),
    description: description + membershipNote(data, state as any),
    checks: inspection.checks,
    upgrade: inspection.upgrade,
    perform: inspection.perform,
    signerCount: signers.length,
    signers,
    formerSigners: everyone.filter((signer) => !board.has(signer)),
    quorumReached: signers.length >= (state.quorum ?? Number.MAX_SAFE_INTEGER)
  };
};

/**
 * The pending actions read one by one, for when the contract cannot return
 * them in one piece. A single stored action of about 12 KB makes
 * getPendingActionFullInfo fail to decode while every other action, and the
 * signers of that one, still answer by id (audit SC-01, proven on devnet,
 * 21 Oct 2026). Throws when the network itself does not answer.
 */
// Per safe, the action ids carried out or discarded. An id is never reused,
// so one that answered Nothing always will: it is read once, and kept through
// forget(), or a safe with a long history took minutes to read after every
// transaction (review of PR #11, 21 Oct 2026). Not the newest ids: a node a
// few seconds behind answers Nothing for an action proposed moments ago.
const finished = new Map<string, Set<number>>();
const ALWAYS_REREAD = 10;

const readPendingOneByOne = async (
  address: string,
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] }
): Promise<PendingAction[]> => {
  const last = asNumber(
    await cached(`actions:${address}`, () =>
      query<any>(address, 'getActionLastIndex')
    )
  );
  const board = new Set(state.boardMembers);
  const entries: PendingAction[] = [];
  const done = finished.get(address) ?? new Set<number>();
  finished.set(address, done);
  for (let id = 1; id <= last; id++) {
    if (done.has(id)) continue;
    let data: any = null;
    let unreadable = false;
    try {
      data = await cached(`action:${address}:${id}`, () =>
        query<any>(address, 'getActionData', [new U32Value(id)])
      );
    } catch (error) {
      if (!isDecodeFailure(error)) throw error;
      unreadable = true;
    }
    // Carried out or discarded: the contract keeps Nothing in its place.
    if (!unreadable && String(data?.name ?? data?.type ?? '') === 'Nothing') {
      if (id <= last - ALWAYS_REREAD) done.add(id);
      continue;
    }
    const signersAnswer = await cached(`signers:${address}:${id}`, () =>
      query<any>(address, 'getActionSigners', [new U32Value(id)])
    );
    const allSigners = Array.isArray(signersAnswer)
      ? signersAnswer
      : signersAnswer
        ? [signersAnswer]
        : [];
    if (!unreadable) {
      entries.push(await pendingEntry(address, state, id, data, allSigners));
      continue;
    }
    const everyone: string[] = allSigners.map(asAddress).filter(Boolean);
    const signers = everyone.filter((signer) => board.has(signer));
    entries.push({
      actionId: id,
      name: 'Unreadable',
      unreadable: true,
      description: `Action #${id} cannot be read: the contract fails to return its data, most likely because it carries more than about 9 KB. Nothing it would do can be shown, so do not sign it or carry it out.`,
      checks: [
        {
          tone: 'bad',
          text: 'Whoever signed it should remove their signature; then any board member or proposer can discard it. While it stays, the contract cannot list the pending actions in one piece, so this page reads them one by one.'
        }
      ],
      perform: { simulate: true },
      signerCount: signers.length,
      signers,
      formerSigners: everyone.filter((signer) => !board.has(signer)),
      quorumReached: false
    });
  }
  return entries;
};

/**
 * Actions still waiting for signatures, each turned into a sentence. A signer's
 * only defence against approving something unexpected is reading it in words,
 * so the decoding happens here, in describe.ts, rather than in a view.
 *
 * Only signatures from CURRENT board members count, exactly as the contract
 * counts them (display audit DISP-05). A failed read THROWS (DISP-11). When the
 * contract cannot return the list in one piece, it is read action by action
 * (SC-01).
 */
export const readPendingActions = async (
  address: string
): Promise<PendingAction[]> => {
  const state = await readMultisigState(address);
  if (state.quorum === null) {
    throw new Error('The board and quorum of this safe could not be read.');
  }
  let pending: any;
  try {
    pending = await cached(`pending:${address}`, () =>
      query<any>(address, 'getPendingActionFullInfo')
    );
  } catch (bulkError) {
    try {
      return await readPendingOneByOne(address, state as any);
    } catch {
      throw bulkError;
    }
  }
  const list = (
    Array.isArray(pending) ? pending : pending ? [pending] : []
  ).filter(Boolean);

  return Promise.all(
    list.map((action: any) =>
      pendingEntry(
        address,
        state as any,
        asNumber(action.action_id ?? action.actionId),
        action.action_data ?? action.actionData,
        action.signers ?? []
      )
    )
  );
};

export const formatRaw = (
  raw: bigint,
  decimals = 18,
  maximumFractionDigits = 4
) => {
  const amount = Number(raw) / Math.pow(10, decimals);
  return amount.toLocaleString('en-US', { maximumFractionDigits });
};

export const formatAmount = (
  value: unknown,
  decimals = 18,
  maximumFractionDigits = 4
) => formatRaw(toBigInt(value) ?? 0n, decimals, maximumFractionDigits);

export const shortAddress = (address: string, lead = 8, tail = 6) =>
  !address ? '' : `${address.slice(0, lead)}...${address.slice(-tail)}`;

/** The last transactions the safe took part in, newest first. */
export const readHistory = async (address: string): Promise<HistoryEntry[]> => {
  // A refused read throws, so the page keeps the history it had instead of
  // saying "No transactions found".
  const transactions = await api<any[]>(
    `/accounts/${address}/transactions?size=25&fields=txHash,timestamp,sender,function,status`
  );

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
export const readContractInfo = async (
  address: string
): Promise<ContractInfo> => {
  const account = await api<{ ownerAddress?: string; codeHash?: string }>(
    `/accounts/${address}`
  );
  return {
    ownerAddress: account?.ownerAddress ?? '',
    codeHash: account?.codeHash ?? '',
    exists: Boolean(account?.codeHash)
  };
};
