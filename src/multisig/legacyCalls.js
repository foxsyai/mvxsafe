// Every transaction this app sends, built against the ABI of the contract our
// safes actually run. Plain JavaScript on purpose: the app imports it and so do
// the devnet tests, so what is proven on devnet is literally what ships.
//
// WHY NOT THE SDK'S MultisigController: it builds for a newer multisig whose
// proposeTransferExecute and proposeAsyncCall take an extra gas-limit argument.
// Against our contracts that shifts every argument along, and a token transfer
// ends up with an empty endpoint name and ESDTTransfer sitting in the argument
// list. The proposal is accepted and then fails at perform with "tokenize
// failed", which is the worst possible moment: after signatures were collected.
// Proven on devnet, 6 October 2026, against a copy of the Foundation's exact
// bytecode. See src/abi/multisig-legacy.abi.json.

import {
  Abi,
  Address,
  BigUIntValue,
  BytesType,
  BytesValue,
  SmartContractTransactionsFactory,
  TransactionsFactoryConfig,
  U32Value,
  VariadicValue
} from '@multiversx/sdk-core';
import legacyAbiJson from '../abi/multisig-legacy.abi.json' with { type: 'json' };

export const legacyAbi = Abi.create(legacyAbiJson);

/** Gas that comfortably covers a proposal, a signature or a perform. */
export const DEFAULT_GAS = 60000000n;

const factoryFor = (chainId) =>
  new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: chainId }),
    abi: legacyAbi
  });

/**
 * Builds one call. `sender` is only an address: this never signs, the wallet
 * does, and the devnet tests sign with a throwaway key.
 */
const call = async ({ chainId, sender, nonce, safe, fn, args, gasLimit }) => {
  const transaction = await factoryFor(chainId).createTransactionForExecute(
    new Address(sender),
    {
      contract: new Address(safe),
      function: fn,
      gasLimit: gasLimit ?? DEFAULT_GAS,
      arguments: args
    }
  );
  transaction.nonce = BigInt(nonce);
  return transaction;
};

// --- approving and carrying out ----------------------------------------------

export const buildSign = (context, actionId) =>
  call({ ...context, fn: 'sign', args: [new U32Value(actionId)] });

export const buildUnsign = (context, actionId) =>
  call({ ...context, fn: 'unsign', args: [new U32Value(actionId)] });

export const buildPerform = (context, actionId) =>
  call({ ...context, fn: 'performAction', args: [new U32Value(actionId)] });

export const buildDiscard = (context, actionId) =>
  call({ ...context, fn: 'discardAction', args: [new U32Value(actionId)] });

// --- proposing ---------------------------------------------------------------

/** Turns "12.5" into the integer the chain works in, without floating point. */
export const toRawAmount = (amount, decimals) => {
  const [whole, fraction = ''] = String(amount).trim().replace(',', '.').split('.');
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(`${whole || '0'}${padded}`);
};

/** Top encoding of an amount, which is how a BigUint travels as an argument. */
const amountBytes = (raw) => {
  let hex = raw.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return BytesValue.fromHex(hex === '00' ? '' : hex);
};

// fromItems, NOT fromItemsCounted: the counted form writes the number of items
// as an extra argument, which the contract then stored as the function name. The
// proposal looked fine and the transfer quietly did nothing when performed.
const variadic = (items) => VariadicValue.fromItems(...items);

/** EGLD out of the safe, optionally calling a function on the receiving side. */
export const buildProposeEgld = (context, { to, amount, functionName, functionArgs = [] }) =>
  call({
    ...context,
    fn: 'proposeTransferExecute',
    args: [
      new Address(to),
      new BigUIntValue(toRawAmount(amount, 18)),
      variadic(
        functionName
          ? [
              BytesValue.fromUTF8(functionName),
              ...functionArgs.map((argument) => BytesValue.fromUTF8(String(argument)))
            ]
          : []
      )
    ]
  });

/**
 * A token out of the safe. On this build there is no ESDT-specific endpoint:
 * the safe asks the recipient's account to run ESDTTransfer, with the token and
 * the amount as its arguments. The endpoint name is its own argument, NOT the
 * first entry of the argument list.
 */
export const buildProposeToken = (context, { to, tokenIdentifier, amount, decimals }) =>
  call({
    ...context,
    fn: 'proposeAsyncCall',
    args: [
      new Address(to),
      new BigUIntValue(0n),
      variadic([
        BytesValue.fromUTF8('ESDTTransfer'),
        BytesValue.fromUTF8(tokenIdentifier),
        amountBytes(toRawAmount(amount, decimals))
      ])
    ]
  });

export const buildProposeAddBoardMember = (context, address) =>
  call({ ...context, fn: 'proposeAddBoardMember', args: [new Address(address)] });

export const buildProposeAddProposer = (context, address) =>
  call({ ...context, fn: 'proposeAddProposer', args: [new Address(address)] });

export const buildProposeRemoveUser = (context, address) =>
  call({ ...context, fn: 'proposeRemoveUser', args: [new Address(address)] });

export const buildProposeChangeQuorum = (context, newQuorum) =>
  call({ ...context, fn: 'proposeChangeQuorum', args: [new U32Value(newQuorum)] });
