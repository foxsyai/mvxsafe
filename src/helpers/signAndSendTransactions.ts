import { setAccountNonce } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import {
  getAccountProvider,
  getLatestNonce,
  Transaction,
  TransactionComputer,
  TransactionManager,
  TransactionsDisplayInfoType
} from 'lib';
import { api } from 'multisig/network';

type SignAndSendTransactionsProps = {
  transactions: Transaction[];
  transactionsDisplayInfo?: TransactionsDisplayInfoType;
};

type Sent = Awaited<ReturnType<TransactionManager['send']>>;

/**
 * The nonce the wallet will sign the next transaction at. sdk-dapp raises
 * every nonce to its own latest one (computeNonces), which runs ahead of the
 * chain while a transaction from this tab still waits in the pool. A new
 * contract's address follows from the nonce its deploy is signed at, so it has
 * to be worked out from this number, not from the chain's (tx audit TXN-01,
 * 21 Oct 2026).
 */
export const nonceToSign = (chainNonce: number) => {
  try {
    return Math.max(chainNonce, getLatestNonce({ nonce: chainNonce } as any));
  } catch {
    return chainNonce;
  }
};

/**
 * Nothing of these reached the network, so the stored nonce goes back to the
 * first one they used. sdk-dapp moves it forward the moment the wallet signs;
 * left there, every later transaction in this tab would be signed one nonce
 * ahead, wait in the pool as "pending", and run the moment anything filled the
 * gap, long after the person thought it had failed (tx audit TX-08, proven on
 * devnet).
 */
export const windNonceBack = (transactions: Transaction[]) => {
  const first = transactions.reduce(
    (lowest, transaction) =>
      transaction.nonce < lowest ? transaction.nonce : lowest,
    transactions[0].nonce
  );
  setAccountNonce(Number(first));
};

/** What must come back from the wallet as it was built, before it is signed. */
const builtFields = (transaction: Transaction) => ({
  sender: transaction.sender.toBech32(),
  receiver: transaction.receiver.toBech32(),
  value: BigInt(transaction.value).toString(),
  data: Array.from(transaction.data).join(),
  chainID: transaction.chainID,
  guardian: transaction.guardian.isEmpty()
    ? ''
    : transaction.guardian.toBech32()
});

const FIELD_NAMES: Record<string, string> = {
  sender: 'its sender',
  receiver: 'its receiver',
  value: 'its value',
  data: 'its data',
  chainID: 'its network',
  guardian: 'its guardian'
};

/**
 * A wallet may raise the gas price (sdk-dapp's Fast and Faster options, the
 * network's own advice), but not without bound: the signer pays the price times
 * the gas, and a thousandfold price emptied a signer's EGLD in the audit of
 * 6 Nov 2026 (SNP-01). Ten times what was built stays far above any honest
 * option and caps a signature's cost at about a thousandth of an EGLD.
 */
export const GAS_PRICE_CEILING = 10n;

/**
 * What differs between what was built and what the wallet returned, if anything.
 * A transaction comes back through a browser extension, a wallet's window, the
 * guardian's two-factor page or a relay, and was sent as it came (tx audit
 * TXB-02, 1 Nov 2026). The version, the options and the signatures may differ:
 * a guardian added on the way is the wallet doing its work, one replaced is not.
 * So may the gas limit go up, as a guardian's does. Down it may not: a perform
 * with less than it was given runs out where it runs, and the action is used up.
 * The gas price may go up to the ceiling above. The nonce may not change at all:
 * sdk-dapp sets it before the wallet sees the transaction, and one moved ahead
 * waits in the pool and runs when the gap fills, at a moment nobody chose (SNP-02).
 */
const differenceFrom = (
  built: ReturnType<typeof builtFields>[],
  gasLimits: bigint[],
  gasPrices: bigint[],
  nonces: bigint[],
  signed: Transaction[]
): string => {
  if (signed.length !== built.length) return 'not the same number of them';
  for (const [at, fields] of built.entries()) {
    const back = builtFields(signed[at]) as Record<string, string>;
    for (const [field, value] of Object.entries(fields)) {
      if (field === 'guardian' && !value) continue;
      if (back[field] !== value) return FIELD_NAMES[field];
    }
    if (BigInt(signed[at].gasLimit) < gasLimits[at]) return 'its gas limit';
    if (BigInt(signed[at].gasPrice) > gasPrices[at] * GAS_PRICE_CEILING) {
      return 'its gas price';
    }
    if (BigInt(signed[at].nonce) !== nonces[at]) return 'its nonce';
  }
  return '';
};

