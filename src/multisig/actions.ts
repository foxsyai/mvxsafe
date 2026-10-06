// Sending something. Each function builds one transaction with the legacy
// builders in legacyCalls.js, hands it to the connected wallet to sign, and
// tracks it. Nothing here holds a key.

import { Address } from '@multiversx/sdk-core';
import { signAndSendTransactions } from 'helpers/signAndSendTransactions';
import { chainId, networkProvider } from './network';
import {
  buildDiscard,
  buildPerform,
  buildProposeAddBoardMember,
  buildProposeAddProposer,
  buildProposeChangeQuorum,
  buildProposeEgld,
  buildProposeRemoveUser,
  buildProposeToken,
  buildSign,
  buildUnsign
} from './legacyCalls';

export interface Signer {
  address: string;
  nonce: number;
}

/**
 * The nonce is read from the network at the moment of sending, not taken from
 * the account hook. A stale one is rejected by the node with "lowerNonceInTx",
 * and because the page used to swallow that, a signed transaction simply
 * vanished with no toast and nothing on chain (Sebastian, 6 Oct 2026).
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

const send = async (transaction: any, label: string) =>
  signAndSendTransactions({
    transactions: [transaction],
    transactionsDisplayInfo: {
      processingMessage: `${label}...`,
      errorMessage: `${label} failed`,
      successMessage: `${label} done`
    }
  });

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
