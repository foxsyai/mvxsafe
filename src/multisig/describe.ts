// The sentence a board member reads before pressing Sign. It is the whole
// defence against approving something other than what they were told, so it
// follows three rules (display audit, 7 Oct 2026):
//
//   1. Exact. Amounts are integers divided by the token's REAL decimals, read
//      from the API, with no rounding and no floating point. "1,000,000 USDC"
//      used to read "Send 0 USDC" because every token was divided by 10^18.
//   2. Complete. Full addresses (a 14-character form was matched by a ground
//      look-alike in eight minutes), full token identifiers (two tokens can
//      share a ticker), every argument of a call, every token of a
//      multi-token transfer, and the recipient that NFT transfers hide in
//      their arguments.
//   3. Honest about what it cannot read: unknown decimals, malformed transfers
//      and hidden characters are said out loud, never smoothed over.

import { Address } from '@multiversx/sdk-core';
import { codeHashOf } from './legacyCalls';
import { api, networkName } from './network';
import { keyIdentifier, mvxvestFor, readVestingCall } from './vesting';

const DO_NOT_SIGN = 'Do not sign without checking it in the explorer.';

// --- values as the SDK hands them back ---------------------------------------

/** Bytes from whatever the decoder returned. ArrayBuffer.isView works across realms. */
export const bytesOf = (value: any): Uint8Array | null => {
  if (!value) return null;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value.type === 'Buffer' && Array.isArray(value.data))
    return new Uint8Array(value.data);
  return null;
};

/**
 * A decoded BigUint as an exact bigint, or null when it is not a whole number.
 * The SDK returns a BigNumber, whose toString() switches to "1e+21" from 1,000
 * EGLD upwards, which made those amounts vanish; toFixed() never does.
 */
export const toBigInt = (value: any): bigint | null => {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number')
    return Number.isSafeInteger(value) ? BigInt(value) : null;
  const text =
    typeof value.toFixed === 'function'
      ? value.toFixed()
      : String(value?.toString?.() ?? value);
  return /^-?\d+$/.test(text) ? BigInt(text) : null;
};

/** Big-endian unsigned bytes as a number, which is how amounts travel in arguments. */
const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) + BigInt(byte);
  return result;
};

const asAddress = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toBech32 === 'function') return value.toBech32();
  const bytes = bytesOf(value);
  if (bytes?.length === 32) return new Address(bytes).toBech32();
  return '';
};

/**
 * Text as it really is: every character outside printable ASCII is written out
 * as [U+XXXX], so a zero-width space or a right-to-left override cannot make
 * one name look like another.
 */
export const visible = (text: string): string =>
  text.replace(
    /[^\x20-\x7E]/gu,
    (char) =>
      `[U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`
  );

const decodeText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

// --- amounts -----------------------------------------------------------------

