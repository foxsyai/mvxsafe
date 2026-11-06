// What a signer needs to see next to an action's sentence before signing it,
// read from the chain at that moment: for an upgrade, the code it brings in,
// the code it replaces, the shard rule and the metadata; for a call, whether
// it works when the safe sends it; and for both, the gas that carrying it out
// will be given. Everything here is a read. Nothing signs.

import { Address } from '@multiversx/sdk-core';
import { AccountFacts, readAccountFacts } from './accountFacts';
import {
  bytesOf,
  DELEGATION_MANAGER_SC,
  describeMetadata,
  ESDT_SYSTEM_SC,
  metadataChanges,
  metadataOf,
  readTokenOperation,
  toBigInt,
  tokenInCall,
  visible
} from './describe';
import {
  GasError,
  measureCall,
  MeasuredHow,
  performPlan,
  PerformPlan
} from './gas';
import {
  isSystemContract,
  normalizeCodeHash,
  PROTOCOL_BUILTINS,
  shardOf
} from './legacyCalls';
import { api, cached, chainId, networkProvider } from './network';
import { readVestingCall } from './vesting';
import { inspectVesting, VestingDetails } from './vestingCard';

export type Tone = 'ok' | 'warn' | 'bad';

/** One line under an action: green for a check that passed, red for one that did not. */
export interface Check {
  tone: Tone;
  text: string;
  /** Red but allowed: said loudly, and not a reason to refuse the proposal. */
  advisory?: boolean;
  /** Worked out from the other pending actions, and worked out again as more are read. */
  aboutSeats?: boolean;
}

// Moved to accountFacts.ts, still exported from here for what imports it here.
export type { AccountFacts };
export { readAccountFacts };

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
   * Null when the source holds no code, and when its code was not seen: the
   * read failed, the API stated a hash without returning the code, or what it
   * returned is not wasm (sourceUnread). Only a hash of the code itself is shown
   * or compared.
   */
  sourceHash: string | null;
  targetHash: string | null;
  sourceUnread?: boolean;
  targetUnread?: boolean;
  /** The source's code was read and has no upgrade function: the upgrade cannot succeed. */
  noUpgradeFunction?: boolean;
  sourceShard: number;
  safeShard: number;
}

export interface Inspection {
  checks: Check[];
  upgrade?: UpgradeFacts;
  perform: PerformPlan;
  /** The checks could not be run: the card says so and holds Sign. */
  failed?: boolean;
  /** For a vesting action: every vesting it creates, or the key it cancels with. */
  vesting?: VestingDetails;
}

