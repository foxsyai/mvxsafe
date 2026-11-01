// The functions a contract's code exports, read from its wasm's export section.
// Since protocol 1.6 the network runs the NEW code's `upgrade` function when a
// contract is upgraded, and fails the upgrade when there is none, after every
// signature (audit FND-04, 1 Nov 2026). The code comes from the API, so every
// length in it is checked against what is really there.

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const EXPORT_SECTION = 7;
const FUNCTION_EXPORT = 0;

/** The names of the exported functions, or null when this is not well-formed wasm. */
export const wasmFunctionExports = (code: Uint8Array): string[] | null => {
  if (HEADER.some((byte, index) => code[index] !== byte)) return null;
  let at = HEADER.length;

  // An unsigned LEB128 of at most 32 bits, or null when it does not fit in the code.
  const number = (): number | null => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (at >= code.length) return null;
      const byte = code[at++];
      value += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) return value <= 0xffffffff ? value : null;
    }
    return null;
  };

  const names: string[] = [];
  let seen = false;
  while (at < code.length) {
    const id = code[at++];
    const size = number();
    if (size === null || size > code.length - at) return null;
    const end = at + size;
    if (id === EXPORT_SECTION) {
      if (seen) return null;
      seen = true;
      const count = number();
      if (count === null || count > end - at) return null;
      for (let index = 0; index < count; index++) {
        const length = number();
        if (length === null || length > end - at) return null;
        const name = code.subarray(at, at + length);
        at += length;
        if (at >= end) return null;
        const kind = code[at++];
        if (number() === null || at > end) return null;
        if (kind === FUNCTION_EXPORT) {
          names.push(new TextDecoder().decode(name));
        }
      }
      if (at !== end) return null;
    }
    at = end;
  }
  return names;
};
