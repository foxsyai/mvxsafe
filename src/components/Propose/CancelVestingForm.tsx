import { useCallback, useEffect, useState } from 'react';
import { Tip } from 'components/Info';
import { VestingDetails } from 'components/Pending/VestingDetails';
import { proposeCancelVesting } from 'multisig/actions';
import { formatUnits, readTokenMeta, visible } from 'multisig/describe';
import { forget } from 'multisig/network';
import { cancelProblem, VestingFacts } from 'multisig/vesting';
import {
  cancelOutcome,
  HeldCancelKeyList,
  pinnedMvxvest,
  readHeldCancelKeys,
  readVestingFacts
} from 'multisig/vestingReads';
import { explainWalletFailure } from 'multisig/walletFailure';
import { FormProps } from './CallForm';
import {
  CheckLine,
  hint,
  primaryButton,
  quietButton,
  StuckNote,
  useStuck
} from './shared';

// "Cancel a vesting": the safe sends one of the cancel keys it holds back to
// mvxvest with cancel(). What has vested stays the beneficiary's; what has not
// comes back to the safe. Each key is shown with the vesting it stops and what
// stopping it now would do.

export const CancelVestingForm = ({
  safe,
  signer,
  disabled = false,
  disabledReason,
  onBusyChange,
  onProposed
}: FormProps) => {
  const pin = pinnedMvxvest();
  const [keys, setKeys] = useState<HeldCancelKeyList | null>(null);
  const [decimals, setDecimals] = useState<Record<string, number | null>>({});
  const [facts, setFacts] = useState<VestingFacts | null>(null);
  const [readError, setReadError] = useState('');
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stuck = useStuck(busy);

  const read = useCallback(
    async (fresh = false) => {
      if (!pin) return;
      setReadError('');
      // "Read the keys again" means now, not the minute-old list in the cache.
      if (fresh) forget(safe);
      try {
        const [held, found] = await Promise.all([
          readHeldCancelKeys(pin, safe),
          readVestingFacts(pin, safe)
        ]);
        const tokens = [
          ...new Set(
            held.flatMap((key) => (key.vesting ? [key.vesting.token] : []))
          )
        ];
        const metas = await Promise.all(
          tokens.map((token) => readTokenMeta(token, false))
        );
        setDecimals(
          Object.fromEntries(
            tokens.map((token, at) => [token, metas[at].decimals])
          )
        );
        setKeys(held);
        setFacts(found);
      } catch {
        setReadError(
          "The safe's cancel keys could not be read just now. Try again in a moment."
        );
      }
    },
    [pin, safe]
  );

  useEffect(() => {
    read();
  }, [read]);

  if (!pin) return null;

  const key = keys?.find((candidate) => candidate.nonce === chosen) ?? null;
  const problem =
    key && facts
      ? cancelProblem({
          pin,
          facts,
          collection: pin.cancelKey,
          nonce: key.nonce
        }) ||
        (key.unread
          ? 'The vesting of this key could not be read just now. Read the keys again.'
          : !key.vesting
            ? 'mvxvest knows no vesting for this key.'
            : key.vesting.cancelledAt > 0
              ? 'This vesting was already cancelled.'
              : '')
      : '';
  const ready = Boolean(key && facts && !problem);

  const submit = async () => {
    // A second press while the first waits for the wallet proposes nothing.
    if (busy) return;
    setError('');
    if (!ready || disabled || !key || !facts) return;
    setBusy(true);
    onBusyChange?.(true);
    let sent = false;
    try {
      await proposeCancelVesting(signer, safe, {
        pin,
        facts,
        collection: pin.cancelKey,
        nonce: key.nonce
      });
      sent = true;
      setChosen(null);
    } catch (failure) {
      setError(explainWalletFailure(failure, 'The proposal'));
    }
    setBusy(false);
    onBusyChange?.(false);
    onProposed(sent);
  };

  const amount = (raw: bigint, token: string) => {
    const known = decimals[token];
    return known === null || known === undefined
      ? `${raw} base units of ${token}`
      : `${formatUnits(raw, known)} ${token}`;
  };

  return (
    <div className='mt-4'>
      {readError && <CheckLine check={{ tone: 'bad', text: readError }} />}
      {keys === null && !readError && (
        <p className={hint}>Reading the safe&apos;s cancel keys...</p>
      )}
      {keys && keys.length === 0 && (
        <p className={hint}>
          This safe holds no cancel key of mvxvest ({pin.cancelKey}). It gets
          one for each cancelable vesting it creates.
        </p>
      )}
      {keys && keys.length > 0 && (
        <ul className='mt-2 space-y-2'>
          {keys.map((held) => {
            const vesting = held.vesting;
            const over = !vesting || vesting.cancelledAt > 0;
            const outcome = vesting ? cancelOutcome(vesting) : null;
            return (
              <li key={held.identifier}>
                <label
                  className={`flex gap-2 rounded-lg border p-3 text-xs ${chosen === held.nonce ? 'border-[#FF6E0A]' : 'border-[#2A2A32]'} ${over ? 'opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type='radio'
                    name='cancel-key'
                    disabled={over}
                    checked={chosen === held.nonce}
                    onChange={() => setChosen(held.nonce)}
                  />
                  <span className='text-[#9AA0A6] [overflow-wrap:anywhere]'>
                    <span className='font-mono text-white'>
                      {held.identifier}
                    </span>
                    {vesting ? (
                      <>
                        {' '}
                        stops vesting #{vesting.id}
                        {vesting.label ? `, "${visible(vesting.label)}"` : ''},
                        to{' '}
                        <span className='font-mono text-white'>
                          {vesting.beneficiary}
                        </span>
                        : {amount(vesting.total, vesting.token)} in all.{' '}
                        {vesting.cancelledAt > 0
                          ? 'Already cancelled.'
                          : outcome &&
                            `Cancelled now, ${amount(outcome.toBeneficiary, vesting.token)} stays theirs to claim and ${amount(outcome.toSafe, vesting.token)} comes back to this safe.`}
                      </>
                    ) : held.unread ? (
                      ' its vesting could not be read just now. Read the keys again.'
                    ) : (
                      ' mvxvest knows no vesting for this key.'
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {keys?.more && (
        <p className={hint}>
          The list stops at the first 10,000 keys the network lists.
        </p>
      )}
      <button
        type='button'
        onClick={() => read(true)}
        className={`${quietButton} mt-3`}
      >
        Read the keys again
      </button>

      {key?.vesting && (
        <VestingDetails
          details={{
            kind: 'cancel',
            contract: pin.address,
            keys: [
              {
                identifier: key.identifier,
                vesting: key.vesting,
                decimals: decimals[key.vesting.token] ?? null
              }
            ]
          }}
        />
      )}
      {problem && <CheckLine check={{ tone: 'bad', text: problem }} />}
      {error && <p className='mt-3 text-xs text-[#F87171]'>{error}</p>}

      <div className='mt-4'>
        <Tip text='Puts the cancel in front of the board. Your wallet will ask you to sign this proposal, which costs a small network fee and moves nothing by itself.'>
          <button
            type='button'
            disabled={busy || disabled || !ready}
            onClick={submit}
            className={primaryButton}
          >
            {busy ? 'Waiting for your wallet...' : 'Propose'}
          </button>
        </Tip>
        {disabled && !busy && disabledReason && (
          <p className={hint}>{disabledReason}</p>
        )}
        {busy && stuck && (
          <StuckNote
            onStartOver={() => {
              setBusy(false);
              onBusyChange?.(false);
            }}
          />
        )}
      </div>
    </div>
  );
};