/** What a card gets when its checks could not be run: never an empty list. */
export const uncheckedAction = (): Inspection => ({
  checks: [
    {
      tone: 'bad',
      text: 'The checks of this action could not be run, so it cannot be signed or carried out until they have been.'
    }
  ],
  perform: { simulate: true },
  failed: true
});

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

  // Each on its own: one that fails does not blank the other, and a read that
  // failed leaves the code as unseen as one the API did not return, so it holds
  // the signature the same way (redteam RED-04, 1 Nov 2026).
  const [sourceRead, targetRead] = await Promise.allSettled([
    readAccountFacts(source),
    readAccountFacts(target)
  ]);
  const sourceFacts =
    sourceRead.status === 'fulfilled' ? sourceRead.value : null;
  const targetFacts =
    targetRead.status === 'fulfilled' ? targetRead.value : null;
  if (!sourceFacts || !targetFacts) {
    checks.push({
      tone: 'bad',
      text:
        !sourceFacts && !targetFacts
          ? 'The source and the contract could not be read just now, so their code is not shown. Refresh before signing.'
          : !sourceFacts
            ? 'The source could not be read just now, so its code is not shown. Refresh before signing.'
            : 'The contract to upgrade could not be read just now, so the code it runs today is not shown. Refresh before signing.'
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

  // The code was returned and hashed, but its exports cannot be told: unread.
  const sourceMalformed = Boolean(
    sourceFacts?.codeHash &&
    !sourceFacts.codeUnread &&
    sourceFacts.exportsUpgrade === null
  );
  if (sourceMalformed) {
    checks.push({
      tone: 'bad',
      text: "The source's code could not be read as a contract's code: it is not well-formed wasm, or the API returned it cut off. Refresh and try again before signing."
    });
  }
  if (sourceFacts?.exportsUpgrade === false) {
    checks.push({
      tone: 'bad',
      text: "The source's code has no upgrade function. The network runs the new code's upgrade function and fails without one, so carrying this out would fail after the signatures and use the action up. Do not sign it; propose it again with a source that has one."
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
    sourceFacts.exportsUpgrade === true &&
    sourceFacts.codeHash === targetFacts.codeHash
  ) {
    checks.push({
      tone: 'warn',
      text: "The source runs the same code as the contract today: the upgrade changes no code, it only runs that code's upgrade function."
    });
  }

  return {
    checks,
    upgrade: {
      target,
      source,
      sourceHash:
        sourceFacts?.codeUnread || sourceMalformed
          ? null
          : (sourceFacts?.codeHash ?? null),
      targetHash: targetFacts?.codeUnread
        ? null
        : (targetFacts?.codeHash ?? null),
      sourceUnread: !sourceFacts || sourceFacts.codeUnread || sourceMalformed,
      targetUnread: !targetFacts || targetFacts.codeUnread,
      noUpgradeFunction: sourceFacts?.exportsUpgrade === false,
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
    return await cached(`trial:${safe}:${to}:${egld}:${data}`, async () => {
      const trial = await measureCall(networkProvider, {
        chainId,
        safe,
        to,
        egld,
        data
      });
      // No answer is not an answer to keep: it held the default on the card
      // for two minutes after the API was back (audit TXB-01, 1 Nov 2026).
      if (trial.how === 'offline') throw new GasError('no answer', false);
      return trial;
    });
  } catch (error) {
    if (error instanceof GasError && error.refused)
      return { need: null, how: 'refused', error };
    return { need: null, how: 'offline' };
  }
};

/**
 * The network answered with no real figure. For a contract in another shard
 * that is what it always does; for one in the safe's own shard, or the safe
 * itself, "it runs in another shard" would be false (redteam RED-02, 1 Nov
 * 2026). A system contract lives in the metachain, whatever its address looks
 * like to shardOf.
 */
const unmeasuredText = (where?: { to: string; safe: string }) => {
  if (where && where.to === where.safe) {
    return 'Tried as the safe would send it, on the safe itself, the network gave no real figure, only its maximum. That says nothing about whether it works. The gas below is a default.';
  }
  if (
    where &&
    !isSystemContract(where.to) &&
    shardOf(where.to) === shardOf(where.safe)
  ) {
    return "The network gave no real figure for it, only its maximum, though the contract is in the safe's own shard. That says nothing about whether it works. The gas below is a default.";
  }
  return 'The network could not try it in advance: it runs in another shard. The gas below is a default.';
};

/** What a trial means for a signer, in one line. */
export const trialCheck = (
  trial: Trial,
  where?: { to: string; safe: string }
): Check => {
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
        text: unmeasuredText(where)
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
 * Any call on the safe itself is red: the caller is the safe, which owns itself
 * and may hold a seat on its own board, so the call acts with the board's
 * authority, and mvxsafe never proposes one. Only the token moves a safe uses
 * every day stay out of it, with the real recipient in their sentence, and the
 * built-ins that are red already (audits RED-02 and RED-06, 1 Nov 2026).
 */
export const selfCallChecks = (name: string, egld: bigint): Check[] => {
  if (TOKEN_MOVES_ON_ITSELF.has(name)) return [];
  if (name === 'dnsRegister') {
    return [
      {
        tone: 'bad',
        text: `${egld > 0n ? 'dnsRegister forwards the EGLD it is given to its first argument, and here the safe pays it: this is a payment out of the safe, whatever else it looks like' : "dnsRegister calls its first argument in the safe's name. This one carries no EGLD"}. mvxsafe never proposes it. Check it with every board member before signing.`
      }
    ];
  }
  if (
    PROTOCOL_BUILTINS.has(name) &&
    name !== 'ESDTTransfer' &&
    name !== 'ClaimDeveloperRewards'
  )
    return [];
  return [
    {
      tone: 'bad',
      text: `${name ? `A call on the safe itself: the safe calls its own ${visible(name)}, with its own authority${egld > 0n ? ', paying with its own EGLD' : ''}` : `A call on the safe itself that names no function${egld > 0n ? ', sending the safe its own EGLD' : ''}`}. mvxsafe never proposes it. Check it with every board member before signing.`
    }
  ];
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
  const called = new TextDecoder().decode(endpoint);
  checks.push(...builtInChecks(called, to, safe));
  checks.push(...nestedBuiltInChecks(called, args));
  if (to === safe) checks.push(...selfCallChecks(called, egld));

  // A vesting: createBatch or create paid by the safe, or a cancel key sent
  // back with cancel() (brief of 6 Nov 2026). Its own checks, and its own gas,
  // since the network cannot try it as a safe in another shard.
  const vestingCall = to
    ? readVestingCall({ to, egld, endpoint: called, args, safe })
    : null;
  const vesting = vestingCall ? await inspectVesting(vestingCall, safe) : null;
  const pinnedVesting = Boolean(vesting?.details);

  let callNeed: bigint | null = null;
  if (to && hasFunction) {
    const trial = await trialAsSafe(safe, to, egld, callData(endpoint, args));
    if (pinnedVesting && trial.how === 'unmeasured') {
      checks.push({
        tone: 'ok',
        text: `The network cannot try it as the safe from another shard. Carrying it out is given what devnet measured for vestings of these sizes, ${(Number(vesting!.need) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M, plus a fifth.`
      });
    } else {
      checks.push(trialCheck(trial, { to, safe }));
    }
    callNeed = trial.need;
  }
  if (vesting) {
    checks.push(...vesting.checks);
    // Never less than devnet measured: a trial from the safe's shard can see
    // only the part that runs there.
    if (vesting.need > (callNeed ?? 0n)) callNeed = vesting.need;
  }

  if (to && isSystemContract(to)) {
    checks.push(...(await tokenOperationChecks(to, called, args, safe)));
  }

  // Who owns a contract it calls, which is what makes an owner's endpoint work.
  if (
    to &&
    !pinnedVesting &&
    Address.newFromBech32(to).isSmartContract() &&
    to !== safe &&
    !isSystemContract(to)
  ) {
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

  // Measured on the ESDT system contract (TXB-01). The network charges the
  // delegation manager the same 50M to create a contract, and 500M to convert a
  // validator. A delegation contract is charged 1M. So only the first two are told
  // this need, and the rest are not stopped from going lower (review of PR #20).
  const systemCall =
    to === ESDT_SYSTEM_SC ||
    (to === DELEGATION_MANAGER_SC && called === 'createNewDelegationContract');
  const perform = performPlan({ name, callNeed, hasFunction, systemCall });
  if (systemCall && !perform.simulate && !perform.known) {
    const contract =
      to === ESDT_SYSTEM_SC
        ? 'the ESDT system contract'
        : 'the delegation manager';
    checks.push({
      tone: 'warn',
      text: `A call to ${contract} needs about ${(Number(perform.need) / 1e6).toLocaleString('en-US')}M gas where it runs, so carrying this out is given that contract's default, ${perform.gasLimit.toLocaleString('en-US')}. With much less it runs out and the action is used up.`
    });
  }
  return vesting?.details
    ? { checks, perform, vesting: vesting.details }
    : { checks, perform };
};

/**
 * On a token's system contract, what counts is who owns the TOKEN. The contract
 * itself reports as its own owner, so asking who owns it told a signer that a
 * call that works would be refused (audit SGN-02, 1 Nov 2026).
 */
const tokenOwnerCheck = async (token: string, safe: string): Promise<Check> => {
  let owner = '';
  try {
    owner = (await api<{ owner?: string }>(`/tokens/${token}`))?.owner ?? '';
  } catch {
    // Not a fungible token, or no answer: an NFT, SFT or MetaESDT is a collection.
  }
  if (!owner) {
    try {
      owner =
        (await api<{ owner?: string }>(`/collections/${token}`))?.owner ?? '';
    } catch {
      // Said below.
    }
  }
  if (!owner) {
    return {
      tone: 'warn',
      text: `Whether the safe owns ${token} could not be read just now. Only the owner of a token can do this. Refresh to read it again.`
    };
  }
  return owner === safe
    ? {
        tone: 'ok',
        text: `The safe owns ${token}, and only the owner of a token can do this.`
      }
    : {
        tone: 'warn',
        text: `The safe does not own ${token}; its owner is ${owner}. Only the owner of a token can do this.`
      };
};

/** What a call on the token system contract does, and who owns that token. */
export const tokenOperationChecks = async (
  to: string,
  name: string,
  args: Uint8Array[],
  safe: string
): Promise<Check[]> => {
  const token = tokenInCall(to, args);
  if (!token) return [];
  return [
    ...(readTokenOperation(to, name, args)?.notes ?? []),
    await tokenOwnerCheck(token, safe)
  ];
};

/** A seat for something that is not a person's wallet (redteam RED-06, 1 Nov 2026). */
const boardSeatChecks = (value: any, safe: string): Check[] => {
  const who = asAddress(value);
  if (who === safe) {
    return [
      {
        tone: 'bad',
        text: "This gives THIS SAFE a seat on its own board. From then on, a call on the safe itself can sign, carry out and propose in the board's name, and counts as one signature of the quorum. Do not sign it unless every board member has agreed."
      }
    ];
  }
  return who && Address.newFromBech32(who).isSmartContract()
    ? [
        {
          tone: 'warn',
          text: 'This gives a contract a seat on the board. It signs only through its own code, so whoever can change that code holds this seat.'
        }
      ]
    : [];
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
      case 'AddBoardMember':
        return {
          checks: boardSeatChecks(fields[0], safe),
          perform: performPlan({ name })
        };
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
    return uncheckedAction();
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
