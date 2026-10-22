// What a signer needs to see next to an action's sentence before signing it,
// read from the chain at that moment: for an upgrade, the code it brings in,
// the code it replaces, the shard rule and the metadata; for a call, whether
// it works when the safe sends it; and for both, the gas that carrying it out
// will be given. Everything here is a read. Nothing signs.

import { Address } from '@multiversx/sdk-core';
import {
  bytesOf,
  describeMetadata,
  metadataChanges,
  MetadataFlags,
  metadataOf,
  toBigInt
} from './describe';
import {
  GasError,
  measureCall,
  MeasuredHow,
  performPlan,
  PerformPlan
} from './gas';
import {
  codeHashOf,
  isSystemContract,
  normalizeCodeHash,
  PROTOCOL_BUILTINS,
  shardOf
} from './legacyCalls';
import { api, cached, chainId, networkProvider } from './network';

export type Tone = 'ok' | 'warn' | 'bad';

/** One line under an action: green for a check that passed, red for one that did not. */
export interface Check {
  tone: Tone;
  text: string;
  /** Red but allowed: said loudly, and not a reason to refuse the proposal. */
  advisory?: boolean;
}

export interface AccountFacts {
  address: string;
  shard: number;
  ownerAddress: string;
  /**
   * 64 hex characters, or null when the address holds no code: the hash of
   * the code the API returned, or the hash it states when it returned none.
   * Then codeUnread is true, and the hash is only the API's word.
   */
  codeHash: string | null;
  /** The API stated a hash that is not the hash of the code it returned. */
  codeHashMismatch?: boolean;
  /**
   * The API stated a code hash but returned no code that could be hashed
   * (missing, empty, odd length, not hex): the hash is unverified and the size
   * unknown. Nothing may be called a match on it (found by the mvxvest side,
   * 23 Oct 2026).
   */
  codeUnread: boolean;
  /** Size of the code in bytes, 0 when unknown. */
  codeBytes: number;
  /** Null for an account without code, or when the API did not say. */
  metadata: MetadataFlags | null;
  balance: bigint;
}

interface AccountResponse {
  shard?: number;
  ownerAddress?: string;
  codeHash?: string;
  code?: string;
  balance?: string;
  isUpgradeable?: boolean;
  isReadable?: boolean;
  isPayable?: boolean;
  isPayableBySmartContract?: boolean;
}

/**
 * Shard, owner, code hash (as hex: the API gives base64), code size and code
 * metadata of an address. The shard comes from the address itself, which is
 * where the network puts it; the API's own figure only has to agree.
 */
export const readAccountFacts = async (
  address: string
): Promise<AccountFacts> => {
  const account = await api<AccountResponse>(`/accounts/${address}`);
  const stated = account?.codeHash ? normalizeCodeHash(account.codeHash) : null;
  // The code itself, hashed here: the stated hash is only the API's word for
  // it, and a signer compares it with the release (EXT-01, 21 Oct 2026).
  const code =
    typeof account?.code === 'string' &&
    account.code.length > 0 &&
    account.code.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(account.code)
      ? Uint8Array.from(account.code.match(/../g) as string[], (pair) =>
          parseInt(pair, 16)
        )
      : null;
  const hashed = stated && code ? codeHashOf(code) : null;
  const codeHash = hashed ?? stated;
  return {
    address,
    shard: shardOf(address),
    ownerAddress: account?.ownerAddress ?? '',
    codeHash,
    codeHashMismatch: Boolean(hashed && stated && hashed !== stated),
    codeUnread: Boolean(stated && !hashed),
    // The size of the code that was hashed, or 0 (unknown): a code never read
    // gave a size, and with it a gas budget called measured (review of PR #17).
    codeBytes: hashed && code ? code.length : 0,
    metadata:
      codeHash && typeof account?.isUpgradeable === 'boolean'
        ? {
            upgradeable: Boolean(account.isUpgradeable),
            readable: Boolean(account.isReadable),
            payable: Boolean(account.isPayable),
            payableBySc: Boolean(account.isPayableBySmartContract)
          }
        : null,
    balance: BigInt(account?.balance ?? '0')
  };
};

const asAddress = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toBech32 === 'function') return value.toBech32();
  const bytes = bytesOf(value);
  return bytes?.length === 32 ? new Address(bytes).toBech32() : '';
};

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The facts about an upgrade the card shows beside the code hashes. */
export interface UpgradeFacts {
  target: string;
  source: string;
  /**
   * Null when the source holds no code or could not be read, and when the API
   * stated a hash without returning the code (sourceUnread): only a hash of
   * the code itself is shown or compared.
   */
  sourceHash: string | null;
  targetHash: string | null;
  sourceUnread?: boolean;
  targetUnread?: boolean;
  sourceShard: number;
  safeShard: number;
}

