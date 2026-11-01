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
import {
  Check,
  inspectAction,
  Inspection,
  uncheckedAction,
  UpgradeFacts
} from './inspect';
import {
  legacyAbi,
  MULTISIG_CODE_HASH,
  normalizeCodeHash
} from './legacyCalls';
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
  /** For a membership action: the address it gives a role or takes one from. */
  subject?: string;
  /**
   * True when the card was listed before its checks: `checks`, `upgrade` and
   * `perform` come from readCardChecks, and until they have, nothing may be
   * signed or carried out on it. Absent on actions built by older code and tests.
   */
  checksDue?: boolean;
  /** What the contract holds for this action, which readCardChecks reads. */
  data?: any;
  /** Signatures that count: only from addresses on the board today. */
  signerCount: number;
  /** Everyone who signed and still sits on the board. */
  signers: string[];
  /** Who signed and has since left the board. The contract ignores them. */
  formerSigners: string[];
  quorumReached: boolean;
}

/**
 * How far a list of pending actions reaches. A list that stops short says so
 * here, so that nothing can read it as complete (audits FND-02 and RED-03).
 */
export interface PendingCoverage {
  /** How many are waiting in all. Null until that is known. */
  pendingCount: number | null;
  /** Known to be waiting, older than the cards in the list. */
  olderKnown: number;
  /** Action numbers older than the cards in the list, not read at all. */
  olderUnread: number;
  /** True when the contract could not list them in one piece. */
  oneByOne: boolean;
  /** "Load more" goes on with the numbers below this one. */
  nextBefore: number;
  /** The network stopped answering part way through this read. */
  interrupted: boolean;
}

/** The cards, oldest first, and how far they reach (absent in older tests). */
export type PendingList = PendingAction[] & { coverage?: PendingCoverage };

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

/** A view's answer as a list: one item comes back alone, none as nothing. */
const asList = (answer: any): any[] =>
  (Array.isArray(answer) ? answer : answer ? [answer] : []).filter(Boolean);

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
  /** Whether the code behind this address is the multisig mvxsafe knows. */
  identity?: SafeIdentity;
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
  // The account's answer is shared with readBalances: no request more.
  const [balances, egldPrice, info] = await Promise.all([
    readBalances(address, false),
    readEgldPrice(),
    readContractInfo(address)
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
    readyCount: null,
    identity: identityOf(info.codeHash)
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
    const list = asList(pending.value);
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
    // The count only: the cards are read on their own, and a contract that
    // cannot list them in one piece leaves it to them to say how far they got.
    cached(`pending:${address}`, () =>
      query<any>(address, 'getPendingActionFullInfo')
    )
      .then(asList)
      .catch(() => null),
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

/** A board seat for something that is not a person's wallet (RED-06, 1 Nov 2026). */
const seatNotes = (who: string, safe: string): string[] => {
  if (who === safe) {
    return [
      'this is THIS SAFE itself: with a seat on its own board, a call on the safe can sign for the board'
    ];
  }
  try {
    return Address.newFromBech32(who).isSmartContract()
      ? [
          'this is a contract, not a wallet: it signs only through its own code, so whoever can change that code holds this seat'
        ]
      : [];
  } catch {
    return [];
  }
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
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] },
  safe = ''
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
      {
        const notes = [
          proposer ? 'a proposer today: the board seat replaces that role' : '',
          ...seatNotes(who, safe)
        ].filter(Boolean);
        return notes.length > 0 ? ` (${notes.join('; ')})` : '';
      }
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

/** What is known of one action without asking the network anything. */
const actionFacts = (
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] },
  actionId: number,
  data: any,
  allSigners: any[]
): PendingAction => {
  const board = new Set(state.boardMembers);
  const everyone: string[] = (allSigners ?? []).map(asAddress).filter(Boolean);
  const signers = everyone.filter((signer) => board.has(signer));
  const name = String(data?.name ?? data?.type ?? '');
  return {
    actionId,
    name,
    description: '',
    checksDue: true,
    data,
    subject: MEMBERSHIP_ACTIONS.has(name)
      ? asAddress(data?.fields?.[0])
      : undefined,
    signerCount: signers.length,
    signers,
    formerSigners: everyone.filter((signer) => !board.has(signer)),
    quorumReached: signers.length >= (state.quorum ?? Number.MAX_SAFE_INTEGER)
  };
};

