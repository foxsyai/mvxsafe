import { useCallback, useEffect, useState } from 'react';
import { Info, Tip } from 'components/Info';
import { VestingDetails } from 'components/Pending/VestingDetails';
import { proposeVestings } from 'multisig/actions';
import { formatUnits } from 'multisig/describe';
import { feeOf, performBudget } from 'multisig/gas';
import { forget } from 'multisig/network';
import { TokenBalance } from 'multisig/reads';
import {
  entryTotal,
  VESTING_LIMITS,
  VestingFacts,
  vestingGasNeed,
  vestingPayment,
  vestingProblem
} from 'multisig/vesting';
import { pinnedMvxvest, readVestingFacts } from 'multisig/vestingReads';
import { parseVestingRows, scheduleLines } from 'multisig/vestingRows';
import { explainWalletFailure } from 'multisig/walletFailure';
import { FormProps } from './CallForm';
import {
  CheckLine,
  field,
  hint,
  input,
  labelRow,
  primaryButton,
  quietButton,
  StuckNote,
  useStuck
} from './shared';

// "Create vestings": the safe pays mvxvest and calls createBatch itself, so it
// is the creator: the cancel keys and every refund a cancel pays stay in the
// safe, and no token passes through a signer's own wallet. One row per tranche;
// what the signers will read is shown before anything is proposed, and every
// check the card makes is made here first.

const PLACEHOLDER = [
  'erd1..., 2027-05-01, 250000',
  'erd1..., 2027-11-01, 250000'
].join('\n');

