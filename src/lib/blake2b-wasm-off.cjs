// Stands in for blake2b-wasm (open point of the audit of 21 Oct 2026). The
// site's CSP lets no WebAssembly compile, so blake2b, which sdk-core hashes
// transactions with, already ran in plain JavaScript; but the WebAssembly half
// failed to start and rejected a promise nobody handled, at every page load.
// This reports it as unsupported and never ready, and rejects nothing, so
// blake2b uses its JavaScript everywhere: in the tests and in development as
// on the live site.
function unavailable() {
  throw new Error('blake2b-wasm is switched off');
}
unavailable.SUPPORTED = false;
unavailable.ready = function (callback) {
  if (callback) callback(new Error('blake2b-wasm is switched off'));
  return Promise.resolve();
};
module.exports = unavailable;
