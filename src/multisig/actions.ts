// Sending something. Each function builds one transaction with the legacy
// builders in legacyCalls.js, hands it to the connected wallet to sign, and
// tracks it. Nothing here holds a key.

import { Address, TransactionComputer } from '@multiversx/sdk-core';
import { signAndSendTransactions } from 'helpers/signAndSendTransactions';
import { api, chainId, networkProvider } from './network';
import {
  buildDeploySafe,
  buildDiscard,
  buildHandOver,
  buildPerform,
  buildProposeAddBoardMember,
  buildProposeAddProposer,
  buildProposeChangeQuorum,
  buildProposeEgld,
  buildProposeRemoveUser,
  buildProposeToken,
  buildSign,
  buildUnsign,
  MULTISIG_WASM_SHA256,
  predictSafeAddress
} from './legacyCalls';

export interface Signer {
  address: string;
  nonce: number;
}

/**
 * The nonce is read from the network at the moment of sending, not taken from
 * the account hook. A stale one is rejected by the node with "lowerNonceInTx",
 * and because the page used to swallow that, a signed transaction simply
 * vanished with no toast and nothing on chain (6 Oct 2026).
 */
const contextOf = async (signer: Signer, safe: string) => {
  let nonce = signer.nonce;
  try {
    const account = await networkProvider.getAccount(new Address(signer.address));
    nonce = Number(account.nonce);
  } catch {
    // Fall back to what the page knows, rather than refusing to act at all.
  }
  return { chainId, sender: signer.address, nonce, safe };
};

/**
 * The guardian of an account, if it has one switched on. A guarded account is
 * one where a second service has to co-sign everything, which is how a treasury
 * wallet should be held.
 */
const guardianOf = async (address: string): Promise<string> => {
  try {
    const account = await api<{ isGuarded?: boolean; activeGuardianAddress?: string }>(
      `/accounts/${address}?withGuardianInfo=true`
    );
    return account?.isGuarded ? (account.activeGuardianAddress ?? '') : '';
  } catch {
    // Unknown, so send it unguarded. A guarded account will simply refuse it,
    // which is safe: nothing moves.
    return '';
  }
};

/** Several transactions from one sender, signed together, sent in nonce order. */
const sendAll = async (transactions: any[], label: string) => {
  // A guarded account can only send transactions that name their guardian and
  // carry its signature. Without these three fields the wallet has nothing it
  // can co-sign, and the attempt dies as if it had been cancelled, which is
  // exactly how it looked (6 Oct 2026). applyGuardian sets the
  // guardian, version 2 and the guarded option; the wallet, or the web wallet's
  // two factor page, adds the second signature.
  const guardian = await guardianOf(transactions[0].sender.toBech32());
  if (guardian) {
    const computer = new TransactionComputer();
    transactions.forEach((transaction) =>
      computer.applyGuardian(transaction, new Address(guardian))
    );
  }

  return signAndSendTransactions({
    transactions,
    transactionsDisplayInfo: {
      processingMessage: `${label}...`,
      errorMessage: `${label} failed`,
      successMessage: `${label} done`
    }
  });
};

const send = (transaction: any, label: string) => sendAll([transaction], label);

export const signAction = async (signer: Signer, safe: string, actionId: number) =>
  send(await buildSign(await contextOf(signer, safe), actionId), `Signing action ${actionId}`);

export const unsignAction = async (signer: Signer, safe: string, actionId: number) =>
  send(
    await buildUnsign(await contextOf(signer, safe), actionId),
    `Removing your signature from action ${actionId}`
  );

export const performAction = async (signer: Signer, safe: string, actionId: number) =>
  send(
    await buildPerform(await contextOf(signer, safe), actionId),
    `Carrying out action ${actionId}`
  );

export const discardAction = async (signer: Signer, safe: string, actionId: number) =>
  send(
    await buildDiscard(await contextOf(signer, safe), actionId),
    `Discarding action ${actionId}`
  );

export const proposeSendEgld = async (
  signer: Signer,
  safe: string,
  to: string,
  amount: string
) =>
  send(
    await buildProposeEgld(await contextOf(signer, safe), { to, amount }),
    'Proposing an EGLD transfer'
  );

export const proposeSendToken = async (
  signer: Signer,
  safe: string,
  to: string,
  tokenIdentifier: string,
  amount: string,
  decimals: number
) =>
  send(
    await buildProposeToken(await contextOf(signer, safe), {
      to,
      tokenIdentifier,
      amount,
      decimals
    }),
    'Proposing a token transfer'
  );

export const proposeAddBoardMember = async (signer: Signer, safe: string, member: string) =>
  send(
    await buildProposeAddBoardMember(await contextOf(signer, safe), member),
    'Proposing a new board member'
  );

export const proposeAddProposer = async (signer: Signer, safe: string, proposer: string) =>
  send(
    await buildProposeAddProposer(await contextOf(signer, safe), proposer),
    'Proposing a new proposer'
  );

export const proposeRemoveUser = async (signer: Signer, safe: string, user: string) =>
  send(
    await buildProposeRemoveUser(await contextOf(signer, safe), user),
    'Proposing to remove a member'
  );

export const proposeChangeQuorum = async (
  signer: Signer,
  safe: string,
  newQuorum: number
) =>
  send(
    await buildProposeChangeQuorum(await contextOf(signer, safe), newQuorum),
    'Proposing a new quorum'
  );

// --- creating a safe ---------------------------------------------------------

/**
 * The contract every new safe runs, fetched from this site and refused unless
 * it is byte for byte the one the app was tested against.
 */
const loadSafeCode = async (): Promise<Uint8Array> => {
  const response = await fetch('/contracts/multisig.wasm', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('The contract code could not be loaded. Nothing was sent.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== MULTISIG_WASM_SHA256) {
    throw new Error(
      'The contract code is not the one this app was tested with, so it was refused. Nothing was sent.'
    );
  }
  return bytes;
};

/**
 * Creates a safe and hands it to itself, as one pair of transactions to sign.
 * Returns the new safe's address, which is known before anything is sent: it
 * follows from the sender and the nonce of the deploy.
 */
export const createSafe = async (
  signer: Signer,
  { quorum, board }: { quorum: number; board: string[] }
): Promise<string> => {
  const bytecode = await loadSafeCode();
  const { chainId, sender, nonce } = await contextOf(signer, '');
  const safe = predictSafeAddress(sender, nonce);
  const deploy = await buildDeploySafe({ chainId, sender, nonce }, { bytecode, quorum, board });
  // The next nonce, so the network runs it right after the deploy, when the
  // contract exists and the sender still owns it.
  const handOver = await buildHandOver({ chainId, sender, nonce: nonce + 1, safe });
  await sendAll([deploy, handOver], 'Creating the safe');
  return safe;
};

/** The second half on its own, for a safe whose handover never happened. */
export const handOverSafe = async (signer: Signer, safe: string) =>
  send(await buildHandOver(await contextOf(signer, safe)), 'Handing the safe to itself');