/** The same action with its sentence, which can need a token's decimals. */
const describedEntry = async (
  address: string,
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] },
  facts: PendingAction
): Promise<PendingAction> => ({
  ...facts,
  description:
    (await describeAction(facts.data, address)) +
    membershipNote(facts.data, state as any, address)
});

/**
 * What a card shows under its sentence, read from the chain only for the cards
 * on the page: a call is tried as the safe and a contract's code is read, and a
 * flood of proposals must not pay for that before anyone sees a card (audits
 * FND-02 and RED-03, 1 Nov 2026). A check that failed says so; it never reads
 * as no check.
 */
export const readCardChecks = async (
  address: string,
  action: PendingAction
): Promise<Inspection> => {
  try {
    return await inspectAction(action.data, address);
  } catch {
    return uncheckedAction();
  }
};

const MEMBERSHIP_ACTIONS = new Set([
  'AddBoardMember',
  'AddProposer',
  'RemoveUser'
]);

const listIds = (actions: PendingAction[]) => {
  const ids = actions.map((action) => `#${action.actionId}`);
  return ids.length > 1
    ? `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
    : ids[0];
};

/**
 * A signature is kept against the signer's id, whatever role they hold later,
 * and the contract counts the ids on the board today. So a former member's old
 * signatures stop counting while they are off the board, and all come back the
 * moment they are given a seat again, promotion from proposer included. That
 * can be the last step to a quorum, and the card of the action giving the seat
 * says so (audit FND-01, proven on devnet, 1 Nov 2026). It looks through the
 * actions it was given.
 */
const withSeatChecks = (
  entries: PendingAction[],
  state: { quorum: number | null; boardMembers: string[] },
  /** Every action known, the cards' own and those not on the page. */
  among: PendingAction[],
  olderUnread: number
): PendingAction[] => {
  const quorum = state.quorum ?? Number.MAX_SAFE_INTEGER;
  return entries.map((listed) => {
    // A list can be built again as more of it is read.
    const entry = {
      ...listed,
      checks: listed.checks?.filter((check) => !check.aboutSeats)
    };
    const who = entry.subject;
    if (!who) return entry;
    const others = among.filter((other) => other.actionId !== entry.actionId);
    const onBoard = state.boardMembers.includes(who);
    let check: Check | null = null;
    if (entry.name === 'AddBoardMember' && !onBoard) {
      const revived = others.filter((other) =>
        other.formerSigners.includes(who)
      );
      if (revived.length > 0) {
        const tally = revived
          .map(
            (other) =>
              `#${other.actionId} then has ${other.signerCount + 1} of ${quorum} signatures`
          )
          .join(', ');
        const ready = revived.filter(
          (other) => !other.quorumReached && other.signerCount + 1 >= quorum
        );
        check = {
          tone: ready.length > 0 ? 'bad' : 'warn',
          text:
            `${who} signed ${listIds(revived)} before leaving the board. ` +
            `${revived.length > 1 ? 'Those signatures count' : 'That signature counts'} again once this is carried out: ${tally}.` +
            (ready.length > 0
              ? ` ${listIds(ready)} could then be carried out at once.`
              : '')
        };
      }
    } else if (entry.name !== 'AddBoardMember' && onBoard) {
      const signed = others.filter((other) => other.signers.includes(who));
      if (signed.length > 0) {
        const tally = signed
          .map(
            (other) =>
              `#${other.actionId} then has ${other.signerCount - 1} of ${quorum} signatures`
          )
          .join(', ');
        check = {
          tone: 'warn',
          text:
            `${who} signed ${listIds(signed)}. ` +
            `${signed.length > 1 ? 'Those signatures stop' : 'That signature stops'} counting once this is carried out: ${tally}. ` +
            `They are not erased: if ${who} is given a board seat again, they count again on whatever is still pending.`
        };
      }
    }
    const lines = check ? [{ ...check, aboutSeats: true }] : [];
    // Signatures on an action nobody has read cannot be counted here.
    if (
      olderUnread > 0 &&
      ((entry.name === 'AddBoardMember' && !onBoard) ||
        (entry.name !== 'AddBoardMember' && onBoard))
    ) {
      lines.push({
        tone: 'warn',
        aboutSeats: true,
        text: `${olderUnread.toLocaleString('en-US')} older action numbers have not been read, so any signature of ${who} on one of them is not counted here. Load more before relying on this.`
      });
    }
    return lines.length > 0
      ? { ...entry, checks: [...(entry.checks ?? []), ...lines] }
      : entry;
  });
};