export interface Inspection {
  checks: Check[];
  upgrade?: UpgradeFacts;
  perform: PerformPlan;
}

// --- upgrades ----------------------------------------------------------------

/**
 * Everything that decides whether an upgrade will do what it says, as a
 * list a signer reads before signing. The rules are the propose form's, so an
 * upgrade proposed some other way is held to them too.
 */
export const inspectUpgrade = async (
  fields: any[],
  safe: string
): Promise<Inspection> => {
  const [targetValue, , sourceValue, metadataValue] = fields;
  const target = asAddress(targetValue);
  const source = asAddress(sourceValue);
  const flags = metadataOf(metadataValue);
  const safeShard = shardOf(safe);
  const sourceShard = source ? shardOf(source) : -1;
  const checks: Check[] = [];

  // The builder refuses it, but another tool can propose it (audit UPG-02).
  if (target === safe) {
    checks.push({
      tone: 'bad',
      text: 'This replaces the code of THIS SAFE, the multisig the board signs with. mvxsafe never proposes that; do not sign it unless every board member has checked the new code.'
    });
  }

  // The shard rule needs no network: it follows from the addresses.
  checks.push(
    sourceShard === safeShard
      ? {
          tone: 'ok',
          text: `The source is in shard ${sourceShard}, the safe's own shard.`
        }
      : {
          tone: 'bad',
          text: `The source is in shard ${sourceShard} and the safe in shard ${safeShard}. Carrying this out will fail after the signatures and use the action up. Do not sign it; propose it again with a source in shard ${safeShard}.`
        }
  );

  let sourceFacts: AccountFacts | null = null;
  let targetFacts: AccountFacts | null = null;
  try {
    [sourceFacts, targetFacts] = await Promise.all([
      readAccountFacts(source),
      readAccountFacts(target)
    ]);
  } catch {
    checks.push({
      tone: 'warn',
      text: 'The source and the contract could not be read just now, so their code is not shown. Refresh before signing.'
    });
  }

  for (const [facts, which] of [
    [sourceFacts, 'the source'],
    [targetFacts, 'the contract to upgrade']
  ] as const) {
    if (facts?.codeHashMismatch) {
      checks.push({
        tone: 'bad',
        text: `The code hash the network's API states for ${which} does not match the code it returned. The hash shown is the code's own. Check both on another explorer before signing.`
      });
    }
  }
  // Blocking, not advisory: the hash would be the API's word alone, and the
  // source's size, which the upgrade's gas is worked out from, unknown.
  if (sourceFacts?.codeUnread) {
    checks.push({
      tone: 'bad',
      text: "The network's API did not return the source's code, so its hash and size (and the upgrade's gas) are unknown. Refresh and try again before signing."
    });
  }
  if (targetFacts?.codeUnread) {
    checks.push({
      tone: 'bad',
      text: "The network's API did not return the code of the contract to upgrade, so the code it runs today is unknown. Refresh and try again before signing."
    });
  }

  if (sourceFacts) {
    if (!sourceFacts.codeHash) {
      checks.push({
        tone: 'bad',
        text: 'The source holds no code. Carrying this out would fail.'
      });
    } else if (!sourceFacts.metadata && sourceFacts.ownerAddress !== safe) {
      checks.push({
        tone: 'warn',
        text: `The network's API does not say whether the source is upgradeable. If it is, its owner ${sourceFacts.ownerAddress || '(unknown)'} can replace its code before this is carried out. Check it on another explorer before signing.`
      });
    } else if (
      sourceFacts.metadata?.upgradeable &&
      sourceFacts.ownerAddress !== safe
    ) {
      checks.push({
        tone: 'bad',
        text: `The source is upgradeable: its owner ${sourceFacts.ownerAddress || '(unknown)'} can replace its code before this is carried out. The upgrade would copy whatever is there then. A source should be deployed not upgradeable.`
      });
    }
  }

  if (targetFacts) {
    if (!targetFacts.codeHash) {
      checks.push({
        tone: 'bad',
        text: 'The contract to upgrade holds no code.'
      });
    } else {
      checks.push(
        targetFacts.ownerAddress === safe
          ? {
              tone: 'ok',
              text: 'The safe owns the contract, so it may upgrade it.'
            }
          : {
              tone: 'bad',
              text: `The safe does not own this contract (its owner is ${targetFacts.ownerAddress || 'unknown'}), so the network will refuse the upgrade.`
            }
      );
      if (targetFacts.metadata && !targetFacts.metadata.upgradeable) {
        checks.push({
          tone: 'bad',
          text: 'The contract is not upgradeable today. Nobody can change its code.'
        });
      }
    }
  }

  if (!flags) {
    checks.push({
      tone: 'bad',
      text: 'The new code metadata could not be read.'
    });
  } else if (!flags.upgradeable) {
    checks.push({
      tone: 'bad',
      text: 'After this the contract is NOT upgradeable: it can never be changed again, by anyone, this board included.'
    });
  } else if (targetFacts?.codeHash && !targetFacts.metadata) {
    checks.push({
      tone: 'warn',
      text: `The network's API does not say whether the contract is upgradeable today, so the new metadata (${describeMetadata(flags)}) cannot be compared with its current one. Check it on another explorer before signing.`
    });
  } else if (targetFacts?.metadata) {
    const changes = metadataChanges(targetFacts.metadata, flags);
    checks.push(
      changes.length === 0
        ? {
            tone: 'ok',
            text: `The metadata stays as it is: ${describeMetadata(flags)}.`
          }
        : {
            tone: 'bad',
            advisory: true,
            text: `The metadata changes: the contract ${changes.join(', ')}. Today it is ${describeMetadata(targetFacts.metadata)}.`
          }
    );
  }

  if (
    sourceFacts?.codeHash &&
    targetFacts?.codeHash &&
    !sourceFacts.codeUnread &&
    !targetFacts.codeUnread &&
    sourceFacts.codeHash === targetFacts.codeHash
  ) {
    checks.push({
      tone: 'warn',
      text: "The source runs the same code as the contract today: the upgrade changes no code, it only runs the contract's upgrade function."
    });
  }

  return {
    checks,
    upgrade: {
      target,
      source,
      sourceHash: sourceFacts?.codeUnread
        ? null
        : (sourceFacts?.codeHash ?? null),
      targetHash: targetFacts?.codeUnread
        ? null
        : (targetFacts?.codeHash ?? null),
      sourceUnread: Boolean(sourceFacts?.codeUnread),
      targetUnread: Boolean(targetFacts?.codeUnread),
      sourceShard,
      safeShard
    },
    perform: performPlan({
      name: 'SCUpgradeFromSource',
      codeBytes: sourceFacts?.codeBytes || undefined
    })
  };
};

