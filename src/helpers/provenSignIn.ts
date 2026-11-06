// From lib's own modules, not its index: tests stand in for the index.
import { Address, Message, MessageComputer, UserVerifier } from 'lib/sdkCore';
import {
  getAccount,
  getAccountProvider,
  getLoginInfo,
  logoutAction,
  ToastManager
} from 'lib/sdkDapp/sdkDapp.helpers';

// A wallet's answer to a sign-in names the address the app then acts as, and
// sdk-dapp takes it at its word: it never checks the signature, and it puts a
// `multisig` or `impersonate` address from the answer in place of the key that
// signed (audit of 6 Nov 2026, SIN-01). So after every sign-in the app checks
// it itself: the session's address must be the key whose signature is over
// `address + login token`, the message wallets sign for native auth, or
// `address + login token + "{}"`, which is what a Ledger signs: sdk-dapp's Ledger
// login hands the device the token with "{}" appended (review of PR #25). These
// two forms, and no other, are what sdk-native-auth-server accepts.

/** How long the wallet's own logout is waited for before the session is cleared here. */
export const LOGOUT_WAIT_MS = 5000;

/** What is wrong with the sign-in this tab holds, or '' when it is proven. */
export const signInProblem = async (): Promise<string> => {
  const { address } = getAccount();
  const { tokenLogin } = getLoginInfo();
  if (!address || !tokenLogin?.loginToken || !tokenLogin.signature) {
    return 'your wallet did not prove this address';
  }
  try {
    const verifier = UserVerifier.fromAddress(new Address(address));
    const signature = Buffer.from(tokenLogin.signature, 'hex');
    for (const signedText of [
      `${address}${tokenLogin.loginToken}`,
      `${address}${tokenLogin.loginToken}{}`
    ]) {
      const message = new Message({
        address: new Address(address),
        data: Buffer.from(signedText)
      });
      const bytes = new MessageComputer().computeBytesForVerifying(message);
      if (await verifier.verify(bytes, signature)) {
        return '';
      }
    }
    return 'the sign-in signature is not this address';
  } catch {
    return 'the sign-in signature could not be read';
  }
};

/**
 * Called when a wallet has signed in: an unproven session is ended at once and
 * the signer is told why. The unlock panel swallows what a handler throws, so
 * this logs out itself.
 */
export const afterSignIn = async () => {
  const problem = await signInProblem();
  if (!problem) {
    return '';
  }
  // The wallet is told, but the session ends whatever it answers: a logout that
  // fails or never returns would leave the unproven address signed in.
  await Promise.race([
    getAccountProvider()
      .logout()
      .catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, LOGOUT_WAIT_MS))
  ]);
  if (getAccount().address) {
    logoutAction();
  }
  await ToastManager.getInstance()
    .createCustomToast({
      toastId: 'mvxsafe-sign-in-refused',
      title: 'Sign-in refused',
      message: `mvxsafe disconnected your wallet: ${problem}. Nothing was signed or sent.`,
      hasCloseButton: true
    })
    .catch(() => undefined);
  return problem;
};
