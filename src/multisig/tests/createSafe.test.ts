import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildDeploySafe,
  buildHandOver,
  DEPLOY_GAS,
  MULTISIG_WASM_SHA256,
  predictSafeAddress
} from 'multisig/legacyCalls';

// The Foundation's Treasury was created on mainnet by these two transactions:
//   76b7ddb633e661c23e31d18e98688a8c736df066b7eb0612f7a9d18f91e4bd70  deploy, nonce 3
//   9876077e1102b028...                                                 ChangeOwnerAddress, nonce 4
// Rebuilding them byte for byte proves the builders against reality without
// sending anything.
const DEPLOYER = 'erd15gpvttvxudnatxampf280gltmpagglpraqt72dylhvxef4rmaggsmt3p3h';
const TREASURY = 'erd1qqqqqqqqqqqqqpgq04xhaq7ncqt53sj33mqxak9rmrxf8ku2aggslfe98p';
const REAL_DEPLOY_DATA_SHA256 = 'f0becc5dbce5d2ae9d3e8f382061edb7ba1a7b6eafe87288942c880a85df681e';
const REAL_HANDOVER_DATA =
  'ChangeOwnerAddress@000000000000000005007d4d7e83d3c01748c2518ec06ed8a3d8cc93db8aea11';

const bytecode = new Uint8Array(readFileSync(join(__dirname, '../../../public/contracts/multisig.wasm')));
const text = (data: Uint8Array) => Buffer.from(data).toString();

describe('creating a safe', () => {
  it('ships exactly the Foundation contract', () => {
    expect(createHash('sha256').update(bytecode).digest('hex')).toBe(MULTISIG_WASM_SHA256);
  });

  it('predicts the address the deploy will create', () => {
    expect(predictSafeAddress(DEPLOYER, 3)).toBe(TREASURY);
  });

  it('rebuilds the Treasury deploy byte for byte', async () => {
    const tx = await buildDeploySafe(
      { chainId: '1', sender: DEPLOYER, nonce: 3 },
      { bytecode, quorum: 1, board: [DEPLOYER] }
    );
    expect(createHash('sha256').update(text(tx.data)).digest('hex')).toBe(REAL_DEPLOY_DATA_SHA256);
    expect(tx.nonce).toBe(3n);
    expect(tx.gasLimit).toBe(DEPLOY_GAS);
    expect(tx.chainID).toBe('1');
    // A deploy goes to the system's deploy address, never to an account.
    expect(tx.receiver.toBech32()).toBe('erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu');
  });

  it('rebuilds the Treasury handover byte for byte', async () => {
    const tx = await buildHandOver({ chainId: '1', sender: DEPLOYER, nonce: 4, safe: TREASURY });
    expect(text(tx.data)).toBe(REAL_HANDOVER_DATA);
    expect(tx.receiver.toBech32()).toBe(TREASURY);
    expect(tx.nonce).toBe(4n);
  });

  it('writes the quorum and every board member, in order, after the settings', async () => {
    const board = [
      'erd1etc22n3wel7s452mkvfy2aw3zpef7lmdkkyv9xcryzssdcpahlnsvnzga0',
      'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
      'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx'
    ];
    const tx = await buildDeploySafe({ chainId: '1', sender: board[2], nonce: 87 }, { bytecode, quorum: 2, board });
    const parts = text(tx.data).split('@');
    expect(parts.slice(1, 4)).toEqual(['0500', '0506', '02']);
    expect(parts.slice(4)).toHaveLength(3);
    // Each member is its 32-byte public key, in the order given.
    expect(parts[4]).toHaveLength(64);
    expect(parts.slice(4)).toEqual(
      board.map((member) => Buffer.from(require('@multiversx/sdk-core').Address.newFromBech32(member).getPublicKey()).toString('hex'))
    );
  });
});
