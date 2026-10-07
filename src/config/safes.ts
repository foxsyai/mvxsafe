// The shape of a safe in the visitor's list. Which safes those are is the
// visitor's own business: the list starts empty for everyone and lives in their
// browser (see multisig/savedSafes.ts).
//
// IMPORTANT: the multisig build this interface speaks to has NO groups and NO
// batches (getNumGroups does not exist on chain), so the UI must never offer
// signBatch, performBatch, discardBatch or proposeBatch.

export interface KnownSafe {
  name: string;
  address: string;
}
