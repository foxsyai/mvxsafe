/**
 * @jest-environment node
 */
// Open point 5 of the audit of 21 Oct 2026, traced by the main session: every
// load of the live site logged an uncaught (in promise) undefined. The site's
// CSP lets no WebAssembly compile (script-src 'self', no 'wasm-unsafe-eval'),
// so blake2b-wasm, which sdk-core's transaction hashing loads through blake2b,
// fails to start, and its ready() rejects a promise that blake2b never
// handles. Hashing then falls back to blake2b's JavaScript, so nothing breaks,
// but the page reports an error at every load.
//
// Correct behaviour: with WebAssembly refused, loading sdk-core leaves no
// unhandled rejection, and a transaction's hash is what it is with WebAssembly.

const TRANSACTION = {
  nonce: 7,
  value: '0',
  receiver: 'erd1qqqqqqqqqqqqqpgqlwavx7tm30262mt7jhwu8qmwaj0z2yzpxezshvnjyy',
  sender: 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3',
  gasPrice: 1000000000,
  gasLimit: 5000000,
  data: Buffer.from('sign@04').toString('base64'),
  chainID: 'D',
  version: 2
};

/** Loads sdk-core afresh and hashes the transaction, as the page does. */
const hashWithFreshSdk = (): string => {
  let hash = '';
  jest.isolateModules(() => {
    const {
      Transaction,
      TransactionComputer
    } = require('@multiversx/sdk-core');
    hash = new TransactionComputer().computeTransactionHash(
      Transaction.newFromPlainObject(TRANSACTION)
    );
  });
  return hash;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

// The hash blake2b's WebAssembly gives this transaction, computed with the real
// blake2b-wasm in plain node (outside jest, which maps it to the stand-in).
const REFERENCE =
  '8f8855f15a3d7dc230106c447113530c2c85472941d5d98bffb2ab1871498d2e';

test('control: with WebAssembly allowed, sdk-core gives the reference hash', async () => {
  expect(hashWithFreshSdk()).toBe(REFERENCE);
  await settle();
});

test('with WebAssembly refused, as the CSP does, nothing is left unhandled and the hash is the same', async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', record);
  const allowed = globalThis.WebAssembly;
  const refuse = () => {
    throw new Error(
      "Refused to compile WebAssembly: 'wasm-unsafe-eval' is not allowed"
    );
  };
  (globalThis as any).WebAssembly = {
    ...allowed,
    Module: refuse,
    Instance: refuse,
    compile: async () => refuse(),
    instantiate: async () => refuse()
  };
  try {
    const hash = hashWithFreshSdk();
    await settle();
    expect(unhandled).toEqual([]);
    expect(hash).toBe(REFERENCE);
  } finally {
    (globalThis as any).WebAssembly = allowed;
    process.off('unhandledRejection', record);
  }
});
