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
  BytesValue,
  CodeMetadata,
  CodeMetadataValue,
  SmartContractTransactionsFactory,
  TransactionsFactoryConfig,
  U32Value,
  VariadicValue
} from '@multiversx/sdk-core';
import { blake2b } from '@noble/hashes/blake2b';
import legacyAbiJson from '../abi/multisig-legacy.abi.json' with { type: 'json' };

export const legacyAbi = Abi.create(legacyAbiJson);

// No gas here. Every transaction leaves these builders with a limit of 0 and
// gets its real one from settleGas (gas.js) as the last step before signing: a
// simulation plus a fifth, or a budget where the network cannot simulate. A
// path that forgot would be refused by the network for want of gas, with
// nothing spent. The flat 60M this used to set was ten times a signature.

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
      gasLimit: gasLimit ?? 0n,
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
    throw new Error(`This token has ${decimals} decimals. "${text}" has more.`);
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

/** An unsigned integer the way a contract reads one: big-endian, shortest form, 0 as nothing. */
export const topEncode = (raw) => {
  if (raw < 0n) throw new Error('A negative number cannot be written here.');
  if (raw === 0n) return new Uint8Array(0);
  let hex = raw.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));
};

// fromItems, NOT fromItemsCounted: the counted form writes the number of items
// as an extra argument, which the contract then stored as the function name. The
// proposal looked fine and the transfer quietly did nothing when performed.
const variadic = (items) => VariadicValue.fromItems(...items);