/** What has been read so far, oldest first, the older reads' cards included. */
const mergedCards = (known: PendingAction[], cards: PendingAction[]) => {
  const read = new Set(cards.map((card) => card.actionId));
  return [...known.filter((card) => !read.has(card.actionId)), ...cards].sort(
    (a, b) => a.actionId - b.actionId
  );
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
/** How many action numbers one pass reads at most, one by one. */
const SCAN_PASS = 300;

/** How many cards one read brings: the newest, and "load more" for the rest. */
export const PENDING_PAGE = 20;

export interface PendingReadOptions {
  /** Read only the actions older than this number. */
  before?: number;
  /** How many cards to bring. */
  limit?: number;
  /** The cards already on the page, which an older page joins. */
  known?: PendingAction[];
  onProgress?: (list: PendingList) => void;
}

const readPendingOneByOne = async (
  address: string,
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] },
  { before, limit = PENDING_PAGE, known = [], onProgress }: PendingReadOptions
): Promise<PendingList> => {
  const last = asNumber(
    await cached(`actions:${address}`, () =>
      query<any>(address, 'getActionLastIndex')
    )
  );
  const board = new Set(state.boardMembers);
  const cards: PendingAction[] = [];
  const done = finished.get(address) ?? new Set<number>();
  finished.set(address, done);
  // A rogue's flood must not decide how long the page waits, so one pass reads
  // the newest numbers and stops: at a page of cards, or at a limit of numbers
  // for a long history of finished actions (audits FND-02 and RED-03).
  const budget = Math.max(SCAN_PASS, limit * 3);
  let scanned = 0;
  let id = before === undefined ? last : Math.min(before - 1, last);
  let interrupted = false;

  const listSoFar = (): PendingList => {
    let olderUnread = Math.max(id, 0);
    done.forEach((finishedId) => {
      if (finishedId <= id) olderUnread--;
    });
    const all = mergedCards(known, cards);
    return Object.assign(withSeatChecks(all, state, all, olderUnread), {
      coverage: {
        pendingCount: olderUnread === 0 && !interrupted ? all.length : null,
        olderKnown: 0,
        olderUnread,
        oneByOne: true,
        nextBefore: id + 1,
        interrupted
      }
    });
  };

  while (id >= 1 && cards.length < limit && scanned < budget) {
    if (done.has(id)) {
      id--;
      continue;
    }
    scanned++;
    const actionId = id;
    try {
      let data: any = null;
      let unreadable = false;
      try {
        data = await cached(`action:${address}:${actionId}`, () =>
          query<any>(address, 'getActionData', [new U32Value(actionId)])
        );
      } catch (error) {
        if (!isDecodeFailure(error)) throw error;
        unreadable = true;
      }
      // Carried out or discarded: the contract keeps Nothing in its place.
      if (!unreadable && String(data?.name ?? data?.type ?? '') === 'Nothing') {
        if (actionId <= last - ALWAYS_REREAD) done.add(actionId);
      } else {
        const allSigners = asSigners(
          await cached(`signers:${address}:${actionId}`, () =>
            query<any>(address, 'getActionSigners', [new U32Value(actionId)])
          )
        );
        cards.push(
          unreadable
            ? unreadableEntry(state, board, actionId, allSigners)
            : await describedEntry(
                address,
                state,
                actionFacts(state, actionId, data, allSigners)
              )
        );
      }
    } catch (error) {
      // Nothing read at all is a failed read, as it always was. What was read
      // stays on the page, and the list says where it stopped.
      if (cards.length === 0 && known.length === 0) throw error;
      interrupted = true;
      break;
    }
    id--;
    onProgress?.(listSoFar());
  }
  return listSoFar();
};

const asSigners = (answer: any): any[] =>
  Array.isArray(answer) ? answer : answer ? [answer] : [];

const unreadableEntry = (
  state: { quorum: number | null; boardMembers: string[]; proposers: string[] },
  board: Set<string>,
  actionId: number,
  allSigners: any[]
): PendingAction => {
  const everyone: string[] = allSigners.map(asAddress).filter(Boolean);
  const signers = everyone.filter((signer) => board.has(signer));
  return {
    actionId,
    name: 'Unreadable',
    unreadable: true,
    description: `Action #${actionId} cannot be read: the contract fails to return its data, most likely because it carries more than about 9 KB. Nothing it would do can be shown, so do not sign it or carry it out.`,
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
  };
};