/** An amount in base units as a human number, exactly: no float, no rounding. */
export const formatUnits = (raw: bigint, decimals: number): string => {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = (value / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction =
    decimals > 0
      ? (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
      : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
};

const groupDigits = (raw: bigint) =>
  raw.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// --- tokens ------------------------------------------------------------------

/** TICKER-abcdef: 3 to 10 capitals or digits, a dash, six lowercase hex digits. */
const TOKEN_ID = /^[A-Z0-9]{3,10}-[0-9a-f]{6}$/;

export interface TokenMeta {
  /** Null when the API could not say, in which case no amount is formatted. */
  decimals: number | null;
}

/**
 * What the API says about a token, above all its decimals. Fungible tokens live
 * under /tokens; NFTs, SFTs and MetaESDT (anything moved with a nonce) under
 * /collections. Only a well-formed identifier is ever put in a URL.
 */
export const readTokenMeta = async (
  identifier: string,
  withNonce: boolean
): Promise<TokenMeta> => {
  if (!TOKEN_ID.test(identifier)) return { decimals: null };
  const path = withNonce
    ? `/collections/${identifier}`
    : `/tokens/${identifier}`;
  try {
    const answer = await api<{ decimals?: number; type?: string }>(path);
    if (
      answer?.type === 'NonFungibleESDT' ||
      answer?.type === 'SemiFungibleESDT'
    ) {
      return { decimals: 0 };
    }
    const decimals = answer?.decimals;
    return {
      decimals:
        Number.isInteger(decimals) && decimals! >= 0 && decimals! <= 32
          ? decimals!
          : null
    };
  } catch {
    return { decimals: null };
  }
};

/** "0.1 WEGLD-a28c59", or the raw number with a warning when decimals are unknown. */
const tokenAmount = async (
  identifierBytes: Uint8Array,
  amount: bigint,
  nonce = 0n
) => {
  const identifier = decodeText(identifierBytes);
  const shown = visible(identifier);
  const withNonce = nonce > 0n ? ` nonce ${nonce}` : '';
  if (!TOKEN_ID.test(identifier)) {
    return `${groupDigits(amount)} base units of "${shown}"${withNonce}, which is not a valid token identifier`;
  }
  const { decimals } = await readTokenMeta(identifier, nonce > 0n);
  if (decimals === null) {
    return `${groupDigits(amount)} base units of ${shown}${withNonce} (its decimals could not be read)`;
  }
  return `${formatUnits(amount, decimals)} ${shown}${withNonce}`;
};

// --- arguments ---------------------------------------------------------------

/** From 0.001 EGLD up, a number is also read as an amount of EGLD. */
const READ_AS_EGLD_FROM = 10n ** 15n;

/**
 * One argument of a call, as readably as it can be told apart: 32 bytes are an
 * address, a word is text, anything else a number, and long binary is hex.
 *
 * The chain does not say what a number means, only the target's ABI does. A
 * large one is therefore written exactly AND read as EGLD, with that reading
 * marked as one: "10,000,000,000,000,000 [0.01 EGLD at 18 decimals]". Never
 * the EGLD figure alone, which would be wrong for a token of 6 decimals.
 */
export const describeArgument = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return '0';
  if (bytes.length === 32) return new Address(bytes).toBech32();
  const text = decodeText(bytes);
  // One byte is a number far more often than a one-letter word: setTokenFee(100)
  // travels as 0x64, which is also "d" (mvxvest v2, 14 Oct 2026). Both are said.
  if (bytes.length === 1 && /^[A-Za-z]$/.test(text))
    return `${bytes[0]} [or the text "${text}"]`;
  if (/^[A-Za-z][A-Za-z0-9_.\-]*$/.test(text)) {
    // Up to 8 bytes, a word is just as likely an integer, the size of a u64 or
    // a small amount: "disabled" is also 7,235,441,138,447,705,444, a fee of
    // 7.2 EGLD (audit UPG-03, 14 Oct 2026). Both are said. Longer words (role
    // names, identifiers) are far more likely text and stay text.
    if (bytes.length > 8) return text;
    const value = bytesToBigInt(bytes);
    const asEgld =
      value >= READ_AS_EGLD_FROM
        ? `, ${formatUnits(value, 18)} EGLD at 18 decimals`
        : '';
    return `${text} [or the number ${groupDigits(value)}${asEgld}]`;
  }
  if (bytes.length <= 32) {
    const value = bytesToBigInt(bytes);
    return value >= READ_AS_EGLD_FROM
      ? `${groupDigits(value)} [${formatUnits(value, 18)} EGLD at 18 decimals]`
      : groupDigits(value);
  }
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

// --- code metadata -----------------------------------------------------------

export interface MetadataFlags {
  upgradeable: boolean;
  readable: boolean;
  payable: boolean;
  payableBySc: boolean;
}

/**
 * Code metadata as the decoder hands it back: a CodeMetadata object, or its
 * two bytes. Null when it is neither.
 */
export const metadataOf = (value: any): MetadataFlags | null => {
  if (value && typeof value.upgradeable === 'boolean') {
    return {
      upgradeable: value.upgradeable,
      readable: Boolean(value.readable),
      payable: Boolean(value.payable),
      payableBySc: Boolean(value.payableBySc)
    };
  }
  const bytes = bytesOf(value);
  if (bytes?.length !== 2) return null;
  return {
    upgradeable: (bytes[0] & 0x01) !== 0,
    readable: (bytes[0] & 0x04) !== 0,
    payable: (bytes[1] & 0x02) !== 0,
    payableBySc: (bytes[1] & 0x04) !== 0
  };
};

const FLAG_WORDS: [keyof MetadataFlags, string][] = [
  ['upgradeable', 'upgradeable'],
  ['readable', 'readable'],
  ['payable', 'payable'],
  ['payableBySc', 'payable by smart contracts']
];

/** "upgradeable, readable, not payable, not payable by smart contracts" */
export const describeMetadata = (flags: MetadataFlags): string =>
  FLAG_WORDS.map(([flag, words]) =>
    flags[flag] ? words : `not ${words}`
  ).join(', ');

/** What changes between two sets of flags, in words, or [] when nothing does. */
export const metadataChanges = (
  from: MetadataFlags,
  to: MetadataFlags
): string[] =>
  FLAG_WORDS.filter(([flag]) => from[flag] !== to[flag]).map(
    ([flag, words]) => `${to[flag] ? 'becomes' : 'stops being'} ${words}`
  );

const describeCallOf = (endpoint: Uint8Array, args: Uint8Array[]) =>
  `${visible(decodeText(endpoint))}(${args.map(describeArgument).join(', ')})`;

// --- calls -------------------------------------------------------------------

interface CallData {
  to: string;
  egld: bigint | null;
  endpoint: Uint8Array;
  args: Uint8Array[];
}

const readCall = (data: any): CallData => ({
  to: asAddress(data?.to),
  egld: toBigInt(data?.egld_amount),
  endpoint: bytesOf(data?.endpoint_name) ?? new Uint8Array(0),
  args: (data?.arguments ?? []).map(
    (arg: any) => bytesOf(arg) ?? new Uint8Array(0)
  )
});

/** Built-in token functions the safe runs on ITSELF, with the real recipient inside. */
const describeOnItself = async (
  name: string,
  args: Uint8Array[]
): Promise<string | null> => {
  switch (name) {
    case 'ESDTNFTTransfer': {
      // token, nonce, amount, receiver, then optionally a function and its arguments
      if (args.length < 4 || args[3].length !== 32) return null;
      const what = await tokenAmount(
        args[0],
        bytesToBigInt(args[2]),
        bytesToBigInt(args[1])
      );
      const then =
        args.length > 4
          ? `, then call ${describeCallOf(args[4], args.slice(5))} there`
          : '';
      return `Send ${what} to ${new Address(args[3]).toBech32()}${then}`;
    }
    case 'MultiESDTNFTTransfer': {
      // receiver, count, count times (token, nonce, amount), then optionally a call
      if (args.length < 2 || args[0].length !== 32) return null;
      const count = Number(bytesToBigInt(args[1]));
      if (!Number.isInteger(count) || count < 1 || args.length < 2 + count * 3)
        return null;
      const parts: string[] = [];
      for (let at = 0; at < count; at++) {
        const [token, nonce, amount] = args.slice(2 + at * 3, 5 + at * 3);
        parts.push(
          await tokenAmount(token, bytesToBigInt(amount), bytesToBigInt(nonce))
        );
      }
      const rest = args.slice(2 + count * 3);
      const then =
        rest.length > 0
          ? `, then call ${describeCallOf(rest[0], rest.slice(1))} there`
          : '';
      return `Send ${parts.join(' and ')} to ${new Address(args[0]).toBech32()}${then}`;
    }
    case 'ESDTLocalMint':
      if (args.length !== 2) return null;
      return `Mint ${await tokenAmount(args[0], bytesToBigInt(args[1]))} into this safe`;
    case 'ESDTLocalBurn':
      if (args.length !== 2) return null;
      return `Burn ${await tokenAmount(args[0], bytesToBigInt(args[1]))} from this safe`;
    default:
      return null;
  }
};

// --- token operations ---------------------------------------------------------

/** The system contract that issues tokens and keeps their settings and roles. */
export const ESDT_SYSTEM_SC =
  'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzllls8a5w6u';

/** The system contract that creates delegation contracts. */
export const DELEGATION_MANAGER_SC =
  'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqylllslmq6y6';

export interface TokenOperation {
  token: string;
  sentence: string;
  /** What the sentence alone would undersell, said in red or amber on the card. */
  notes: { tone: 'warn' | 'bad'; text: string }[];
}

/** A flag of controlChanges and what each of its two values means. */
const TOKEN_FLAGS: Record<string, [on: string, off: string]> = {
  canFreeze: [
    "its owner can freeze any address's balance",
    'its owner can no longer freeze'
  ],
  canWipe: [
    "its owner can wipe a frozen address's balance",
    'its owner can no longer wipe'
  ],
  canPause: [
    'its owner can pause every transfer',
    'its owner can no longer pause'
  ],
  canMint: ['it can be minted', 'it can no longer be minted'],
  canBurn: ['it can be burned', 'it can no longer be burned'],
  canChangeOwner: [
    'it can be handed to a new owner',
    'it can no longer be handed to a new owner'
  ],
  canUpgrade: [
    'its settings can still be changed',
    'it can never be changed again, by anyone'
  ],
  canAddSpecialRoles: [
    'its owner can give roles, the minting and the transfer role included',
    'its owner can no longer give roles'
  ],
  canTransferNFTCreateRole: [
    'the role that creates NFTs can be moved to another address',
    'the role that creates NFTs can no longer be moved'
  ],
  canCreateMultiShard: [
    'it can be created in several shards',
    'it can no longer be created in several shards'
  ]
};

const describeControlChanges = (
  token: string,
  rest: Uint8Array[]
): TokenOperation | null => {
  if (rest.length === 0 || rest.length % 2 !== 0) return null;
  const pairs: [string, string][] = [];
  for (let at = 0; at < rest.length; at += 2) {
    pairs.push([decodeText(rest[at]), decodeText(rest[at + 1])]);
  }
  // The network runs them in order, so a flag named twice ends on its last value.
  const last = new Map(pairs);
  const words = pairs.map(([flag, value]) => {
    const meaning =
      TOKEN_FLAGS[flag] && value === last.get(flag)
        ? value === 'true'
          ? TOKEN_FLAGS[flag][0]
          : value === 'false'
            ? TOKEN_FLAGS[flag][1]
            : ''
        : '';
    return `${visible(flag)} ${visible(value)}${meaning ? ` (${meaning})` : ''}`;
  });
  const locks = last.get('canUpgrade') === 'false';
  return {
    token,
    sentence: `Change the settings of the token ${token}: ${words.join(', ')}${locks ? `. ${DO_NOT_SIGN}` : ''}`,
    notes: locks
      ? [
          {
            tone: 'bad',
            text: `After this the settings of ${token} are locked for good: it can never be changed again, by anyone, this board included.`
          }
        ]
      : []
  };
};

/** The roles of a role call, each with what it means when there is something to say. */
const roleNotes = (
  roles: string[],
  token: string,
  who: string,
  given: boolean
): TokenOperation['notes'] => {
  const notes: TokenOperation['notes'] = [];
  for (const role of roles) {
    if (role === 'ESDTTransferRole') {
      notes.push(
        given
          ? {
              tone: 'bad',
              text: `While any address holds ESDTTransferRole, every ordinary transfer of ${token} stops for everyone unless the sender or the receiver holds the role, until the last one is removed.`
            }
          : {
              tone: 'warn',
              text: `Ordinary transfers of ${token} run again only once the last holder of ESDTTransferRole is removed.`
            }
      );
    } else if (role === 'ESDTRoleLocalMint' && given) {
      notes.push({
        tone: 'bad',
        text: `${who} can then mint any amount of ${token}.`
      });
    }
  }
  return notes;
};

/**
 * A call on the system contract that manages tokens, in what it does, or null
 * for anything else, whose arguments stay raw. Argument counts are the
 * contract's own: what it would refuse is not described as if it ran (audits
 * SGN-03 and SGN-04, 1 Nov 2026).
 */
export const readTokenOperation = (
  to: string,
  name: string,
  args: Uint8Array[]
): TokenOperation | null => {
  if (to !== ESDT_SYSTEM_SC || args.length === 0) return null;
  const token = decodeText(args[0]);
  if (!TOKEN_ID.test(token)) return null;
  const who = args[1]?.length === 32 ? new Address(args[1]).toBech32() : '';
  const plain = (sentence: string, notes: TokenOperation['notes'] = []) => ({
    token,
    sentence,
    notes
  });
  switch (name) {
    case 'setSpecialRole':
    case 'unSetSpecialRole': {
      if (!who || args.length < 3) return null;
      const roles = args.slice(2).map(decodeText);
      const list = roles.map(visible).join(', ');
      const plural = roles.length > 1 ? 's' : '';
      const given = name === 'setSpecialRole';
      return plain(
        given
          ? `Give ${who} the role${plural} ${list} on the token ${token}`
          : `Take the role${plural} ${list} away from ${who} on the token ${token}`,
        roleNotes(roles, token, who, given)
      );
    }
    case 'controlChanges':
      return describeControlChanges(token, args.slice(1));
    case 'pause':
      if (args.length !== 1) return null;
      return plain(
        `Pause the token ${token}: every transfer of it stops, for everyone, until it is unpaused`,
        [
          {
            tone: 'bad',
            text: `While ${token} is paused, nobody can move it, this safe and every contract holding it included.`
          }
        ]
      );
    case 'unPause':
      if (args.length !== 1) return null;
      return plain(`Unpause the token ${token}: its transfers can run again`);
    case 'freeze':
      if (!who || args.length !== 2) return null;
      return plain(
        `Freeze what ${who} holds of the token ${token}: that address cannot send or receive it until it is unfrozen`
      );
    case 'unFreeze':
      if (!who || args.length !== 2) return null;
      return plain(`Unfreeze what ${who} holds of the token ${token}`);
    case 'wipe':
      if (!who || args.length !== 2) return null;
      return plain(
        `Wipe what ${who} holds of the token ${token}: a frozen balance is destroyed`,
        [
          {
            tone: 'bad',
            text: `What ${who} holds of ${token} would be gone for good.`
          }
        ]
      );
    case 'transferOwnership':
      if (!who || args.length !== 2) return null;
      return plain(
        `Hand the token ${token} over to ${who}, who becomes its owner, with all an owner's powers`,
        [
          {
            tone: 'bad',
            text: `The board cannot undo this: from then on only ${who} can act as the owner of ${token}.`
          }
        ]
      );
    default:
      return null;
  }
};

/** The token a call on that system contract names first, decoded or not. */
export const tokenInCall = (to: string, args: Uint8Array[]): string | null => {
  if (to !== ESDT_SYSTEM_SC || args.length === 0) return null;
  const token = decodeText(args[0]);
  return TOKEN_ID.test(token) ? token : null;
};

// --- calls on the safe itself ------------------------------------------------

/** An action id as it travels: a u32, on its own. Null for anything else. */
const actionIdOf = (args: Uint8Array[]): bigint | null =>
  args.length === 1 && args[0].length <= 4 ? bytesToBigInt(args[0]) : null;

const addressOf = (args: Uint8Array[]): string | null =>
  args.length === 1 && args[0].length === 32
    ? new Address(args[0]).toBech32()
    : null;

const IF_ON_ITS_BOARD =
  'That can only work if this safe holds a seat on its own board; otherwise the contract refuses it';
const IF_IT_HAS_A_ROLE =
  'That can only work if this safe holds a role on its own board or among its proposers; otherwise the contract refuses it';

/**
 * A call the safe makes on one of its own endpoints, in what it does. The
 * caller is then the safe itself, which owns itself and may hold a seat on its
 * own board, so these act with the board's authority (audits RED-02 and RED-06,
 * 1 Nov 2026). Null for anything not recognised, whose arguments stay raw.
 */
const describeOwnEndpoint = (
  name: string,
  args: Uint8Array[],
  egld: bigint,
  route: string
): string | null => {
  const id = actionIdOf(args);
  const who = addressOf(args);
  switch (name) {
    case 'dnsRegister': {
      // Owner only, which the safe is, and it forwards what it is paid: the one
      // way the safe's own EGLD reaches this endpoint. Run for real on devnet,
      // 1 Nov 2026, and the two ways of proposing it behave differently.
      if (args.length !== 2 || args[0].length !== 32) return null;
      const target = new Address(args[0]).toBech32();
      const register = `register(${visible(decodeText(args[1]))})`;
      const what =
        egld > 0n
          ? `send ${formatUnits(egld, 18)} EGLD out of this safe to ${target}, calling ${register} there`
          : `call ${register} on ${target} as this safe`;
      // With no EGLD nothing can be said to move: the devnet runs carried some.
      if (route === 'SendAsyncCall') {
        return `Try to ${what}, through the safe's own dnsRegister. Proposed this way (proposeAsyncCall) it failed on devnet: the network refused the inner call, ${egld > 0n ? 'the EGLD stayed in the safe ' : ''}and the action was used up with its signatures`;
      }
      return `${what.charAt(0).toUpperCase()}${what.slice(1)}, through the safe's own dnsRegister. Proposed this way (proposeTransferExecute) ${egld > 0n ? 'it really goes: on devnet the EGLD left the safe' : 'such a call really goes: it ran on devnet'}`;
    }
    case 'sign':
      if (id === null) return null;
      return `Have this safe approve action #${id} on the board's behalf, a signature that counts toward its quorum. ${IF_ON_ITS_BOARD}`;
    case 'unsign':
      if (id === null) return null;
      return `Have this safe take back its own approval of action #${id} on the board's behalf. ${IF_ON_ITS_BOARD}`;
    case 'performAction':
      if (id === null) return null;
      return `Have this safe carry out action #${id} on the board's behalf, whatever that action does. ${IF_IT_HAS_A_ROLE}`;
    case 'discardAction':
      if (id === null) return null;
      return `Have this safe throw away action #${id} on the board's behalf. ${IF_IT_HAS_A_ROLE}`;
    case 'proposeAddBoardMember':
      return who
        ? `Have this safe propose adding ${who} to the board. ${IF_IT_HAS_A_ROLE}`
        : null;
    case 'proposeAddProposer':
      return who
        ? `Have this safe propose adding ${who} as a proposer. ${IF_IT_HAS_A_ROLE}`
        : null;
    case 'proposeRemoveUser':
      return who
        ? `Have this safe propose removing ${who} from the board or the proposers. ${IF_IT_HAS_A_ROLE}`
        : null;
    case 'proposeChangeQuorum':
      if (id === null) return null;
      return `Have this safe propose changing the number of signatures needed to ${id}. ${IF_IT_HAS_A_ROLE}`;
    case 'proposeTransferExecute':
    case 'proposeAsyncCall': {
      if (args.length < 2 || args[0].length !== 32) return null;
      const then =
        args[2]?.length > 0
          ? `, calling ${describeCallOf(args[2], args.slice(3))} there`
          : '';
      return `Have this safe propose sending ${formatUnits(bytesToBigInt(args[1]), 18)} EGLD to ${new Address(args[0]).toBech32()}${then}. ${IF_IT_HAS_A_ROLE}`;
    }
    case 'proposeSCUpgradeFromSource':
    case 'proposeSCDeployFromSource':
      return `Have this safe propose ${describeCallOf(new TextEncoder().encode(name), args)}, which can replace or create a contract's code. ${IF_IT_HAS_A_ROLE}`;
    default:
      return null;
  }
};

/**
 * A vesting action in one sentence; the card lists every vesting under it.
 * Null when it is not one, or names another contract than the pinned mvxvest.
 */
const describeVesting = async (
  call: ReturnType<typeof readVestingCall>
): Promise<string | null> => {
  const pin = mvxvestFor(networkName);
  if (!call || !pin || call.contract !== pin.address) return null;
  if (call.kind === 'cancel') {
    // Only the pinned collection's keys are named a cancel of mvxvest's.
    if (
      call.keys.some((key) => key.token !== pin.cancelKey || key.amount !== 1n)
    )
      return null;
    const keys = call.keys.map((key) =>
      visible(keyIdentifier(key.token, key.nonce))
    );
    return `Cancel ${keys.length === 1 ? `the mvxvest vesting of the cancel key ${keys[0]}` : `${keys.length} mvxvest vestings, with the cancel keys ${keys.join(', ')}`}: this safe sends the key to mvxvest (${pin.address}), what has not vested yet comes back to this safe, and what has vested stays the beneficiary's`;
  }
  const batch = call.batch;
  if ('error' in batch)
    return `An mvxvest vesting whose vestings cannot be read. ${DO_NOT_SIGN}`;
  const payment = call.payments.find((paid) => paid.token !== 'EGLD-000000');
  const fee = call.payments.find((paid) => paid.token === 'EGLD-000000');
  const usual =
    payment &&
    payment.nonce === 0n &&
    payment.token !== 'EGLD' &&
    call.payments.filter((paid) => paid.token !== 'EGLD-000000').length === 1 &&
    call.payments.filter((paid) => paid.token === 'EGLD-000000').length <= 1;
  if (!usual || !payment) return null;
  const tokenBytes = new TextEncoder().encode(payment.token);
  const sum = batch.entries.reduce((total, entry) => total + entry.total, 0n);
  const count = batch.entries.length;
  const tokenFee = payment.amount - sum;
  const fees = [
    tokenFee > 0n
      ? `${await tokenAmount(tokenBytes, tokenFee)} of token fee`
      : '',
    fee ? `${formatUnits(fee.amount, 18)} EGLD of fee` : ''
  ].filter(Boolean);
  return (
    `Create ${count} ${batch.cancelable ? 'cancelable ' : ''}vesting${count === 1 ? '' : 's'} of ${await tokenAmount(tokenBytes, sum)} in all on mvxvest (${pin.address})` +
    (batch.label ? `, labelled "${visible(batch.label)}"` : '') +
    (fees.length ? `, paying ${fees.join(' and ')} on top` : '') +
    `. ${batch.cancelable ? 'Its cancel keys come to this safe.' : 'Nobody will be able to cancel them.'} Each vesting is listed below`
  );
};

const describeCall = async (
  data: any,
  safe: string,
  route: string
): Promise<string> => {
  const { to, egld, endpoint, args } = readCall(data);
  if (!to || egld === null) return `Unreadable action. ${DO_NOT_SIGN}`;
  const name = decodeText(endpoint);
  const alsoEgld =
    egld > 0n ? `, sending ${formatUnits(egld, 18)} EGLD with it` : '';

  if (!name && args.length === 0) {
    return egld > 0n
      ? `Send ${formatUnits(egld, 18)} EGLD to ${to}`
      : `Unreadable call to ${to}: no amount and no function. ${DO_NOT_SIGN}`;
  }

  // A vesting on the pinned mvxvest, said for what it does. One that names
  // any other contract keeps the plain sentence below, and its card is red.
  // Only in the shapes mvxsafe proposes: with EGLD next to it, or paid in
  // other transfers, the plain sentence below names everything (VCD-01, VCD-05).
  const vesting =
    egld > 0n
      ? null
      : await describeVesting(
          readVestingCall({ to, egld, endpoint: name, args, safe })
        );
  if (vesting) return vesting;

  // A token leaving the safe: ESDTTransfer, run for the recipient.
  if (name === 'ESDTTransfer' && args.length >= 2) {
    const what = await tokenAmount(args[0], bytesToBigInt(args[1]));
    const then =
      args.length > 2
        ? `, then call ${describeCallOf(args[2], args.slice(3))} there`
        : '';
    return `Send ${what} to ${to}${then}${alsoEgld}`;
  }

  // Replacing a contract's code with code carried in the proposal itself, the
  // built-in the SDK's own upgrade sends: upgradeContract@<code>@<metadata>.
  // Said for what it is, as an upgrade from source is (audit UPG-01, 14 Oct
  // 2026); mvxsafe itself only upgrades from a source the board can check.
  if (name === 'upgradeContract' && args.length >= 2) {
    const flags = metadataOf(args[1]);
    if (!flags)
      return `Unreadable upgrade of ${to === safe ? 'THIS SAFE' : to}. ${DO_NOT_SIGN}`;
    const rest = args.slice(2).map(describeArgument);
    return (
      `Replace the code of ${to === safe ? `THIS SAFE (${to})` : `the contract ${to}`} with ` +
      `${args[0].length.toLocaleString('en-US')} bytes of code carried in the proposal itself, ` +
      `code hash ${codeHashOf(args[0])}${alsoEgld}, with the arguments (${rest.join(', ')}). ` +
      `Afterwards it is ${describeMetadata(flags)}` +
      (flags.upgradeable ? '' : ': it can never be changed again, by anyone') +
      `. ${DO_NOT_SIGN}`
    );
  }

  // The one built-in a call may name, harmless: it pays the contract's
  // developer rewards to its owner.
  if (name === 'ClaimDeveloperRewards' && args.length === 0) {
    return `Collect the developer rewards of ${to === safe ? 'this safe' : `the contract ${to}`} into its owner${alsoEgld}`;
  }

  // Handing a contract to someone else: the safe stops being its owner, and
  // the new owner alone may replace its code from then on.
  if (
    name === 'ChangeOwnerAddress' &&
    args.length === 1 &&
    args[0].length === 32
  ) {
    const owner = new Address(args[0]).toBech32();
    return to === safe
      ? `Hand THIS SAFE over to ${owner}, who could then replace its code alone, without the board${alsoEgld}. ${DO_NOT_SIGN}`
      : `Hand the contract ${to} over to ${owner}: the safe would no longer own it${alsoEgld}`;
  }

  const operation = readTokenOperation(to, name, args);
  if (operation) return `${operation.sentence}${alsoEgld}`;

  if (to === safe) {
    const builtIn = await describeOnItself(name, args);
    if (builtIn) return `${builtIn}${alsoEgld}`;
    const own = describeOwnEndpoint(name, args, egld, route);
    if (own) {
      // dnsRegister says its EGLD for itself, as where it goes.
      const paid = name === 'dnsRegister' ? '' : alsoEgld;
      return `${own}${paid}. ${DO_NOT_SIGN}`;
    }
    return `Call ${describeCallOf(endpoint, args)} on this safe itself${alsoEgld}. ${DO_NOT_SIGN}`;
  }

  return `Call ${describeCallOf(endpoint, args)} on ${to}${alsoEgld}`;
};

// --- the action --------------------------------------------------------------

/**
 * Plain language for one decoded action. Async because a token's decimals have
 * to be looked up before its amount can be written truthfully.
 */
export const describeAction = async (
  action: any,
  safe: string
): Promise<string> => {
  if (!action) return `Unknown action. ${DO_NOT_SIGN}`;
  const name = String(action.name ?? action.type ?? 'Unknown');
  const fields = action.fields ?? [];

  switch (name) {
    case 'Nothing':
      return 'Already carried out or discarded';
    case 'AddBoardMember':
      return `Add ${asAddress(fields[0])} to the board`;
    case 'AddProposer':
      return `Add ${asAddress(fields[0])} as a proposer`;
    case 'RemoveUser':
      return `Remove ${asAddress(fields[0])} from the board or the proposers`;
    case 'ChangeQuorum':
      return `Change the number of signatures needed to ${Number(toBigInt(fields[0]) ?? 0n)}`;
    case 'SendTransferExecute':
    case 'SendAsyncCall':
      return describeCall(fields[0], safe, name);
    case 'SCDeployFromSource': {
      // The new contract's metadata is said too, as an upgrade's is (SEE-02).
      const [amount, source, metadata, args] = fields;
      const egld = toBigInt(amount);
      const flags = metadataOf(metadata);
      if (egld === null || !flags) return `Unreadable deploy. ${DO_NOT_SIGN}`;
      const list = (args ?? []).map((arg: any) =>
        describeArgument(bytesOf(arg) ?? new Uint8Array(0))
      );
      return (
        `Deploy a new contract with the code of ${asAddress(source)}` +
        (egld > 0n ? `, sending ${formatUnits(egld, 18)} EGLD to it` : '') +
        `, with the arguments (${list.join(', ')}). It will be ${describeMetadata(flags)}`
      );
    }
    case 'SCUpgradeFromSource': {
      const [target, amount, source, metadata, args] = fields;
      const egld = toBigInt(amount);
      const flags = metadataOf(metadata);
      if (egld === null || !flags) return `Unreadable upgrade. ${DO_NOT_SIGN}`;
      const list = (args ?? []).map((arg: any) =>
        describeArgument(bytesOf(arg) ?? new Uint8Array(0))
      );
      // The safe replacing its own code: as loud as handing it over (UPG-02).
      const itself = asAddress(target) === safe;
      return (
        (itself
          ? `Upgrade THIS SAFE (${asAddress(target)}), the multisig the board signs with, replacing its code with the code of ${asAddress(source)}`
          : `Upgrade the contract ${asAddress(target)}, replacing its code with the code of ${asAddress(source)}`) +
        (egld > 0n ? `, sending ${formatUnits(egld, 18)} EGLD to it` : '') +
        `, with the arguments (${list.join(', ')}). Afterwards it is ${describeMetadata(flags)}` +
        (flags.upgradeable
          ? ''
          : ': it can never be changed again, by anyone') +
        (itself || !flags.upgradeable ? `. ${DO_NOT_SIGN}` : '')
      );
    }
    default:
      return `Unknown action (${visible(name)}). ${DO_NOT_SIGN}`;
  }
};