/** EGLD out of the safe, optionally calling a function on the receiving side. */
export const buildProposeEgld = async (
  context,
  { to, amount, functionName, functionArgs = [] }
) => {
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
              ...functionArgs.map((argument) =>
                BytesValue.fromUTF8(String(argument))
              )
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
export const buildProposeToken = async (
  context,
  { to, tokenIdentifier, amount, decimals }
) => {
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
  call({
    ...context,
    fn: 'proposeAddBoardMember',
    args: [parseAddress(address, 'board member')]
  });

export const buildProposeAddProposer = (context, address) =>
  call({
    ...context,
    fn: 'proposeAddProposer',
    args: [parseAddress(address, 'proposer')]
  });

export const buildProposeRemoveUser = (context, address) =>
  call({
    ...context,
    fn: 'proposeRemoveUser',
    args: [parseAddress(address, 'member')]
  });

export const buildProposeChangeQuorum = (context, newQuorum) =>
  call({
    ...context,
    fn: 'proposeChangeQuorum',
    args: [new U32Value(newQuorum)]
  });

// --- shards, code and code metadata ------------------------------------------

/**
 * The shard an address lives in, out of the three that mainnet and devnet run.
 * A contract lives in the shard of the account that deployed it.
 */
export const shardOf = (address) =>
  new AddressComputer().getShardOfAddress(parseAddress(address));

/**
 * The code hash MultiversX gives a contract: blake2b-256 of its wasm. This is
 * what the API reports (in base64) for every deployed contract, so a .wasm
 * file can be checked against a release before it is deployed, and a deployed
 * source against the file afterwards.
 */
export const codeHashOf = (bytes) =>
  Array.from(blake2b(bytes, { dkLen: 32 }), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

/**
 * A code hash as 64 lowercase hex characters, from hex (with or without 0x,
 * any case) or from the base64 the API uses. Null for anything else.
 */
export const normalizeCodeHash = (value) => {
  const text = String(value ?? '').trim();
  const hex = text.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase();
  if (/^[A-Za-z0-9+/]{43}=$/.test(text)) {
    const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    if (bytes.length === 32) {
      return Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    }
  }
  return null;
};

/**
 * Code metadata as the four flags, from the two bytes on the wire:
 *   first byte  0x01 upgradeable, 0x04 readable;
 *   second byte 0x02 payable,     0x04 payable by smart contracts.
 * So 0500 is upgradeable and readable, and nothing else.
 */
export const metadataFromHex = (hex) => {
  const text = String(hex ?? '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{4}$/.test(text))
    throw new Error(
      `"${hex}" is not code metadata: it is two bytes, for example 0500.`
    );
  const { upgradeable, readable, payable, payableBySc } =
    CodeMetadata.newFromBytes(
      Uint8Array.from([
        parseInt(text.slice(0, 2), 16),
        parseInt(text.slice(2), 16)
      ])
    );
  return { upgradeable, readable, payable, payableBySc };
};

export const metadataToHex = ({
  upgradeable,
  readable,
  payable,
  payableBySc
}) =>
  new CodeMetadata(
    Boolean(upgradeable),
    Boolean(readable),
    Boolean(payable),
    Boolean(payableBySc)
  ).toString();

const metadataOf = (value) =>
  typeof value === 'string' ? metadataFromHex(value) : value;

// --- arguments, written the way the target's ABI reads them -------------------

/**
 * One argument of a contract call as the bytes that travel, top-encoded the
 * way a contract decodes its arguments:
 *
 *   egld     "0.01"       -> 2386f26fc10000   (an amount of EGLD, 18 decimals)
 *   number   "10"         -> 0a               (any unsigned integer: BigUint, u64,
 *                                              u32, u8, or an enum's discriminant)
 *   address  "erd1..."    -> its 32 bytes
 *   text     "FOXSY-5d5f3e" -> its UTF-8 bytes (names, token identifiers)
 *   hex      "0x0102"     -> those bytes
 *   bool     "true"       -> 01, and "false" -> nothing
 *
 * Zero is no bytes at all, which is how a contract reads 0, false or the first
 * variant of an enum.
 */
export const encodeArgument = (kind, value) => {
  const text = String(value ?? '').trim();
  switch (kind) {
    case 'egld':
      return topEncode(toRawAmount(text, 18));
    case 'number': {
      if (!/^\d+$/.test(text)) {
        throw new Error(
          `"${text}" is not a whole number. Use digits only, for example 10.`
        );
      }
      return topEncode(BigInt(text));
    }
    case 'address':
      return parseAddress(text, 'address').getPublicKey();
    case 'text':
      return new TextEncoder().encode(String(value ?? ''));
    case 'hex': {
      const hex = text.replace(/^0x/i, '');
      if (!/^([0-9a-fA-F]{2})*$/.test(hex)) {
        throw new Error(
          `"${text}" is not hex: pairs of 0-9 and a-f, for example 0x0102.`
        );
      }
      return Uint8Array.from(hex.match(/../g) ?? [], (pair) =>
        parseInt(pair, 16)
      );
    }
    case 'bool':
      if (/^(true|yes|1)$/i.test(text)) return Uint8Array.of(1);
      if (/^(false|no|0)$/i.test(text)) return new Uint8Array(0);
      throw new Error(`"${text}" is neither true nor false.`);
    default:
      throw new Error(`Unknown kind of argument: ${kind}.`);
  }
};

const argumentBytes = (argument) =>
  argument instanceof Uint8Array
    ? argument
    : encodeArgument(argument.kind, argument.value);

/** The SDK's codec works on Buffers. */
const bytesValue = (bytes) => new BytesValue(Buffer.from(bytes));

/**
 * The network's built-in functions: they act on the account they are sent to,
 * not through the contract's code (builtInCost on mainnet, 14 Oct 2026), plus
 * upgradeContract, the VM's code replacement. A call naming one is refused by
 * the call form and red on the card: a compromised signer could use them to
 * replace an owned contract's code or hand it away (audit UPG-01, and
 * mvxvest's own audit, 14 Oct 2026). Tokens leave the safe through their own
 * builders, which do not go through here.
 */
export const PROTOCOL_BUILTINS = new Set([
  'upgradeContract',
  'ChangeOwnerAddress',
  'ClaimDeveloperRewards',
  'SetGuardian',
  'GuardAccount',
  'UnGuardAccount',
  'SaveUserName',
  'SaveKeyValue',
  'ESDTTransfer',
  'ESDTBurn',
  'ESDTLocalMint',
  'ESDTLocalBurn',
  'ESDTNFTTransfer',
  'ESDTNFTMultiTransfer',
  'MultiESDTNFTTransfer',
  'ESDTNFTCreate',
  'ESDTNFTAddQuantity',
  'ESDTNFTBurn',
  'ESDTNFTAddUri',
  'ESDTNFTUpdateAttributes',
  'ESDTNFTChangeCreateOwner',
  'ESDTNFTRecreate',
  'ESDTNFTUpdate',
  'ESDTNFTSetNewURIs',
  'ESDTModifyCreator',
  'ESDTModifyRoyalties'
]);

/** The one built-in a call may name: it can only pay the contract's developer rewards to its owner. */
const CALLABLE_BUILTINS = new Set(['ClaimDeveloperRewards']);

/** Why a call may not name this function, or '' when it may. */
export const builtInRefusal = (name) => {
  if (!PROTOCOL_BUILTINS.has(name) || CALLABLE_BUILTINS.has(name)) return '';
  if (name === 'upgradeContract') {
    return 'upgradeContract replaces the contract\'s code with code carried in the proposal itself. Use "Upgrade a contract": it copies the code from a source the board can check against the release.';
  }
  return `${name} is a built-in function of the network, not a function of the contract, and mvxsafe does not propose it. Tokens leave the safe through "Send tokens", upgrades go through "Upgrade a contract".`;
};

/**
 * A system contract of the network (tokens, staking, governance, delegation):
 * 0000000000000000 0001 ... ffff, where an ordinary contract has 0500.
 */
export const isSystemContract = (address) =>
  /^00000000000000000001[0-9a-f]{40}ffff$/.test(parseAddress(address).toHex());

/** An endpoint name as the contract exports it: a letter or _, then letters, digits and _. */
const ENDPOINT = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;

/**
 * A call on a contract, typically one the safe owns: setFee, pauseCreation and
 * the rest of an owner's endpoints. The function name is the FIRST item of the
 * argument list, not an argument of its own, exactly as for a token; the
 * arguments follow, already encoded.
 *
 *   proposeAsyncCall@<contract>@<egld or nothing>@<function>@<arguments...>
 */
export const buildProposeCall = async (
  context,
  { to, egld = '0', functionName, args = [] }
) => {
  const name = String(functionName ?? '').trim();
  if (!ENDPOINT.test(name)) {
    throw new Error(
      name
        ? `"${name}" is not a function name a contract can have.`
        : 'Name the function to call, for example setFee.'
    );
  }
  const refusal = builtInRefusal(name);
  if (refusal) throw new Error(refusal);
  return call({
    ...context,
    fn: 'proposeAsyncCall',
    args: [
      parseAddress(to, 'contract address'),
      new BigUIntValue(toRawAmount(egld || '0', 18)),
      variadic([
        BytesValue.fromUTF8(name),
        ...args.map((arg) => bytesValue(argumentBytes(arg)))
      ])
    ]
  });
};

/**
 * Why an upgrade must not be proposed, or '' when it may. Checked by the
 * builder and by the form alike, from the addresses alone:
 *
 * - The SOURCE must be in the safe's shard. performAction reads the source's
 *   code in its own shard; a source anywhere else fails at perform, after
 *   every signature, and uses the action up.
 * - The new metadata must keep "upgradeable". Without it the contract can
 *   never be changed again, by anyone, the board included.
 * - The target is a contract, and not the safe itself.
 */
export const upgradeProblem = ({ safe, target, source, metadata }) => {
  const targetAddress = parseAddress(target, 'contract address');
  const sourceAddress = parseAddress(source, 'source address');
  if (!targetAddress.isSmartContract())
    return 'The contract to upgrade has to be a contract address (erd1qqqqqqqqqqqqqpgq...).';
  if (!sourceAddress.isSmartContract())
    return 'The source has to be a contract address (erd1qqqqqqqqqqqqqpgq...).';
  if (
    targetAddress.toBech32() === parseAddress(safe, 'safe address').toBech32()
  ) {
    return 'That is the safe itself. mvxsafe does not replace the code of the safe it is acting for.';
  }
  const sourceShard = shardOf(source);
  const safeShard = shardOf(safe);
  if (sourceShard !== safeShard) {
    return `The source is in shard ${sourceShard} and the safe in shard ${safeShard}. The safe reads the source's code in its own shard when the upgrade is carried out, so this would fail then, after the signatures, and use the action up. Deploy the source from a wallet in shard ${safeShard}.`;
  }
  if (!metadataOf(metadata).upgradeable) {
    return 'Without "upgradeable" the contract could never be changed again, by anyone, this board included. mvxsafe does not propose that.';
  }
  return '';
};

/**
 * Replaces the code of a contract the safe owns with the code of `source`,
 * which must already be deployed in the safe's shard. Nothing is sent with it
 * and, for mvxvest, there are no arguments, since its upgrade takes none:
 *
 *   proposeSCUpgradeFromSource@<contract>@@<source>@0500
 */
export const buildProposeUpgrade = async (
  context,
  { target, source, metadata, args = [], amount = '0' }
) => {
  const problem = upgradeProblem({
    safe: context.safe,
    target,
    source,
    metadata
  });
  if (problem) throw new Error(problem);
  const flags = metadataOf(metadata);
  return call({
    ...context,
    fn: 'proposeSCUpgradeFromSource',
    args: [
      parseAddress(target, 'contract address'),
      new BigUIntValue(toRawAmount(amount || '0', 18)),
      parseAddress(source, 'source address'),
      new CodeMetadataValue(
        new CodeMetadata(
          flags.upgradeable,
          flags.readable,
          flags.payable,
          flags.payableBySc
        )
      ),
      variadic(args.map((arg) => bytesValue(argumentBytes(arg))))
    ]
  });
};

/**
 * Deploys the code an upgrade will copy, from the wallet of whoever prepares
 * it, which must be in the safe's shard. The source itself is NOT upgradeable,
 * so nobody can change the code between the board's signatures and the
 * upgrade; readable, not payable, and by default without arguments, because
 * mvxvest's constructor takes none.
 */
export const buildDeploySource = async (
  { chainId, sender, nonce },
  { bytecode, args = [] }
) => {
  const factory = new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: chainId })
  });
  const transaction = await factory.createTransactionForDeploy(
    new Address(sender),
    {
      bytecode,
      gasLimit: 0n,
      arguments: args.map((arg) => bytesValue(argumentBytes(arg))),
      isUpgradeable: false,
      isReadable: true,
      isPayable: false,
      isPayableBySmartContract: false
    }
  );
  transaction.nonce = BigInt(nonce);
  return transaction;
};

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
export const MULTISIG_CODE_HASH =
  '9WWFKcUczCmF6LKXc3TJCUF+0H77krHer4ABN/XCWGE=';

