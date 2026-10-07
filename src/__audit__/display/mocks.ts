// Replacements for the wallet hooks and the sending side, with no imports of the
// app, so a jest.mock factory can require this module safely. The test file installs:
//   jest.mock('multisig/network', () => require('./fixtures').networkMock);
//   jest.mock('lib', () => require('./mocks').libMock);
//   jest.mock('multisig/actions', () => require('./mocks').actionsMock);
export const connectAs = (address: string) => {
  (globalThis as any).__mvxsafeAccount = { address, nonce: 0 };
  (globalThis as any).__mvxsafeLoggedIn = Boolean(address);
};

export const libMock = {
  useGetAccount: () => (globalThis as any).__mvxsafeAccount ?? { address: '', nonce: 0 },
  useGetIsLoggedIn: () => Boolean((globalThis as any).__mvxsafeLoggedIn)
};

const never = () => Promise.resolve(undefined);
export const actionsMock = {
  signAction: never, unsignAction: never, performAction: never, discardAction: never,
  proposeSendEgld: never, proposeSendToken: never, proposeAddBoardMember: never,
  proposeAddProposer: never, proposeRemoveUser: never, proposeChangeQuorum: never
};
