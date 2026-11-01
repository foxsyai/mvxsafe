import { setAccountNonce } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import {
  getAccountProvider,
  getLatestNonce,
  Transaction,
  TransactionManager,
  TransactionsDisplayInfoType
} from 'lib';

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
 * What differs between what was built and what the wallet returned, if anything.
 * A transaction comes back through a browser extension, a wallet's window, the
 * guardian's two-factor page or a relay, and was sent as it came (tx audit
 * TXB-02, 1 Nov 2026). The nonce may differ, since sdk-dapp sets it itself, and
 * so may the gas price, the version, the options and the signatures: a guardian
 * added on the way is the wallet doing its work, one replaced is not.
 */
const differenceFrom = (
  built: ReturnType<typeof builtFields>[],
  signed: Transaction[]
): string => {
  if (signed.length !== built.length) return 'not the same number of them';
  for (const [at, fields] of built.entries()) {
    const back = builtFields(signed[at]) as Record<string, string>;
    for (const [field, value] of Object.entries(fields)) {
      if (field === 'guardian' && !value) continue;
      if (back[field] !== value) return FIELD_NAMES[field];
    }
  }
  return '';
};

/** Signs, and returns only what is what was built. Nothing is sent otherwise. */
export const signOnly = async (transactions: Transaction[]) => {
  const built = transactions.map(builtFields);
  const signed = await getAccountProvider().signTransactions(transactions);
  const different = differenceFrom(built, signed);
  if (different) {
    // sdk-dapp sets the nonces on what it was given, so these say where it began.
    windNonceBack(transactions);
    throw new Error(
      `your wallet returned something other than what was built here (${different} differs), so nothing was sent.`
    );
  }
  return signed;
};

/** Sends what was signed. If the send fails, the nonce is wound back to it. */
export const sendSigned = async (signed: Transaction[]) => {
  try {
    return await TransactionManager.getInstance().send(signed);
  } catch (failure) {
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