// --- calls -------------------------------------------------------------------

/** "setFee@2386f26fc10000": the call as the safe will send it. */
export const callData = (endpoint: Uint8Array, args: Uint8Array[]) =>
  [new TextDecoder().decode(endpoint), ...args.map(hexOf)].join('@');

/** A call tried as the safe: what it needs, how that was found, or why it fails. */
export type Trial =
  | { need: bigint | null; how: MeasuredHow }
  | { need: null; how: 'refused'; error: GasError };

/**
 * The call tried as the SAFE sends it, owner checks included (measureCall in
 * gas.js). Kept with the rest of what is read about this safe, so a
 * transaction to it drops this too.
 */
export const trialAsSafe = async (
  safe: string,
  to: string,
  egld: bigint,
  data: string
): Promise<Trial> => {
  try {
    return await cached(`trial:${safe}:${to}:${egld}:${data}`, () =>
      measureCall(networkProvider, { chainId, safe, to, egld, data })
    );
  } catch (error) {
    if (error instanceof GasError && error.refused)
      return { need: null, how: 'refused', error };
    return { need: null, how: 'offline' };
  }
};

/** What a trial means for a signer, in one line. */
export const trialCheck = (trial: Trial): Check => {
  switch (trial.how) {
    case 'tried':
      return {
        tone: 'ok',
        text: `Tried just now as the safe would send it: it works and needs ${trial.need?.toLocaleString('en-US')} gas.`
      };
    case 'token':
      return {
        tone: 'ok',
        text: `A token transfer: the network's fixed cost for it is ${trial.need?.toLocaleString('en-US')} gas.`
      };
    case 'unmeasured':
      return {
        tone: 'warn',
        text: 'The network could not try it in advance: it runs in another shard. The gas below is a default.'
      };
    case 'fee':
      return {
        tone: 'warn',
        text: 'It could not be tried in advance: the network wants the safe to hold about 0.0061 EGLD to try a call; it holds less. The gas below is a default.'
      };
    case 'refused':
      // Red, but advisory on a pending card: the contract's state can change
      // between the proposal and the perform. The propose form refuses it outright.
      return {
        tone: 'bad',
        advisory: true,
        text: `Tried just now as the safe would send it, the call FAILS: ${trial.error.message}. Carried out like this, it would use the action up.`
      };
    default:
      return {
        tone: 'warn',
        text: 'It could not be tried in advance just now (the network did not answer). The gas below is a default; Refresh to try again.'
      };
  }
};

