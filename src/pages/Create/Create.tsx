import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ConnectButton } from 'components/ConnectButton';
import { Info, Tip } from 'components/Info';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { createSafe } from 'multisig/actions';
import { MULTISIG_CODE_HASH } from 'multisig/legacyCalls';
import { checkBoard, majority, MAX_BOARD } from 'multisig/newSafe';
import { addSafe } from 'multisig/savedSafes';
import { explainWalletFailure } from 'multisig/walletFailure';

// Creating a safe is two transactions signed together: the deploy, and the
// handover that makes the safe its own owner. The page says both out loud,
// because the second is what makes a multisig a multisig.

const card = 'rounded-xl border border-[#2A2A32] bg-[#121218] p-5';
const input =
  'w-full rounded-lg border border-[#2A2A32] bg-[#0E0E12] px-3 py-2 font-mono text-sm text-white placeholder-[#4B5563]';
const hint = 'mt-1 text-xs text-[#6B7280]';

export const Create = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const account = useGetAccount();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [rows, setRows] = useState<string[]>(['', '', '']);
  const [quorum, setQuorum] = useState(2);
  const [quorumTouched, setQuorumTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [problem, setProblem] = useState('');

  // The person creating it is usually on the board, so they start in the first
  // row. Only an empty row is filled, never one the visitor typed in.
  useEffect(() => {
    if (isLoggedIn && account.address) {
      setRows((current) =>
        current.includes(account.address) || current[0] ? current : [account.address, ...current.slice(1)]
      );
    }
  }, [isLoggedIn, account.address]);

  const check = checkBoard(rows, quorum, isLoggedIn ? account.address : '');
  const size = check.board.length;

  // Until the visitor picks a number, keep it at a majority of the board.
  useEffect(() => {
    if (!quorumTouched && size > 0) setQuorum(majority(size));
  }, [size, quorumTouched]);

  useEffect(() => {
    if (!busy) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), 25000);
    return () => clearTimeout(timer);
  }, [busy]);

  const setRow = (index: number, value: string) =>
    setRows((current) => current.map((row, at) => (at === index ? value : row)));

  const create = async () => {
    setProblem('');
    setBusy(true);
    try {
      const safe = await createSafe(
        { address: account.address, nonce: Number(account.nonce ?? 0) },
        { quorum, board: check.board }
      );
      addSafe({ name: name.trim() || 'New safe', address: safe });
      navigate(`/safe/${safe}`, { state: { creating: true } });
    } catch (failure: unknown) {
      setProblem(explainWalletFailure(failure, 'Creating the safe'));
      setBusy(false);
    }
  };

  return (
    <div className='mx-auto w-full max-w-3xl px-4 py-10'>
      <Link to='/' className='text-sm text-[#9AA0A6] hover:text-[#FF6E0A]'>
        &larr; All safes
      </Link>
      <p className='mt-6 text-xs font-semibold tracking-[0.25em] text-[#FF6E0A]'>NEW SAFE</p>
      <h1 className='mt-2 text-3xl font-semibold text-white'>Create a safe</h1>
      <p className='mt-2 text-sm text-[#9AA0A6]'>
        Choose who sits on the board and how many of them have to sign before anything moves.
        The safe belongs to nobody once it exists, not even to you: only the board, together.
      </p>

      <section className={`${card} mt-8`}>
        <label className='text-xs text-[#6B7280]'>Name, kept in this browser only</label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder='Treasury'
          className={input.replace('font-mono ', '')}
        />

        <h2 className='mt-6 flex items-center text-sm font-semibold text-white'>
          Board
          <Info text='The addresses that can sign. Each one is checked letter by letter: a wrong address would be a seat nobody can ever use.' />
        </h2>
        <div className='mt-3 space-y-2'>
          {rows.map((row, index) => (
            <div key={index}>
              <div className='flex items-center gap-2'>
                <input
                  value={row}
                  onChange={(event) => setRow(index, event.target.value)}
                  placeholder='erd1...'
                  spellCheck={false}
                  className={`${input} ${check.rowErrors[index] ? 'border-[#F87171]/60' : ''}`}
                />
                {rows.length > 1 && (
                  <Tip text='Takes this row off the board.'>
                    <button
                      type='button'
                      aria-label='Remove this member'
                      onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                      className='flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#FF6E0A]/10 hover:text-[#FF6E0A]'
                    >
                      &times;
                    </button>
                  </Tip>
                )}
              </div>
              {check.rowErrors[index] && (
                <p className='mt-1 text-xs text-[#F87171]'>{check.rowErrors[index]}</p>
              )}
              {row.trim() === account.address && isLoggedIn && (
                <p className={hint}>That is you.</p>
              )}
            </div>
          ))}
        </div>
        {rows.length < MAX_BOARD && (
          <button
            type='button'
            onClick={() => setRows((current) => [...current, ''])}
            className='mt-3 text-sm text-[#FF6E0A] hover:underline'
          >
            + Add a member
          </button>
        )}

        <h2 className='mt-6 flex items-center text-sm font-semibold text-white'>
          Signatures needed
          <Info text='The quorum. Every payment, every change to the board, everything the safe does needs this many board members to sign it first.' />
        </h2>
        <div className='mt-3 flex items-center gap-3'>
          <select
            value={quorum}
            disabled={size === 0}
            onChange={(event) => {
              setQuorumTouched(true);
              setQuorum(Number(event.target.value));
            }}
            className='rounded-lg border border-[#2A2A32] bg-[#0E0E12] px-3 py-2 text-sm text-white'
          >
            {Array.from({ length: Math.max(size, 1) }, (_, at) => at + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <span className='text-sm text-[#9AA0A6]'>
            {size > 0 ? `of ${size} board member${size === 1 ? '' : 's'}` : 'once the board has members'}
          </span>
        </div>

        {check.warnings.length > 0 && (
          <ul className='mt-5 space-y-2'>
            {check.warnings.map((warning) => (
              <li
                key={warning}
                className='rounded-lg border border-[#FBBF24]/30 bg-[#FBBF24]/5 px-3 py-2 text-xs text-[#FBBF24]'
              >
                {warning}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${card} mt-6`}>
        <h2 className='text-sm font-semibold text-white'>What happens when you press Create</h2>
        <ol className='mt-3 list-decimal space-y-2 pl-5 text-sm text-[#9AA0A6]'>
          <li>
            Your wallet asks you to sign <span className='text-white'>two transactions</span>: the
            first creates the safe, the second hands it to itself, so that nobody, you included,
            can ever change its code alone.
          </li>
          <li>
            The safe runs the same contract as the Foxsy AI Foundation's safes, checked byte for
            byte before anything is sent (code hash{' '}
            <span className='font-mono text-xs text-[#6B7280]'>{MULTISIG_CODE_HASH.slice(0, 12)}...</span>).
          </li>
          <li>
            The network fee is about <span className='text-white'>0.073 EGLD</span>, paid from your
            wallet. The safe starts empty; anyone can send it EGLD or tokens afterwards.
          </li>
        </ol>

        {problem && (
          <p className='mt-4 rounded-lg border border-[#F87171]/40 bg-[#F87171]/10 p-3 text-sm text-[#F87171]'>
            {problem}
          </p>
        )}

        <div className='mt-5'>
          {isLoggedIn ? (
            <>
              <button
                type='button'
                disabled={busy || Boolean(check.blocker)}
                onClick={create}
                className='rounded-lg bg-[#FF6E0A] px-5 py-2 text-sm font-semibold text-black hover:bg-[#ff8534] disabled:opacity-50'
              >
                {busy
                  ? 'Waiting for your wallet...'
                  : size > 0 && !check.blocker
                    ? `Create a ${quorum} of ${size} safe`
                    : 'Create the safe'}
              </button>
              {check.blocker && !busy && <p className={hint}>{check.blocker}</p>}
              {busy && stuck && (
                <p className={hint}>
                  Your wallet has not answered. If you dismissed the request,{' '}
                  <button
                    type='button'
                    onClick={() => setBusy(false)}
                    className='text-[#FF6E0A] hover:underline'
                  >
                    start over
                  </button>
                  . If you did sign, the safe is on its way.
                </p>
              )}
            </>
          ) : (
            <div className='flex flex-wrap items-center gap-3'>
              <ConnectButton />
              <span className='text-xs text-[#6B7280]'>
                Connect the wallet that will pay the fee and sign the two transactions.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
