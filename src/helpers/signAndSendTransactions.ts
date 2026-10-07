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
  const settled = async () => {
    window.dispatchEvent(new CustomEvent('mvxsafe:settled'));
  };
  const sessionId = await txManager.track(sentTransactions, {
    transactionsDisplayInfo,
    onSuccess: settled,
    onFail: settled
  });

  return sessionId;
};
