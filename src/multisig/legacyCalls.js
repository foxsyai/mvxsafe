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
// Proven on devnet, 6 October 2026, against a copy of a mainnet safe's exact
// bytecode. See src/abi/multisig-legacy.abi.json.

import {
  Abi,
  Address,
  AddressComputer,
  AddressValue,
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
      contract: parseAddress(safe, 'safe address'),
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

/**
 * Turns "12.5" into the integer the chain works in, exactly, or refuses it.
 *
 * Only digits with at most one dot. No commas: a comma is a thousands separator
 * in one country and a decimal point in the next, and "250,000" FOXSY used to
 * be proposed as 250. No signs, exponents, hex or blanks, and never more
 * decimals than the token has, which used to be cut off silently (tx audit
 * TX-01 to TX-05, 7 Oct 2026). Trailing zeros past the decimals change nothing
 * and are allowed.
 */
export const toRawAmount = (amount, decimals) => {
  const text = String(amount ?? '').trim();
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[1] === '' && !match[2])) {
    throw new Error(
      `"${text}" is not an amount. Use digits and at most one dot, for example 250000 or 1.5.`
    );
  }
  const [, whole, fraction = ''] = match;
  if (/[^0]/.test(fraction.slice(decimals))) {
    throw new Error(`This token has ${decimals} decimals, and "${text}" has more.`);
  }
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(`${whole || '0'}${padded}`);
};

const BECH32_ADDRESS = /^erd1[02-9ac-hj-np-z]{58}$/;

/**
 * An erd1 address, checksum included, or an error. new Address() alone also
 * accepts 64 hex characters, so a pasted transaction hash became a recipient
 * or a board member that nobody controls (tx audit TX-06).
 */
export const parseAddress = (value, what = 'address') => {
  const text = String(value ?? '').trim();
  if (!BECH32_ADDRESS.test(text) || !Address.isValid(text)) {
    throw new Error(`That is not a valid MultiversX ${what}: "${text}".`);
  }
  return Address.newFromBech32(text);
};

/** A positive amount: a transfer of nothing is accepted, then fails when carried out. */
const positive = (raw) => {
  if (raw <= 0n) throw new Error('The amount has to be more than zero.');
  return raw;
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
export const buildProposeEgld = async (context, { to, amount, functionName, functionArgs = [] }) => {
  const raw = toRawAmount(amount, 18);
  // Zero EGLD only makes sense when a function is called with it.
  if (!functionName) positive(raw);
  return call({
    ...context,
    fn: 'proposeTransferExecute',
    args: [
      parseAddress(to, 'recipient'),
      new BigUIntValue(raw),
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
};

/**
 * A token out of the safe. On this build there is no ESDT-specific endpoint:
 * the safe asks the recipient's account to run ESDTTransfer, with the token and
 * the amount as its arguments. The endpoint name is its own argument, NOT the
 * first entry of the argument list.
 */
export const buildProposeToken = async (context, { to, tokenIdentifier, amount, decimals }) => {
  const raw = positive(toRawAmount(amount, decimals));
  return call({
    ...context,
    fn: 'proposeAsyncCall',
    args: [
      parseAddress(to, 'recipient'),
      new BigUIntValue(0n),
      variadic([
        BytesValue.fromUTF8('ESDTTransfer'),
        BytesValue.fromUTF8(tokenIdentifier),
        amountBytes(raw)
      ])
    ]
  });
};

export const buildProposeAddBoardMember = (context, address) =>
  call({ ...context, fn: 'proposeAddBoardMember', args: [parseAddress(address, 'board member')] });

export const buildProposeAddProposer = (context, address) =>
  call({ ...context, fn: 'proposeAddProposer', args: [parseAddress(address, 'proposer')] });

export const buildProposeRemoveUser = (context, address) =>
  call({ ...context, fn: 'proposeRemoveUser', args: [parseAddress(address, 'member')] });

export const buildProposeChangeQuorum = (context, newQuorum) =>
  call({ ...context, fn: 'proposeChangeQuorum', args: [new U32Value(newQuorum)] });

// --- creating a safe ---------------------------------------------------------
//
// A new safe runs the same contract as the older mainnet safes, byte for byte, so everything
// above is proven against it. Two transactions, signed together:
//
//   1. deploy the code with the quorum and the board,
//   2. ChangeOwnerAddress, handing the contract to itself.
//
// Step 2 matters: a contract is upgradeable by its owner, and right after the
// deploy the owner is whoever sent it. Once the safe owns itself, only the board,
// by quorum, can ever change its code. Existing mainnet safes were set up exactly
// this way (one was deployed at nonce 3 and handed over at nonce 4 in May 2026).
// The tests rebuild those two transactions byte for byte.

/** What the chain reports as the code hash of every safe running this build. */
export const MULTISIG_CODE_HASH = '9WWFKcUczCmF6LKXc3TJCUF+0H77krHer4ABN/XCWGE=';

/** SHA-256 of the same wasm, checkable in a browser before it is deployed. */
export const MULTISIG_WASM_SHA256 =
  '394e33d9ea7e854edf39f59da30c3e65f5b975322f252ded0a5017c48234a9d5';

/**
 * A deploy spends ALL the gas it is given: a mainnet safe burned its full 100M
 * with one member, the devnet test safe its full 200M with three. Most of the
 * fee pays for the 47,000 bytes of code; gas above that is priced at a hundredth,
 * so 250M costs about 0.0005 EGLD more than 200M, while running out would lose
 * the whole fee. Fee at 250M: about 0.073 EGLD.
 */
export const DEPLOY_GAS = 250000000n;

/** A mainnet handover used 5.2M of the 10M it was given. */
export const HANDOVER_GAS = 10000000n;

/** The address the safe will have, known before anything is sent. */
export const predictSafeAddress = (deployer, nonce) =>
  new AddressComputer().computeContractAddress(new Address(deployer), BigInt(nonce)).toBech32();

/**
 * Deploys a safe: the quorum, then every board member. Upgradeable, readable,
 * payable and payable by contracts, like the existing safes, so tokens can be sent
 * to it from any wallet or contract.
 */
export const buildDeploySafe = async ({ chainId, sender, nonce }, { bytecode, quorum, board }) => {
  const factory = new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: chainId })
  });
  const transaction = await factory.createTransactionForDeploy(new Address(sender), {
    bytecode,
    gasLimit: DEPLOY_GAS,
    arguments: [
      new U32Value(quorum),
      ...board.map((member) => new AddressValue(parseAddress(member, 'board member')))
    ],
    isUpgradeable: true,
    isReadable: true,
    isPayable: true,
    isPayableBySmartContract: true
  });
  transaction.nonce = BigInt(nonce);
  return transaction;
};

/** Hands the contract to itself. Sent by the deployer, the owner until then. */
export const buildHandOver = async ({ chainId, sender, nonce, safe }) => {
  const factory = new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: chainId })
  });
  const transaction = await factory.createTransactionForExecute(new Address(sender), {
    contract: parseAddress(safe, 'safe address'),
    function: 'ChangeOwnerAddress',
    gasLimit: HANDOVER_GAS,
    arguments: [new AddressValue(parseAddress(safe, 'safe address'))]
  });
  transaction.nonce = BigInt(nonce);
  return transaction;
};