/** SHA-256 of the same wasm, checkable in a browser before it is deployed. */
export const MULTISIG_WASM_SHA256 =
  '394e33d9ea7e854edf39f59da30c3e65f5b975322f252ded0a5017c48234a9d5';

// A deploy spends ALL the gas it is given: a mainnet safe burned its full 100M
// with one member, the devnet test safe its full 200M with three. So it is no
// longer given a flat 250M but its simulation plus a fifth (settleGas), and the
// handover, which cannot be simulated before the safe exists, the fixed cost
// of ChangeOwnerAddress plus a fifth (handOverGas in gas.js). A mainnet
// handover used 5.2M of the 10M it used to get.

/** The address the safe will have, known before anything is sent. */
export const predictSafeAddress = (deployer, nonce) =>
  new AddressComputer()
    .computeContractAddress(new Address(deployer), BigInt(nonce))
    .toBech32();

/**
 * Deploys a safe: the quorum, then every board member. Upgradeable, readable,
 * payable and payable by contracts, like the existing safes, so tokens can be sent
 * to it from any wallet or contract.
 */
export const buildDeploySafe = async (
  { chainId, sender, nonce },
  { bytecode, quorum, board }
) => {
  const factory = new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: chainId })
  });
  const transaction = await factory.createTransactionForDeploy(
    new Address(sender),
    {
      bytecode,
      gasLimit: 0n,
      arguments: [
        new U32Value(quorum),
        ...board.map(
          (member) => new AddressValue(parseAddress(member, 'board member'))
        )
      ],
      isUpgradeable: true,
      isReadable: true,
      isPayable: true,
      isPayableBySmartContract: true
    }
  );
  transaction.nonce = BigInt(nonce);
  return transaction;
};

/** Hands the contract to itself. Sent by the deployer, the owner until then. */
export const buildHandOver = async ({ chainId, sender, nonce, safe }) => {
  const factory = new SmartContractTransactionsFactory({
    config: new TransactionsFactoryConfig({ chainID: chainId })
  });
  const transaction = await factory.createTransactionForExecute(
    new Address(sender),
    {
      contract: parseAddress(safe, 'safe address'),
      function: 'ChangeOwnerAddress',
      gasLimit: 0n,
      arguments: [new AddressValue(parseAddress(safe, 'safe address'))]
    }
  );
  transaction.nonce = BigInt(nonce);
  return transaction;
};
