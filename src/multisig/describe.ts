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
import { api, cached } from './network';

const DO_NOT_SIGN = 'Do not sign without checking it in the explorer.';

// --- values as the SDK hands them back ---------------------------------------

/** Bytes from whatever the decoder returned. ArrayBuffer.isView works across realms. */
export const bytesOf = (value: any): Uint8Array | null => {
  if (!value) return null;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value.type === 'Buffer' && Array.isArray(value.data)) return new Uint8Array(value.data);
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
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  const text =
    typeof value.toFixed === 'function' ? value.toFixed() : String(value?.toString?.() ?? value);
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
  text.replace(/[^\x20-\x7E]/gu, (char) =>
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
    decimals > 0 ? (value % base).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
};

const groupDigits = (raw: bigint) => raw.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

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
export const readTokenMeta = async (identifier: string, withNonce: boolean): Promise<TokenMeta> => {
  if (!TOKEN_ID.test(identifier)) return { decimals: null };
  const path = withNonce ? `/collections/${identifier}` : `/tokens/${identifier}`;
  try {
    const answer = await cached(`token:${path}`, () =>
      api<{ decimals?: number; type?: string }>(path)
    );
    if (answer?.type === 'NonFungibleESDT' || answer?.type === 'SemiFungibleESDT') {
      return { decimals: 0 };
    }
    const decimals = answer?.decimals;
    return {
      decimals: Number.isInteger(decimals) && decimals! >= 0 && decimals! <= 32 ? decimals! : null
    };
  } catch {
    return { decimals: null };
  }
};

/** "0.1 WEGLD-a28c59", or the raw number with a warning when decimals are unknown. */
const tokenAmount = async (identifierBytes: Uint8Array, amount: bigint, nonce = 0n) => {
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

/**
 * One argument of a call, as readably as it can be told apart: 32 bytes are an
 * address, a word is text, anything else a number, and long binary is hex.
 */
const describeArgument = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return '0';
  if (bytes.length === 32) return new Address(bytes).toBech32();
  const text = decodeText(bytes);
  if (/^[A-Za-z][A-Za-z0-9_.\-]*$/.test(text)) return text;
  if (bytes.length <= 32) return groupDigits(bytesToBigInt(bytes));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

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
  args: (data?.arguments ?? []).map((arg: any) => bytesOf(arg) ?? new Uint8Array(0))
});

/** Built-in token functions the safe runs on ITSELF, with the real recipient inside. */
const describeOnItself = async (name: string, args: Uint8Array[]): Promise<string | null> => {
  switch (name) {
    case 'ESDTNFTTransfer': {
      // token, nonce, amount, receiver, then optionally a function and its arguments
      if (args.length < 4 || args[3].length !== 32) return null;
      const what = await tokenAmount(args[0], bytesToBigInt(args[2]), bytesToBigInt(args[1]));
      const then = args.length > 4 ? `, then call ${describeCallOf(args[4], args.slice(5))} there` : '';
      return `Send ${what} to ${new Address(args[3]).toBech32()}${then}`;
    }
    case 'MultiESDTNFTTransfer': {
      // receiver, count, count times (token, nonce, amount), then optionally a call
      if (args.length < 2 || args[0].length !== 32) return null;
      const count = Number(bytesToBigInt(args[1]));
      if (!Number.isInteger(count) || count < 1 || args.length < 2 + count * 3) return null;
      const parts: string[] = [];
      for (let at = 0; at < count; at++) {
        const [token, nonce, amount] = args.slice(2 + at * 3, 5 + at * 3);
        parts.push(await tokenAmount(token, bytesToBigInt(amount), bytesToBigInt(nonce)));
      }
      const rest = args.slice(2 + count * 3);
      const then = rest.length > 0 ? `, then call ${describeCallOf(rest[0], rest.slice(1))} there` : '';
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

const describeCall = async (data: any, safe: string): Promise<string> => {
  const { to, egld, endpoint, args } = readCall(data);
  if (!to || egld === null) return `Unreadable action. ${DO_NOT_SIGN}`;
  const name = decodeText(endpoint);
  const alsoEgld = egld > 0n ? `, sending ${formatUnits(egld, 18)} EGLD with it` : '';

  if (!name && args.length === 0) {
    return egld > 0n
      ? `Send ${formatUnits(egld, 18)} EGLD to ${to}`
      : `Unreadable call to ${to}: no amount and no function. ${DO_NOT_SIGN}`;
  }

  // A token leaving the safe: ESDTTransfer, run for the recipient.
  if (name === 'ESDTTransfer' && args.length >= 2) {
    const what = await tokenAmount(args[0], bytesToBigInt(args[1]));
    const then = args.length > 2 ? `, then call ${describeCallOf(args[2], args.slice(3))} there` : '';
    return `Send ${what} to ${to}${then}${alsoEgld}`;
  }

  if (to === safe) {
    const builtIn = await describeOnItself(name, args);
    if (builtIn) return `${builtIn}${alsoEgld}`;
    return `Call ${describeCallOf(endpoint, args)} on this safe itself${alsoEgld}. ${DO_NOT_SIGN}`;
  }

  return `Call ${describeCallOf(endpoint, args)} on ${to}${alsoEgld}`;
};

// --- the action --------------------------------------------------------------

/**
 * Plain language for one decoded action. Async because a token's decimals have
 * to be looked up before its amount can be written truthfully.
 */
export const describeAction = async (action: any, safe: string): Promise<string> => {
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
      return describeCall(fields[0], safe);
    case 'SCDeployFromSource': {
      const [amount, source, , args] = fields;
      const egld = toBigInt(amount);
      if (egld === null) return `Unreadable deploy. ${DO_NOT_SIGN}`;
      const list = (args ?? []).map((arg: any) => describeArgument(bytesOf(arg) ?? new Uint8Array(0)));
      return (
        `Deploy a new contract with the code of ${asAddress(source)}` +
        (egld > 0n ? `, sending ${formatUnits(egld, 18)} EGLD to it` : '') +
        `, with the arguments (${list.join(', ')})`
      );
    }
    case 'SCUpgradeFromSource': {
      const [target, amount, source, , args] = fields;
      const egld = toBigInt(amount);
      if (egld === null) return `Unreadable upgrade. ${DO_NOT_SIGN}`;
      const list = (args ?? []).map((arg: any) => describeArgument(bytesOf(arg) ?? new Uint8Array(0)));
      return (
        `Upgrade the contract ${asAddress(target)}, replacing its code with the code of ${asAddress(source)}` +
        (egld > 0n ? `, sending ${formatUnits(egld, 18)} EGLD to it` : '') +
        `, with the arguments (${list.join(', ')})`
      );
    }
    default:
      return `Unknown action (${visible(name)}). ${DO_NOT_SIGN}`;
  }
};
