import { formatUnits } from 'multisig/describe';
import type { Schedule } from 'multisig/vesting';
import type { VestingDetails as Details } from 'multisig/vestingCard';

// Under the sentence of a vesting action: every vesting it creates, with each
// date and amount, or the vesting a cancel key stops and what that does now.
// What a signer checks against what the board agreed, line by line.

const when = (seconds: number) =>
  `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const amount = (raw: bigint, decimals: number | null) =>
  decimals === null
    ? `${raw.toString()} base units`
    : formatUnits(raw, decimals);

const box =
  'mt-3 rounded-lg border border-[#2A2A32] bg-[#0E0E12] p-3 text-xs text-[#9AA0A6]';
const mono = 'font-mono text-white [overflow-wrap:anywhere]';

const ScheduleLines = ({
  schedule,
  decimals
}: {
  schedule: Schedule;
  decimals: number | null;
}) => {
  const { curve } = schedule;
  if (curve.kind === 'tranches') {
    return (
      <ul className='mt-1 space-y-0.5'>
        {curve.tranches.map((tranche) => (
          <li key={tranche.time}>
            <span className='text-[#6B7280]'>{when(tranche.time)}:</span>{' '}
            <span className='text-white'>
              {amount(tranche.amount, decimals)}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className='mt-1'>
      {curve.kind === 'linear' ? 'Linear' : `Stepped every ${curve.interval} s`}{' '}
      from {when(schedule.start)}, cliff {when(schedule.cliff)} with{' '}
      {amount(schedule.cliffAmount, decimals)}, ending {when(schedule.end)}
    </p>
  );
};

export const VestingDetails = ({ details }: { details: Details }) => {
  if (details.kind === 'cancel') {
    return (
      <div className={box}>
        {details.keys.map((key) => {
          const vesting = key.vesting;
          return (
            <div key={key.identifier} className='mt-2 first:mt-0'>
              <p>
                Cancel key <span className={mono}>{key.identifier}</span>
              </p>
              {vesting ? (
                <>
                  <p className='mt-1'>
                    Vesting #{vesting.id}
                    {vesting.label ? `, "${vesting.label}"` : ''}, to{' '}
                    <span className={mono}>{vesting.beneficiary}</span>
                  </p>
                  <p className='mt-1'>
                    {amount(vesting.total, key.decimals)} {vesting.token} in
                    all; vested now {amount(vesting.vested, key.decimals)},
                    claimed {amount(vesting.claimed, key.decimals)}
                    {vesting.cancelledAt > 0
                      ? `; already cancelled ${when(vesting.cancelledAt)}`
                      : ''}
                  </p>
                  <ScheduleLines
                    schedule={vesting.schedule}
                    decimals={key.decimals}
                  />
                </>
              ) : (
                <p className='mt-1 text-[#F87171]'>
                  mvxvest knows no vesting for this key.
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={box}>
      <p>
        {details.entries.length} vesting
        {details.entries.length === 1 ? '' : 's'} of{' '}
        <span className={mono}>{details.token}</span>
        {details.label ? `, labelled "${details.label}"` : ''},{' '}
        {details.cancelable ? 'cancelable' : 'not cancelable'}. Paid:{' '}
        <span className='text-white'>
          {amount(details.paidToken, details.decimals)} {details.token}
        </span>
        {details.paidEgld > 0n && (
          <span className='text-white'>
            {' '}
            and {formatUnits(details.paidEgld, 18)} EGLD
          </span>
        )}
        .
      </p>
      <ol className='mt-2 space-y-2'>
        {details.entries.map((entry, at) => (
          <li key={`${entry.beneficiary}-${at}`}>
            <p>
              {at + 1}. <span className={mono}>{entry.beneficiary}</span>:{' '}
              <span className='text-white'>
                {amount(entry.total, details.decimals)} {details.token}
              </span>
            </p>
            <ScheduleLines
              schedule={entry.schedule}
              decimals={details.decimals}
            />
          </li>
        ))}
      </ol>
    </div>
  );
};
