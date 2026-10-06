// Sending something. Each function builds one transaction with the legacy
// builders in legacyCalls.js, hands it to the connected wallet to sign, and
// tracks it. Nothing here holds a key.

import { signAndSendTransactions } from 'helpers/signAndSendTransactions';
import { chainId } from './network';
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

const contextOf = (signer: Signer, safe: string) => ({
  chainId,
  sender: signer.address,
  nonce: signer.nonce,
  safe
});

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
  send(await buildSign(contextOf(signer, safe), actionId), `Signing action ${actionId}`);

export const unsignAction = async (signer: Signer, safe: string, actionId: number) =>
  send(
    await buildUnsign(contextOf(signer, safe), actionId),
    `Removing your signature from action ${actionId}`
  );

export const performAction = async (signer: Signer, safe: string, actionId: number) =>
  send(
    await buildPerform(contextOf(signer, safe), actionId),
    `Carrying out action ${actionId}`
  );

export const discardAction = async (signer: Signer, safe: string, actionId: number) =>
  send(
    await buildDiscard(contextOf(signer, safe), actionId),
    `Discarding action ${actionId}`
  );

export const proposeSendEgld = async (
  signer: Signer,
  safe: string,
  to: string,
  amount: string
) =>
  send(
    await buildProposeEgld(contextOf(signer, safe), { to, amount }),
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
    await buildProposeToken(contextOf(signer, safe), {
      to,
      tokenIdentifier,
      amount,
      decimals
    }),
    'Proposing a token transfer'
  );

export const proposeAddBoardMember = async (signer: Signer, safe: string, member: string) =>
  send(
    await buildProposeAddBoardMember(contextOf(signer, safe), member),
    'Proposing a new board member'
  );

export const proposeAddProposer = async (signer: Signer, safe: string, proposer: string) =>
  send(
    await buildProposeAddProposer(contextOf(signer, safe), proposer),
    'Proposing a new proposer'
  );

export const proposeRemoveUser = async (signer: Signer, safe: string, user: string) =>
  send(
    await buildProposeRemoveUser(contextOf(signer, safe), user),
    'Proposing to remove a member'
  );

export const proposeChangeQuorum = async (
  signer: Signer,
  safe: string,
  newQuorum: number
) =>
  send(
    await buildProposeChangeQuorum(contextOf(signer, safe), newQuorum),
    'Proposing a new quorum'
  );
