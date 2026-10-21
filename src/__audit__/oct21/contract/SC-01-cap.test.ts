/**
 * @jest-environment node
 */
// SC-01, the app's own part (main session, 21 Oct 2026): mvxsafe must not build
// an action the contract cannot return. On devnet a single argument of about
// 9,000 bytes still read back and one of about 12,000 did not, so a proposal's
// arguments are capped below that.
import {
  buildProposeCall,
  buildProposeUpgrade,
  predictSafeAddress
} from 'multisig/legacyCalls';

const SAFE = 'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3'; // shard 1
const TARGET = 'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const SENDER = 'erd1v6zzkkmhhq9vrtyedy0xwmzdnme8tzj5pvcvlnrys87zmkunxezsvh4kq3';
const SOURCE = predictSafeAddress(SENDER, 7); // shard 1
const context = { chainId: '1', sender: SENDER, nonce: 1, safe: SAFE };
const hexOf = (bytes: number) => '0x' + 'ab'.repeat(bytes);

test('control: a call with a 1,000-byte argument is built', async () => {
  await expect(
    buildProposeCall(context, {
      to: TARGET,
      functionName: 'setKeyDisplay',
      args: [{ kind: 'hex', value: hexOf(1000) }]
    })
  ).resolves.toBeTruthy();
});

test('a call whose arguments the contract could not return is refused', async () => {
  await expect(
    buildProposeCall(context, {
      to: TARGET,
      functionName: 'setKeyDisplay',
      args: [{ kind: 'hex', value: hexOf(12000) }]
    })
  ).rejects.toThrow(/too large/i);
});

test('the cap counts all the arguments together', async () => {
  const args = Array.from({ length: 3 }, () => ({
    kind: 'hex' as const,
    value: hexOf(3000)
  }));
  await expect(
    buildProposeCall(context, {
      to: TARGET,
      functionName: 'setKeyDisplay',
      args
    })
  ).rejects.toThrow(/too large/i);
});

test('an upgrade with oversized arguments is refused too', async () => {
  await expect(
    buildProposeUpgrade(context, {
      target: TARGET,
      source: SOURCE,
      metadata: '0500',
      args: [{ kind: 'hex', value: hexOf(12000) }]
    })
  ).rejects.toThrow(/too large/i);
});