/**
 * Actions still waiting for signatures, newest page only, each turned into a
 * sentence. A signer's only defence against approving something unexpected is
 * reading it in words, so the decoding happens here, in describe.ts, rather
 * than in a view. The checks under the sentence are read apart, for the cards
 * on the page (readCardChecks), and `coverage` on the list says what is not in
 * it: anyone with a proposer's seat can file thousands of actions for a few
 * cents, so the page never waits for all of them (FND-02, RED-03).
 *
 * Only signatures from CURRENT board members count, exactly as the contract
 * counts them (display audit DISP-05). A failed read THROWS (DISP-11). When the
 * contract cannot return the list in one piece, it is read action by action
 * (SC-01), newest first. onProgress gets the list as far as it was read, so a
 * card shows as soon as its sentence is known.
 */
export const readPendingActions = async (
  address: string,
  options: PendingReadOptions = {}
): Promise<PendingList> => {
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
      return await readPendingOneByOne(address, state as any, options);
    } catch {
      throw bulkError;
    }
  }

  const { before, limit = PENDING_PAGE, known = [], onProgress } = options;
  // Everything but the sentences costs nothing, so signatures on actions that
  // are not on the page still count on the cards that are.
  const all = asList(pending)
    .map((action: any) =>
      actionFacts(
        state as any,
        asNumber(action.action_id ?? action.actionId),
        action.action_data ?? action.actionData,
        action.signers ?? []
      )
    )
    .sort((a, b) => a.actionId - b.actionId);
  const waiting = all.filter(
    (action) => before === undefined || action.actionId < before
  );
  const page = waiting.slice(-limit);
  const coverage: PendingCoverage = {
    pendingCount: all.length,
    olderKnown: waiting.length - page.length,
    olderUnread: 0,
    oneByOne: false,
    nextBefore: page[0]?.actionId ?? before ?? 0,
    interrupted: false
  };
  const cards: PendingAction[] = [];
  const listSoFar = (): PendingList =>
    Object.assign(withSeatChecks(mergedCards(known, cards), state, all, 0), {
      coverage
    });
  await Promise.all(
    page.map(async (facts) => {
      cards.push(await describedEntry(address, state as any, facts));
      onProgress?.(listSoFar());
    })
  );
  return listSoFar();
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
  /** Null when the API did not say. */
  upgradeable: boolean | null;
}

/**
 * Ownership and code of a contract. A safe that is not its own owner can have
 * its code replaced by that owner alone, whatever the board thinks, so the page
 * says so in red.
 */
export const readContractInfo = async (
  address: string
): Promise<ContractInfo> => {
  const account = await api<{
    ownerAddress?: string;
    codeHash?: string;
    isUpgradeable?: boolean;
  }>(`/accounts/${address}`);
  return {
    ownerAddress: account?.ownerAddress ?? '',
    codeHash: account?.codeHash ?? '',
    exists: Boolean(account?.codeHash),
    upgradeable:
      typeof account?.isUpgradeable === 'boolean' ? account.isUpgradeable : null
  };
};

/**
 * Is this the multisig mvxsafe was built for? Everything on a safe's page, the
 * board, the quorum and every sentence, is decoded for that one code, and any
 * other contract can answer the same views with anything it likes (audits
 * SGN-01 and RED-01, 1 Nov 2026). No hash is not a verdict on the code: it
 * could not be verified.
 */
export type SafeIdentity = 'known' | 'other' | 'unverified';

export const identityOf = (codeHash?: string | null): SafeIdentity => {
  const hash = normalizeCodeHash(codeHash ?? '');
  if (!hash) return 'unverified';
  return hash === normalizeCodeHash(MULTISIG_CODE_HASH) ? 'known' : 'other';
};

/** The same words on the safe's page and on its card in the list. */
export const IDENTITY_LINE = {
  other:
    'This contract does not run the multisig code mvxsafe knows. mvxsafe does not know this code, so what is shown here comes from the contract itself and is only its own word.',
  unverified:
    "This contract could not be verified as the multisig mvxsafe knows: the network's API did not give its code hash just now. Until it does, what is shown here comes from the contract itself."
};