/** The built-ins a safe uses every day: a token sent, and its own tokens moved, minted or burnt. */
const TOKEN_MOVES_ON_ITSELF = new Set([
  'ESDTNFTTransfer',
  'MultiESDTNFTTransfer',
  'ESDTLocalMint',
  'ESDTLocalBurn'
]);

/**
 * Red checks for what a call does outside a contract's own functions: a
 * built-in of the network, or a system contract. Said loudly, since a
 * compromised signer can use them to replace an owned contract's code, hand
 * it away, or change a token's roles (audit UPG-01 and mvxvest's audit,
 * 14 Oct 2026).
 */
export const builtInChecks = (
  name: string,
  to: string,
  safe: string
): Check[] => {
  const checks: Check[] = [];
  if (name === 'upgradeContract') {
    checks.push({
      tone: 'bad',
      text: 'This replaces the contract\'s code with code carried in the proposal itself, not copied from a source. Its code hash is in the sentence above; a large code cannot be carried out at all. mvxsafe proposes upgrades only through "Upgrade a contract".'
    });
  } else if (name === 'ChangeOwnerAddress') {
    checks.push({
      tone: 'bad',
      text: `This hands ${to === safe ? 'THIS SAFE' : 'the contract'} to a new owner. Afterwards the board can no longer change its code or call its owner functions. It cannot undo this.`
    });
  } else if (
    PROTOCOL_BUILTINS.has(name) &&
    name !== 'ESDTTransfer' &&
    name !== 'ClaimDeveloperRewards' &&
    !(to === safe && TOKEN_MOVES_ON_ITSELF.has(name))
  ) {
    checks.push({
      tone: 'bad',
      text: `${name} is a built-in function of the network, not a function of the contract: it acts on the account it is sent to. mvxsafe never proposes it. Check it in the explorer with every board member before signing.`
    });
  }
  if (to && isSystemContract(to)) {
    checks.push({
      tone: 'bad',
      text: 'This calls a system contract of the network (tokens, staking, governance). It can change who may mint, burn, freeze or own a token. It can also move stake. Check every argument against what the board agreed.'
    });
  }
  return checks;
};

/**
 * The function a token transfer calls after it, if any: ESDTTransfer's third
 * argument, ESDTNFTTransfer's fifth, MultiESDTNFTTransfer's after its tokens.
 */
const functionAfterTransfer = (name: string, args: Uint8Array[]): string => {
  const text = (bytes?: Uint8Array) =>
    bytes ? new TextDecoder().decode(bytes) : '';
  if (name === 'ESDTTransfer') return text(args[2]);
  if (name === 'ESDTNFTTransfer') return text(args[4]);
  if (name === 'MultiESDTNFTTransfer' && args.length >= 2) {
    let count = 0;
    for (const byte of args[1]) count = count * 256 + byte;
    return text(args[2 + count * 3]);
  }
  return '';
};

/**
 * A built-in named AFTER a token transfer runs on the receiver with the safe as
 * the caller: ESDTTransfer(token, amount, ChangeOwnerAddress, someone) sent to
 * a contract the safe owns hands it away. As red as the same built-in named
 * on its own (audit SEE-03, 21 Oct 2026).
 */
export const nestedBuiltInChecks = (
  name: string,
  args: Uint8Array[]
): Check[] => {
  const after = functionAfterTransfer(name, args);
  if (
    !after ||
    !PROTOCOL_BUILTINS.has(after) ||
    after === 'ClaimDeveloperRewards'
  )
    return [];
  return [
    {
      tone: 'bad',
      text: `After the token transfer it calls ${after}, a built-in function of the network, on the receiving account with the safe as the caller. mvxsafe never proposes that. Check it in the explorer with every board member before signing.`
    }
  ];
};

/**
 * A call that leaves the safe: whom it goes to, whether it works when the safe
 * sends it, and the gas a perform gets from that.
 */
