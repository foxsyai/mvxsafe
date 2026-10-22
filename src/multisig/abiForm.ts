// A contract's ABI file, turned into the fields of the call form. Only what
// can be written as one argument per field is offered; anything else (a
// struct, a list, a nested option) is named and refused rather than guessed.
//
// The ABI is only a help for the PROPOSER. It is not stored on chain, so the
// signers read the call from its bytes (describe.ts) like any other.

import type { ArgumentKind } from './legacyCalls';

export interface Slot {
  /** The argument's name in the ABI. */
  name: string;
  /** Its type, as the ABI writes it. */
  type: string;
  /** How it is typed in, or null when this form cannot write it. */
  kind: ArgumentKind | null;
  /** For an enum: its variants, each with its discriminant. */
  choices?: { label: string; value: string }[];
  /** variadic<...>: as many as wanted, including none. */
  repeat: boolean;
  /** optional<...>: may be left out, but only at the end. */
  optional: boolean;
}

export interface AbiEndpoint {
  name: string;
  onlyOwner: boolean;
  /** True when the endpoint accepts EGLD with the call. */
  takesEgld: boolean;
  docs: string;
  slots: Slot[];
}

const NUMBERS = /^(BigUint|u8|u16|u32|u64|usize)$/;
const TEXTS =
  /^(bytes|ManagedBuffer|TokenIdentifier|TokenId|EgldOrEsdtTokenIdentifier|String|&str)$/;

const slotOf = (
  name: string,
  rawType: string,
  types: Record<string, any>,
  multi: boolean
): Slot => {
  let type = rawType.trim();
  let repeat = false;
  let optional = false;
  const variadic = /^variadic<(.+)>$/.exec(type);
  if (variadic && multi) {
    repeat = true;
    type = variadic[1];
  }
  const option = /^optional<(.+)>$/.exec(type);
  if (option && multi) {
    optional = true;
    type = option[1];
  }
  const slot: Slot = { name, type: rawType, kind: null, repeat, optional };
  if (NUMBERS.test(type)) slot.kind = 'number';
  else if (type === 'bool') slot.kind = 'bool';
  else if (type === 'Address') slot.kind = 'address';
  else if (TEXTS.test(type)) slot.kind = 'text';
  else {
    const custom = types[type];
    // Every variant a variant: a null showed the form's own TypeError, and one
    // without a discriminant was offered with the value "undefined" (the last
    // cosmetic point of the audit of 21 Oct 2026).
    if (
      custom?.type === 'enum' &&
      (!Array.isArray(custom.variants) ||
        !custom.variants.every(
          (variant: any) =>
            variant &&
            typeof variant === 'object' &&
            typeof variant.name === 'string' &&
            Number.isInteger(variant.discriminant) &&
            variant.discriminant >= 0
        ))
    ) {
      throw new Error(
        `The ABI's type ${type} lists its variants in a shape that is not an ABI's, so this file cannot be used.`
      );
    }
    const plainEnum =
      custom?.type === 'enum' &&
      custom.variants.every((variant: any) => !variant.fields?.length);
    if (plainEnum) {
      slot.kind = 'number';
      slot.choices = custom.variants.map((variant: any) => ({
        label: `${variant.name} (${variant.discriminant})`,
        value: String(variant.discriminant)
      }));
    }
  }
  return slot;
};

/**
 * The mutable endpoints of an ABI file, owner-only ones first. Throws with a
 * sentence when the text is not an ABI.
 */
export const readAbi = (
  text: string
): { name: string; endpoints: AbiEndpoint[] } => {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('That file is not JSON, so it is not an ABI.');
  }
  if (!Array.isArray(json?.endpoints))
    throw new Error('That file has no endpoints, so it is not an ABI.');
  const types = json.types ?? {};
  const endpoints: AbiEndpoint[] = json.endpoints
    .filter(
      (endpoint: any) =>
        endpoint?.mutability !== 'readonly' &&
        typeof endpoint?.name === 'string'
    )
    .map((endpoint: any) => {
      // An endpoint whose arguments cannot all be read is refused with a
      // sentence, never offered with some missing; a malformed file showed
      // the form's own TypeError (backlog of the 21 Oct audit).
      const inputs = endpoint.inputs ?? [];
      const tokens = endpoint.payableInTokens ?? [];
      if (
        !Array.isArray(inputs) ||
        inputs.some((input: any) => !input || typeof input !== 'object')
      ) {
        throw new Error(
          `The ABI's endpoint ${endpoint.name} lists its arguments in a shape that is not an ABI's, so this file cannot be used.`
        );
      }
      if (!Array.isArray(tokens)) {
        throw new Error(
          `The ABI's endpoint ${endpoint.name} lists the tokens it accepts in a shape that is not an ABI's, so this file cannot be used.`
        );
      }
      return {
        name: endpoint.name,
        onlyOwner: Boolean(endpoint.onlyOwner),
        takesEgld: tokens.some(
          (token: unknown) => token === 'EGLD' || token === '*'
        ),
        docs: Array.isArray(endpoint.docs)
          ? endpoint.docs
              .filter((line: unknown) => typeof line === 'string')
              .join(' ')
          : '',
        slots: inputs.map((input: any) =>
          slotOf(
            String(input.name ?? ''),
            String(input.type ?? ''),
            types,
            Boolean(input.multi_arg)
          )
        )
      };
    });
  endpoints.sort((a, b) => Number(b.onlyOwner) - Number(a.onlyOwner));
  return { name: String(json.name ?? 'contract'), endpoints };
};
