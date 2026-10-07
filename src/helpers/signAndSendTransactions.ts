import { setAccountNonce } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import {
  getAccountProvider,
  Transaction,
  TransactionManager,
  TransactionsDisplayInfoType
} from 'lib';

type SignAndSendTransactionsProps = {
  transactions: Transaction[];
  transactionsDisplayInfo?: TransactionsDisplayInfoType;
};

export const signAndSendTransactions = async ({
  transactions,
  transactionsDisplayInfo
}: SignAndSendTransactionsProps) => {
  const provider = getAccountProvider();
  const txManager = TransactionManager.getInstance();

  const signedTransactions = await provider.signTransactions(transactions);
  let sentTransactions;
  try {
    sentTransactions = await txManager.send(signedTransactions);
  } catch (failure) {
    // sdk-dapp moves its stored nonce forward the moment the wallet signs. When
    // the send then fails, nothing reached the network, but every later
    // transaction in this tab would be signed one nonce ahead, wait in the pool
    // as "pending", and run the moment anything filled the gap, long after the
    // person thought it had failed (tx audit TX-08, proven on devnet). So the
    // nonce goes back to the first one this attempt used.
    const first = transactions.reduce(
      (lowest, transaction) => (transaction.nonce < lowest ? transaction.nonce : lowest),
      transactions[0].nonce
    );
    setAccountNonce(Number(first));
    throw failure;
  }
  // Sending only puts the transaction on the network. Pages that show what the
  // chain holds have to read it again once it has been processed, otherwise a
  // proposal looks like it did nothing until somebody presses Refresh
  // (6 Oct 2026).
  // Which safes changed: the receivers (a safe for every multisig call, the
  // new safe for a handover), so pages re-read those and nothing else.
  const addresses = [...new Set(transactions.map((transaction) => transaction.receiver.toBech32()))];
  let settledAt = 0;
  const settled = async () => {
    settledAt = Date.now();
    window.dispatchEvent(new CustomEvent('mvxsafe:settled', { detail: { addresses } }));
  };
  // The clock is a safety net: skipped when the SDK reported it moments ago.
  const settledOnClock = () => {
    if (Date.now() - settledAt > 5000) settled();
  };
  const sessionId = await txManager.track(sentTransactions, {
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
