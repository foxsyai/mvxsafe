import { useState } from 'react';
import { Info } from 'components/Info';
import { CheckLine, Hash } from 'components/Propose/shared';
import {
  CALLBACK_GAS,
  feeOf,
  MAX_GAS,
  performBudget,
  SAFE_OWN_GAS
} from 'multisig/gas';
import type { PerformPlan } from 'multisig/gas';
import { expectedHashCheck } from 'multisig/inspect';
import { PendingAction } from 'multisig/reads';

// Under the sentence of a pending action: what was checked on chain, and for an
// upgrade the two code hashes side by side with a field for the release's own,
// so a signer can verify everything without leaving the page. And when the
// action is ready, the gas carrying it out will be given, which the performer
// can see and change: where the network cannot simulate it, a figure that is
// too low uses the action up.

const millions = (gas: bigint) =>
  `${(Number(gas) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;

/**
 * "23,300,000" or "23300000" as gas, or why not. Never less than the safe's
 * own part and the callback's, which `floor` is.
 */
export const parseGas = (
  text: string,
  floor: bigint = SAFE_OWN_GAS + CALLBACK_GAS
): { gas: bigint } | { problem: string } => {
  const cleaned = text.replace(/[\s,_]/g, '');
  if (!/^\d+$/.test(cleaned))
    return { problem: 'Gas is a whole number, for example 23300000.' };
  const gas = BigInt(cleaned);
  if (gas < floor) {
    return {
      problem: `Less than ${floor.toLocaleString('en-US')} cannot cover what the safe itself needs.`
    };
  }
  if (gas > MAX_GAS)
    return { problem: 'More than one transaction may use (600,000,000).' };
  return { gas };
};

/** The gas a perform will be given: the plan's, or what the performer typed. */
export const performGas = (
  plan: PerformPlan | undefined,
  typed: string | undefined
) => {
  if (!plan || plan.simulate) return { budget: undefined, problem: '' };
  if (typed === undefined) return { budget: plan.gasLimit, problem: '' };
  const parsed = parseGas(typed, plan.parts.safe + plan.parts.callback);
  return 'gas' in parsed
    ? { budget: parsed.gas, problem: '' }
    : { budget: undefined, problem: parsed.problem };
};

interface ActionChecksProps {
  action: PendingAction;
  /** Show the gas field: the quorum is reached and this viewer may carry it out. */
  showGas: boolean;
  gasText: string | undefined;
  onGasText: (text: string) => void;
}

export const ActionChecks = ({
  action,
  showGas,
  gasText,
  onGasText
}: ActionChecksProps) => {
  const [expected, setExpected] = useState('');
  const checks = action.checks ?? [];
  const upgrade = action.upgrade;
  const plan = action.perform;
  const hashCheck = upgrade
    ? expectedHashCheck(
        expected,
        upgrade.sourceHash,
        'the source',
        upgrade.sourceUnread
      )
    : null;
  const typed = performGas(plan, gasText);

  if (checks.length === 0 && !upgrade && !(showGas && plan && !plan.simulate))
    return null;

  return (
    <div className='mt-3'>
      {upgrade && (
        <div className='rounded-lg border border-[#2A2A32] bg-[#0E0E12] p-3 text-xs text-[#6B7280]'>
          <p>
            Code of the source, which the contract will run:{' '}
            <Hash value={upgrade.sourceHash} unread={upgrade.sourceUnread} />
          </p>
          <p className='mt-1'>
            Code the contract runs today:{' '}
            <Hash value={upgrade.targetHash} unread={upgrade.targetUnread} />
          </p>
          <label className='mt-3 flex items-center text-xs text-[#6B7280]'>
            Check it against the release
            <Info text='Paste the code hash published with the release. It turns green when it is exactly the code this upgrade brings in.' />
          </label>
          <input
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            placeholder='Expected code hash, 64 hex characters'
            aria-label={`Expected code hash for action ${action.actionId}`}
            className='mt-1 w-full rounded-lg border border-[#2A2A32] bg-[#121218] px-3 py-1.5 font-mono text-xs text-white placeholder-[#4B5563]'
          />
          {hashCheck && <CheckLine check={hashCheck} />}
        </div>
      )}

      {checks.map((check) => (
        <CheckLine key={check.text} check={check} />
      ))}

      {showGas && plan && !plan.simulate && (
        <div className='mt-3 text-xs text-[#6B7280]'>
          <label className='flex items-center'>
            Gas for carrying it out
            <Info text="The network cannot try this one in advance: it sends something out of the safe's shard. So the gas is a budget: the safe's own part, what the call or transfer needs plus a fifth and, for a call, what the network holds back for the safe's callback. The whole figure is paid." />
          </label>
          <input
            value={gasText ?? plan.gasLimit.toString()}
            onChange={(event) => onGasText(event.target.value)}
            aria-label={`Gas for action ${action.actionId}`}
            className='mt-1 w-full rounded-lg border border-[#2A2A32] bg-[#121218] px-3 py-1.5 font-mono text-xs text-white sm:w-56'
          />
          <p className='mt-1'>
            {millions(plan.parts.safe)} for the safe,{' '}
            {millions(plan.parts.call)} for the{' '}
            {action.name === 'SCUpgradeFromSource'
              ? 'upgrade'
              : action.name === 'SendTransferExecute'
                ? 'transfer'
                : 'call'}
            {plan.parts.callback > 0n
              ? `, ${millions(plan.parts.callback)} for the callback`
              : ''}
            {/* The budget as sent, rounded up to 0.1M: adding the parts
                showed 19.1M under a field of 19,200,000 (14 Oct 2026). */}
            : {millions(performBudget(plan.need, plan.parts.callback))}
            {plan.known
              ? ''
              : ', from a default because the need could not be measured'}
            . About{' '}
            {(Number(feeOf(typed.budget ?? plan.gasLimit, 16)) / 1e18).toFixed(
              4
            )}{' '}
            EGLD.
          </p>
          {typed.problem && (
            <p className='mt-1 text-[#F87171]'>{typed.problem}</p>
          )}
          {typed.budget !== undefined && typed.budget < plan.gasLimit && (
            <p className='mt-1 text-[#FBBF24]'>
              Below the budget. If it runs out, the action is used up and has to
              be proposed and signed again.
            </p>
          )}
          {typed.budget !== undefined &&
            typed.budget * 2n > plan.gasLimit * 3n && (
              <p className='mt-1 text-[#FBBF24]'>
                More than one and a half times the budget. The whole limit is
                paid.
              </p>
            )}
        </div>
      )}
    </div>
  );
};
