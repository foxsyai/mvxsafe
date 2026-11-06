import { useEffect, useState } from 'react';
import { Info } from 'components/Info';
import { formatUnits, readTokenMeta, visible } from 'multisig/describe';
import {
  HeldCancelKeyList,
  pinnedMvxvest,
  readHeldCancelKeys
} from 'multisig/vestingReads';

// In the safe's holdings: the mvxvest cancel keys it holds, each with the
// vesting it can stop, so the board sees what it controls (brief of 6 Nov
// 2026). Read only when the safe holds any NFT at all.

export const HeldCancelKeys = ({
  safe,
  nftCount
}: {
  safe: string;
  nftCount: number;
}) => {
  const pin = pinnedMvxvest();
  const [keys, setKeys] = useState<HeldCancelKeyList | null>(null);
  const [decimals, setDecimals] = useState<Record<string, number | null>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!pin || nftCount === 0) return;
    let alive = true;
    readHeldCancelKeys(pin, safe)
      .then(async (held) => {
        const tokens = [
          ...new Set(
            held.flatMap((key) => (key.vesting ? [key.vesting.token] : []))
          )
        ];
        const metas = await Promise.all(
          tokens.map((token) => readTokenMeta(token, false))
        );
        if (!alive) return;
        setDecimals(
          Object.fromEntries(
            tokens.map((token, at) => [token, metas[at].decimals])
          )
        );
        setKeys(held);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [pin, safe, nftCount]);

  if (!pin || nftCount === 0) return null;
  if (failed)
    return (
      <li className='text-xs text-[#FBBF24]'>
        Its mvxvest cancel keys could not be read just now.
      </li>
    );
  if (!keys || keys.length === 0) return null;

  const amount = (raw: bigint, token: string) => {
    const known = decimals[token];
    return known === null || known === undefined
      ? `${raw} base units`
      : formatUnits(raw, known);
  };

  return (
    <li className='border-t border-[#2A2A32] pt-2'>
      <p className='flex items-center text-[#9AA0A6]'>
        mvxvest cancel keys: {keys.length}
        {keys.more ? ' or more' : ''}
        <Info text="One for each cancelable vesting this safe created. With a key the board can stop that vesting: what has vested stays the beneficiary's, the rest comes back to the safe. Propose it under Cancel a vesting." />
      </p>
      <ul className='mt-1 space-y-1 text-xs text-[#6B7280]'>
        {keys.map((key) => (
          <li key={key.identifier} className='[overflow-wrap:anywhere]'>
            <span className='font-mono text-[#9AA0A6]'>{key.identifier}</span>{' '}
            {key.vesting ? (
              <>
                vesting #{key.vesting.id}
                {key.vesting.label ? `, "${visible(key.vesting.label)}"` : ''},
                to <span className='font-mono'>{key.vesting.beneficiary}</span>:{' '}
                <span className='text-white'>
                  {amount(key.vesting.total, key.vesting.token)}{' '}
                  {key.vesting.token}
                </span>
                , {amount(key.vesting.vested, key.vesting.token)} vested
                {key.vesting.cancelledAt > 0 ? ', cancelled' : ''}
              </>
            ) : key.unread ? (
              'its vesting could not be read just now'
            ) : (
              'mvxvest knows no vesting for it'
            )}
          </li>
        ))}
      </ul>
    </li>
  );
};