/** Signs, and returns only what is what was built. Nothing is sent otherwise. */
export const signOnly = async (transactions: Transaction[]) => {
  const built = transactions.map(builtFields);
  const gasLimits = transactions.map(({ gasLimit }) => BigInt(gasLimit));
  const gasPrices = transactions.map(({ gasPrice }) => BigInt(gasPrice));
  const signed = await getAccountProvider().signTransactions(transactions);
  // sdk-dapp has set the nonces on what it was given by now.
  const nonces = transactions.map(({ nonce }) => BigInt(nonce));
  const different = differenceFrom(built, gasLimits, gasPrices, nonces, signed);
  if (different) {
    // sdk-dapp sets the nonces on what it was given, so these say where it began.
    windNonceBack(transactions);
    throw new Error(
      `your wallet returned something other than what was built here (${different} differs), so nothing was sent.`
    );
  }
  return signed;
};

/** The request ended without the network's answer, which is no answer at all. */
export const isLostAnswer = (failure: unknown) =>
  /timeout|timed out|network ?error|failed to fetch|socket hang up|ECONN/i.test(
    String((failure as any)?.message ?? failure ?? '')
  );

const hashOf = (transaction: Transaction) =>
  new TransactionComputer().computeTransactionHash(transaction);

/**
 * Does the network hold these? Only the hash says so. An account's nonce moving
 * past one proves nothing about it: another tab or a phone may have used that
 * nonce (review of PR #20).
 */
const networkHolds = async (signed: Transaction[]) => {
  const answered = await Promise.all(
    signed.map((transaction) =>
      api(`/transactions/${hashOf(transaction)}`).then(
        () => true,
        () => false
      )
    )
  );
  return answered.every(Boolean);
};

// A transaction takes a moment to show up, and a dead API must not hold the page.
const LOOK_AFTER_MS = [0, 1500, 3000];
const LOOK_AT_MOST_MS = 20000;

const heldAfterAll = (signed: Transaction[]) =>
  Promise.race([
    (async () => {
      for (const delay of LOOK_AFTER_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (await networkHolds(signed)) return true;
      }
      return false;
    })(),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), LOOK_AT_MOST_MS)
    )
  ]);

/** What was sent, as the network would have answered had the answer arrived. */
const sentWithoutAnswer = (signed: Transaction[]) =>
  signed.map((transaction) => ({
    ...transaction.toPlainObject(),
    hash: hashOf(transaction),
    status: 'pending'
  })) as unknown as Sent;

/**
 * For what sendSigned gave up on and something else then proved delivered: the
 * transactions count as sent again, with the nonce past them.
 */
export const provenSent = (signed: Transaction[]) => {
  setAccountNonce(Number(signed[signed.length - 1].nonce) + 1);
  return sentWithoutAnswer(signed);
};

/**
 * Sends what was signed. If the send fails, the nonce is wound back to it,
 * unless only the answer was lost: a POST accepted and answered after the
 * timeout read as never sent, and a new safe was forgotten at an address nobody
 * wrote down (tx audit TXB-03, 1 Nov 2026). The network is asked first.
 */
export const sendSigned = async (signed: Transaction[]) => {
  try {
    return await TransactionManager.getInstance().send(signed);
  } catch (failure) {
    if (isLostAnswer(failure) && (await heldAfterAll(signed))) {
      return sentWithoutAnswer(signed);
    }
    windNonceBack(signed);
    throw failure;
  }
};

/** Shows a toast for what was sent, and tells the pages when it has settled. */
export const trackSent = async (
  signed: Transaction[],
  sent: Sent,
  transactionsDisplayInfo?: TransactionsDisplayInfoType
) => {
  // Sending only puts the transaction on the network. Pages that show what the
  // chain holds have to read it again once it has been processed, otherwise a
  // proposal looks like it did nothing until somebody presses Refresh
  // (6 Oct 2026).
  // Which safes changed: the receivers (a safe for every multisig call, the
  // new safe for a handover), so pages re-read those and nothing else.
  const addresses = [
    ...new Set(signed.map((transaction) => transaction.receiver.toBech32()))
  ];
  let settledAt = 0;
  const settled = async () => {
    settledAt = Date.now();
    window.dispatchEvent(
      new CustomEvent('mvxsafe:settled', { detail: { addresses } })
    );
  };
  // The clock is a safety net: skipped when the SDK reported it moments ago.
  const settledOnClock = () => {
    if (Date.now() - settledAt > 5000) settled();
  };
  const sessionId = await TransactionManager.getInstance().track(sent, {
    transactionsDisplayInfo,
    onSuccess: settled,
    onFail: settled
  });
  // And twice more on a clock, which does not depend on the SDK's socket or on
  // the page that sent it still being open: a block takes about six seconds,
  // a cross-shard result a little longer.
  setTimeout(settledOnClock, 7000);
  setTimeout(settledOnClock, 16000);

  return sessionId;
};

export const signAndSendTransactions = async ({
  transactions,
  transactionsDisplayInfo
}: SignAndSendTransactionsProps) => {
  const signed = await signOnly(transactions);
  return trackSent(signed, await sendSigned(signed), transactionsDisplayInfo);
};