export const VestingForm = ({
  safe,
  signer,
  tokens,
  disabled = false,
  disabledReason,
  onBusyChange,
  onProposed
}: FormProps & { tokens: TokenBalance[] }) => {
  const pin = pinnedMvxvest();
  const fungible = tokens.filter((token) =>
    /^[A-Z0-9]{3,10}-[0-9a-f]{6}$/.test(token.identifier)
  );
  const [tokenId, setTokenId] = useState(fungible[0]?.identifier ?? '');
  const [cancelable, setCancelable] = useState(true);
  const [label, setLabel] = useState('');
  const [rows, setRows] = useState('');
  const [facts, setFacts] = useState<VestingFacts | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stuck = useStuck(busy);
  // One person's schedule, written into the rows.
  const [who, setWho] = useState('');
  const [total, setTotal] = useState('');
  const [first, setFirst] = useState('');
  const [count, setCount] = useState('8');
  const [every, setEvery] = useState('6');
  const [scheduleError, setScheduleError] = useState('');

  const token = fungible.find((candidate) => candidate.identifier === tokenId);
  const decimals = token?.decimals ?? 18;

  const read = useCallback(async () => {
    if (!pin || !tokenId) return null;
    setReading(true);
    setReadError('');
    try {
      const found = await readVestingFacts(pin, safe, tokenId);
      setFacts(found);
      return found;
    } catch {
      setReadError(
        'mvxvest could not be read just now, so nothing can be proposed. Try again in a moment.'
      );
      return null;
    } finally {
      setReading(false);
    }
  }, [pin, safe, tokenId]);

  useEffect(() => {
    setFacts(null);
    read();
  }, [read]);

  if (!pin) return null;

  const parsed = parseVestingRows(rows, decimals);
  const entries = parsed.entries;
  const problem =
    parsed.problem ||
    (facts && entries.length > 0
      ? vestingProblem({
          pin,
          facts,
          safe,
          token: tokenId,
          cancelable,
          label,
          entries,
          decimals
        })
      : '');
  const payment = facts ? vestingPayment(entries, facts) : null;
  const feesOn = Boolean(facts && (facts.fee > 0n || facts.tokenFeeBps > 0));
  const budget =
    entries.length > 0
      ? performBudget(vestingGasNeed({ entries, cancelable, feesPaid: feesOn }))
      : null;
  const ready = Boolean(
    facts && token && entries.length > 0 && !problem && !reading
  );

  const addSchedule = () => {
    const made = scheduleLines({
      beneficiary: who,
      total,
      decimals,
      first,
      count: Number(count),
      everyMonths: Number(every)
    });
    setScheduleError(made.problem);
    if (made.problem) return;
    setRows((current) =>
      current.trim() ? `${current.trimEnd()}\n${made.lines}` : made.lines
    );
    setWho('');
    setTotal('');
  };

  const submit = async () => {
    setError('');
    if (!ready || disabled || !facts) return;
    setBusy(true);
    onBusyChange?.(true);
    let reachedWallet = false;
    let sent = false;
    try {
      // Read again now: a fee changed since the form showed it makes the
      // vesting fail after its signatures (mvxvest wants the payment exactly).
      forget(safe);
      const now = await readVestingFacts(pin, safe, tokenId);
      const before = vestingPayment(entries, facts);
      const after = vestingPayment(entries, now);
      setFacts(now);
      if (
        before.tokenAmount !== after.tokenAmount ||
        before.egldFee !== after.egldFee
      ) {
        throw new Error(
          "mvxvest's fees changed just now. Check the new figures below, then propose again."
        );
      }
      reachedWallet = true;
      await proposeVestings(signer, safe, {
        pin,
        facts: now,
        token: tokenId,
        cancelable,
        label,
        entries,
        decimals
      });
      sent = true;
      // Proposed: the same batch is not one press away from a duplicate.
      setRows('');
      setLabel('');
    } catch (failure) {
      setError(
        reachedWallet
          ? explainWalletFailure(failure, 'The proposal')
          : String((failure as Error)?.message ?? failure)
      );
    }
    setBusy(false);
    onBusyChange?.(false);
    if (reachedWallet) onProposed(sent);
  };

  const labelBytes = new TextEncoder().encode(label).length;

  return (
    <div className='mt-4'>
      {fungible.length === 0 ? (
        <p className={hint}>This safe holds no token to vest.</p>
      ) : (
        <div className={field}>
          <label className={labelRow} htmlFor='vest-token'>
            Token
            <Info text='The token the vestings pay out. The safe pays mvxvest the whole batch at once. mvxvest holds it until each tranche vests.' />
          </label>
          <select
            id='vest-token'
            value={tokenId}
            onChange={(event) => setTokenId(event.target.value)}
            className={input}
          >
            {fungible.map((candidate) => (
              <option key={candidate.identifier} value={candidate.identifier}>
                {candidate.identifier}:{' '}
                {formatUnits(BigInt(candidate.balance), candidate.decimals)}{' '}
                held
              </option>
            ))}
          </select>
        </div>
      )}

      <label className='mt-3 flex items-center gap-2 text-xs text-[#9AA0A6]'>
        <input
          type='checkbox'
          checked={cancelable}
          onChange={(event) => setCancelable(event.target.checked)}
        />
        Cancelable: mvxvest gives this safe one cancel key per vesting
        <Info text="With a cancel key the board can stop that vesting later: what has vested stays the beneficiary's, the rest comes back to the safe. Without one, nobody can ever stop it. At most 32 cancelable vestings per proposal, 49 otherwise." />
      </label>

      <div className={field}>
        <label className={labelRow} htmlFor='vest-label'>
          Label
          <Info text='Shown with every vesting and on its keys, for example "Grants 2027". At most 64 bytes.' />
        </label>
        <input
          id='vest-label'
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className={input}
          placeholder='Grants 2027'
        />
        <p className={hint}>
          {labelBytes} of {VESTING_LIMITS.labelBytes} bytes
        </p>
      </div>

      <details className='mt-3 rounded-lg border border-[#2A2A32] p-3 text-xs text-[#9AA0A6]'>
        <summary className='cursor-pointer'>
          Add a schedule for one person
        </summary>
        <div className='mt-2 grid gap-2 sm:grid-cols-2'>
          <input
            aria-label='Beneficiary'
            value={who}
            onChange={(event) => setWho(event.target.value)}
            className={input}
            placeholder='erd1...'
          />
          <input
            aria-label='Total'
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            className={input}
            placeholder='Total, for example 1000000'
          />
          <input
            aria-label='First tranche'
            value={first}
            onChange={(event) => setFirst(event.target.value)}
            className={input}
            placeholder='First tranche, 2027-05-01 (UTC)'
          />
          <div className='flex gap-2'>
            <input
              aria-label='Tranches'
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className={input}
              placeholder='Tranches'
            />
            <input
              aria-label='Every how many months'
              value={every}
              onChange={(event) => setEvery(event.target.value)}
              className={input}
              placeholder='Every N months'
            />
          </div>
        </div>
        <p className={hint}>
          Equal tranches, the rounding remainder in the last one, on the same
          day of the month.
        </p>
        <button
          type='button'
          onClick={addSchedule}
          className={`${quietButton} mt-2`}
        >
          Add these tranches to the rows
        </button>
        {scheduleError && (
          <p className='mt-1 text-[#F87171]'>{scheduleError}</p>
        )}
      </details>

      <div className={field}>
        <label className={labelRow} htmlFor='vest-rows'>
          Tranches, one a line: beneficiary, date (UTC), amount
          <Info text='Paste straight from a spreadsheet: commas, semicolons or tabs. Each person gets one vesting with all their lines as its tranches. Amounts take a dot for decimals and no thousands separators.' />
        </label>
        <textarea
          id='vest-rows'
          value={rows}
          onChange={(event) => setRows(event.target.value)}
          rows={8}
          spellCheck={false}
          className={`${input} font-mono text-xs`}
          placeholder={PLACEHOLDER}
        />
        <p className={hint}>
          {entries.length} vesting{entries.length === 1 ? '' : 's'},{' '}
          {parsed.tranches} tranche
          {parsed.tranches === 1 ? '' : 's'}
        </p>
      </div>

      {reading && <p className={hint}>Reading mvxvest and the safe...</p>}
      {readError && <CheckLine check={{ tone: 'bad', text: readError }} />}

      {facts && (
        <CheckLine
          check={
            feesOn
              ? {
                  tone: 'warn',
                  text: `mvxvest charges ${formatUnits(facts.fee, 18)} EGLD a vesting and ${facts.tokenFeeBps / 100}% of each, paid by the safe to mvxvest's owner${payment && entries.length > 0 ? `: ${formatUnits(payment.tokenFee, decimals)} ${tokenId} and ${formatUnits(payment.egldFee, 18)} EGLD for this batch` : ''}. To create without fees, mvxvest's owner can set both to zero first (setFee 0 and setTokenFee 0), then propose this.`
                }
              : {
                  tone: 'ok',
                  text: "mvxvest's fees read zero now: the safe pays only the vestings."
                }
          }
        />
      )}

      {entries.length > 0 && facts && payment && (
        <>
          <p className='mt-4 text-xs text-[#6B7280]'>The signers will see:</p>
          <VestingDetails
            details={{
              kind: 'create',
              contract: pin.address,
              token: tokenId,
              decimals,
              cancelable,
              label,
              entries: entries.map((entry) => ({
                ...entry,
                total: entryTotal(entry)
              })),
              paidToken: payment.tokenAmount,
              paidEgld: payment.egldFee
            }}
          />
          {budget !== null && (
            <p className={hint}>
              Carrying it out is given{' '}
              {(Number(budget) / 1e6).toLocaleString('en-US', {
                maximumFractionDigits: 1
              })}
              M gas, what devnet measured for these sizes plus a fifth: about{' '}
              {(Number(feeOf(budget, 16)) / 1e18).toFixed(4)} EGLD for whoever
              carries it out.
            </p>
          )}
        </>
      )}

      {problem && <CheckLine check={{ tone: 'bad', text: problem }} />}
      {error && <p className='mt-3 text-xs text-[#F87171]'>{error}</p>}

      <div className='mt-4'>
        <Tip text='Puts the batch in front of the board. Your wallet will ask you to sign this proposal, which costs a small network fee and moves nothing by itself.'>
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
