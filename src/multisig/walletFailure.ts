// Turning what a wallet throws into something a person can act on.
// A wallet can fail in three different ways and they need different answers, so
// a refusal is told apart from a connection that died. Anything else is shown as
// it came, and always written to the console, because a sentence on screen is
// not enough to debug a wallet.
export const explainWalletFailure = (failure: unknown, what: string): string => {
  const message = String((failure as any)?.message ?? failure ?? '');
  // eslint-disable-next-line no-console
  console.error('mvxsafe wallet failure:', failure);
  if (/user\s*(rejected|denied|cancel)|rejected by user|action_rejected|cancelled by user/i.test(message))
    return 'You refused it in your wallet, nothing was sent.';
  if (/session|topic|relay|connection closed|disconnected|no matching key|expired/i.test(message))
    return 'The connection to your wallet was lost. Disconnect, connect again, and try once more.';
  if (!message) return `${what} did not go through, and the wallet gave no reason. Try again.`;
  return `${what} did not go through: ${message.slice(0, 200)}`;
};