export const inspectCall = async (
  name: string,
  data: any,
  safe: string
): Promise<Inspection> => {
  const to = asAddress(data?.to);
  const egld = toBigInt(data?.egld_amount) ?? 0n;
  const endpoint = bytesOf(data?.endpoint_name) ?? new Uint8Array(0);
  const args: Uint8Array[] = (data?.arguments ?? []).map(
    (arg: any) => bytesOf(arg) ?? new Uint8Array(0)
  );
  const hasFunction = endpoint.length > 0;
  const checks: Check[] = [];

  // A plain EGLD transfer: nothing to try, a wallet runs nothing.
  if (name === 'SendTransferExecute' && !hasFunction) {
    return { checks, perform: performPlan({ name, hasFunction }) };
  }

  // A code replacement dressed as a call (audit UPG-01, 14 Oct 2026). Its code
  // cannot be checked against a release here, and a large one cannot even be
  // carried out: the stored action is too big ("storage decode error").
  checks.push(...builtInChecks(new TextDecoder().decode(endpoint), to, safe));
  checks.push(...nestedBuiltInChecks(new TextDecoder().decode(endpoint), args));

  let callNeed: bigint | null = null;
  if (to && hasFunction) {
    const trial = await trialAsSafe(safe, to, egld, callData(endpoint, args));
    checks.push(trialCheck(trial));
    callNeed = trial.need;
  }

  // Who owns a contract it calls, which is what makes an owner's endpoint work.
  if (to && Address.newFromBech32(to).isSmartContract() && to !== safe) {
    try {
      const facts = await readAccountFacts(to);
      if (facts.codeHash) {
        checks.push(
          facts.ownerAddress === safe
            ? { tone: 'ok', text: 'The safe owns the contract it calls.' }
            : {
                tone: 'warn',
                text: `The safe does not own the contract it calls; its owner is ${facts.ownerAddress || 'unknown'}. Owner-only functions will refuse it.`
              }
        );
      }
    } catch {
      // Unknown owner: nothing claimed either way.
    }
  }

  return { checks, perform: performPlan({ name, callNeed, hasFunction }) };
};

/**
 * The checks and the perform plan for one pending action. Never throws: what
 * could not be read is said as a check, and the gas falls back to a default
 * the performer sees.
 */
export const inspectAction = async (
  action: any,
  safe: string
): Promise<Inspection> => {
  const name = String(action?.name ?? action?.type ?? '');
  const fields = action?.fields ?? [];
  try {
    switch (name) {
      case 'SCUpgradeFromSource':
        return await inspectUpgrade(fields, safe);
      case 'SendAsyncCall':
      case 'SendTransferExecute':
        return await inspectCall(name, fields[0], safe);
      case 'ChangeQuorum': {
        // The contract accepts a quorum of 0 (audit SC-02, 21 Oct 2026).
        const next = toBigInt(fields[0]) ?? 0n;
        return {
          checks:
            next < 1n
              ? [
                  {
                    tone: 'bad',
                    text: "A quorum of 0: after this no action needs any signature, so any single board member or proposer could carry out anything, the safe's funds included. Do not sign it."
                  }
                ]
              : [],
          perform: performPlan({ name })
        };
      }
      default:
        return { checks: [], perform: performPlan({ name }) };
    }
  } catch {
    return { checks: [], perform: performPlan({ name }) };
  }
};

/** The hex a signer pasted, compared with the code the upgrade brings in. */
export const expectedHashCheck = (
  pasted: string,
  actual: string | null,
  /** What is compared: the source on chain, or the file before it is deployed. */
  what: 'the source' | 'the file' = 'the source',
  /** The API stated a hash for it but did not return the code (codeUnread). */
  unread = false
): Check | null => {
  if (!pasted.trim()) return null;
  const expected = normalizeCodeHash(pasted);
  if (!expected)
    return { tone: 'bad', text: 'That is not a code hash: 64 hex characters.' };
  if (unread) {
    return {
      tone: 'bad',
      text: `The code of ${what} could not be read just now, so its hash cannot be checked. Refresh and try again.`
    };
  }
  if (!actual) {
    return {
      tone: 'bad',
      text: `${what === 'the file' ? 'The file' : 'The source'} has no code hash to compare with.`
    };
  }
  return expected === actual
    ? { tone: 'ok', text: `Matches the code hash of ${what}.` }
    : {
        tone: 'bad',
        text: `Does NOT match the code hash of ${what}. Do not ${what === 'the file' ? 'deploy it' : 'sign'}.`
      };
};

export { hexOf };
