// Reading a safe. Nothing here signs or sends anything: every call below is a
// view on the contract or a GET on the public API.

import { api, cached, multisig } from './network';

export interface TokenBalance {
  identifier: string;
  ticker: string;
  name: string;
  balance: string;
  decimals: number;
  /** The balance as a human number, already divided by the decimals. */
  amount: number;
}

export interface SafeOverview {
  address: string;
  egld: number;
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

interface AccountResponse {
  balance: string;
  codeHash?: string;
}

interface TokenResponse {
  identifier: string;
  ticker?: string;
  name?: string;
  balance: string;
  decimals?: number;
}

/** The numbers behind one safe, enough for a card in the list. */
export const readBalances = async (address: string) => {
  const [account, tokens, nftCount] = await Promise.all([
    api<AccountResponse>(`/accounts/${address}`),
    api<TokenResponse[]>(`/accounts/${address}/tokens?size=50`),
    api<number>(`/accounts/${address}/nfts/count`).catch(() => 0)
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
      amount: toNumber(token.balance, token.decimals ?? 18)
    }))
  };
};

/**
 * The multisig side: who is on the board, how many signatures an action needs
 * and how many actions are waiting. A plain address that is not a multisig
 * answers with an error, which is reported as quorum null rather than a crash.
 */
export const readMultisigState = async (address: string) => {
  try {
    const [quorum, boardMembers, proposerCount, actionCount] = await Promise.all([
      cached(`quorum:${address}`, () => multisig.getQuorum({ multisigAddress: address })),
      cached(`board:${address}`, () =>
        multisig.getAllBoardMembers({ multisigAddress: address })
      ),
      cached(`proposers:${address}`, () =>
        multisig.getNumProposers({ multisigAddress: address })
      ),
      cached(`actions:${address}`, () =>
        multisig.getActionLastIndex({ multisigAddress: address })
      )
    ]);

    return {
      quorum: Number(quorum),
      // The typings say string[], the runtime hands back Address objects.
      // Accept both rather than trusting either.
      boardMembers: boardMembers.map((member: any) =>
        typeof member?.toBech32 === 'function' ? member.toBech32() : String(member)
      ),
      proposerCount: Number(proposerCount),
      actionCount: Number(actionCount)
    };
  } catch {
    return { quorum: null, boardMembers: [], proposerCount: 0, actionCount: 0 };
  }
};

export const readOverview = async (address: string): Promise<SafeOverview> => {
  const [balances, state, pending] = await Promise.all([
    readBalances(address),
    readMultisigState(address),
    readPendingActions(address)
  ]);

  return {
    address,
    ...balances,
    ...state,
    pendingCount: pending.length
  };
};

/**
 * Actions still waiting for signatures. The contract returns them decoded by
 * the ABI; turning each one into a readable sentence is the signer's only
 * defence against approving something they did not expect, so it happens here
 * rather than in the view.
 */
export const readPendingActions = async (address: string): Promise<PendingAction[]> => {
  try {
    const pending = await cached(`pending:${address}`, () =>
      multisig.getPendingActionFullInfo({ multisigAddress: address })
    );

    return pending.map((action: any) => {
      const signers: string[] = (action.signers ?? []).map((signer: any) =>
        typeof signer?.toBech32 === 'function' ? signer.toBech32() : String(signer)
      );

      return {
        actionId: Number(action.actionId ?? action.action_id ?? 0),
        description: describeAction(action.actionData ?? action.action_data ?? action),
        signerCount: signers.length,
        signers,
        quorumReached: Boolean(action.quorumReached)
      };
    });
  } catch {
    return [];
  }
};

/**
 * Plain language for one action. The ABI gives typed data, not sentences, and a
 * signer should never have to read hex to know what they are approving.
 * Anything this function does not recognise is reported as unknown rather than
 * guessed at, which is the safe failure.
 */
export const describeAction = (action: any): string => {
  if (!action || typeof action !== 'object') return 'Unknown action';
  const type = String(action.type ?? action.name ?? 'Unknown');

  switch (type) {
    case 'AddBoardMember':
      return `Add ${shortAddress(asAddress(action.address))} to the board`;
    case 'AddProposer':
      return `Add ${shortAddress(asAddress(action.address))} as a proposer`;
    case 'RemoveUser':
      return `Remove ${shortAddress(asAddress(action.address))}`;
    case 'ChangeQuorum':
      return `Change the quorum to ${Number(action.newQuorum ?? action.quorum ?? 0)}`;
    case 'SendTransferExecuteEgld':
      return `Send ${formatAmount(action.data?.egldAmount ?? action.egldAmount, 18)} EGLD to ${shortAddress(
        asAddress(action.data?.to ?? action.to)
      )}`;
    case 'SendTransferExecuteEsdt':
      return `Send tokens to ${shortAddress(asAddress(action.data?.to ?? action.to))}`;
    case 'SendAsyncCall':
      return `Call a contract at ${shortAddress(asAddress(action.data?.to ?? action.to))}`;
    case 'Nothing':
      return 'Already carried out or discarded';
    default:
      return `Unknown action (${type})`;
  }
};

const asAddress = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toBech32 === 'function') return value.toBech32();
  return String(value);
};

export const formatAmount = (value: unknown, decimals = 18, maximumFractionDigits = 4) => {
  const raw = typeof value === 'bigint' ? value : BigInt(String(value ?? 0));
  const amount = Number(raw) / Math.pow(10, decimals);
  return amount.toLocaleString('en-US', { maximumFractionDigits });
};

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
