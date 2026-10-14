import { useEffect, useState } from 'react';
import type { Slot } from 'multisig/abiForm';
import type { Check } from 'multisig/inspect';
import { ArgumentKind, encodeArgument } from 'multisig/legacyCalls';

// What the propose forms share: their look, the green, amber and red lines
// that say what was checked, the way out of a wallet that never answers, and
// the editor for a call's arguments.

export const input =
  'w-full rounded-lg border border-[#2A2A32] bg-[#0E0E12] px-3 py-2 text-sm text-white placeholder-[#4B5563]';
export const field = 'mt-3';
export const hint = 'mt-1 text-xs text-[#6B7280]';
export const labelRow = 'flex items-center text-xs text-[#6B7280]';
export const primaryButton =
  'rounded-lg bg-[#FF6E0A] px-5 py-2 text-sm font-semibold text-black hover:bg-[#ff8534] disabled:opacity-50';
export const quietButton =
  'rounded-lg border border-[#2A2A32] px-3 py-1.5 text-xs text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-white disabled:opacity-50';

const TONE: Record<Check['tone'], string> = {
  ok: 'border-[#4ADE80]/30 bg-[#4ADE80]/5 text-[#4ADE80]',
  warn: 'border-[#FBBF24]/30 bg-[#FBBF24]/5 text-[#FBBF24]',
  bad: 'border-[#F87171]/40 bg-[#F87171]/10 text-[#F87171]'
};

/** One check, coloured by what it found. The tone is in the data too, for tests. */
export const CheckLine = ({ check }: { check: Check }) => (
  <p
    data-tone={check.tone}
    className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed [overflow-wrap:anywhere] ${TONE[check.tone]}`}
  >
    {check.text}
  </p>
);

/**
 * True once the wallet has been waited for long enough that it may never
 * answer: an xPortal request dismissed on the phone never comes back as a
 * refusal (6 Oct 2026).
 */
export const useStuck = (busy: boolean) => {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!busy) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), 25000);
    return () => clearTimeout(timer);
  }, [busy]);
  return stuck;
};

export const StuckNote = ({
  onStartOver,
  where = 'above'
}: {
  onStartOver: () => void;
  where?: string;
}) => (
  <p className='mt-3 text-xs text-[#6B7280]'>
    Your wallet has not answered. If you dismissed the request,{' '}
    <button
      type='button'
      onClick={onStartOver}
      className='text-[#FF6E0A] hover:underline'
    >
      start over
    </button>
    . If you did sign it, it is on its way and will appear {where} by itself.
  </p>
);

/** A code hash, broken anywhere so it never pushes the page sideways. */
export const Hash = ({ value }: { value: string | null }) => (
  <span className='font-mono text-[11px] [overflow-wrap:anywhere] text-[#C9CDD2]'>
    {value ?? 'none'}
  </span>
);

// --- arguments -----------------------------------------------------------------

export const KIND_LABELS: Record<ArgumentKind, string> = {
  egld: 'EGLD amount',
  number: 'Whole number',
  address: 'Address',
  text: 'Text',
  hex: 'Hex bytes',
  bool: 'True or false'
};

const PLACEHOLDER: Record<ArgumentKind, string> = {
  egld: '0.01',
  number: '10',
  address: 'erd1...',
  text: 'FOXSY-5d5f3e',
  hex: '0x0102',
  bool: 'true'
};

export interface ArgRow {
  id: number;
  kind: ArgumentKind;
  value: string;
  /** From an ABI: the argument's name and type, which fix what it can be. */
  slot?: Slot;
}

let nextRowId = 1;
export const newRow = (kind: ArgumentKind = 'number', slot?: Slot): ArgRow => ({
  id: nextRowId++,
  kind,
  // A true-or-false row shows "false" from the start, so it holds it too
  // (audit UPG-05, 14 Oct 2026).
  value: slot?.choices?.[0]?.value ?? (kind === 'bool' ? 'false' : ''),
  slot
});

/** The kinds a row may switch between: any without an ABI, its own family with one. */
const kindsFor = (row: ArgRow): ArgumentKind[] => {
  if (!row.slot) return ['egld', 'number', 'address', 'text', 'hex', 'bool'];
  if (row.slot.choices) return ['number'];
  if (
    /^BigUint$/.test(row.slot.type.replace(/^(variadic|optional)<(.+)>$/, '$2'))
  )
    return ['egld', 'number'];
  if (row.slot.kind === 'text') return ['text', 'hex'];
  return [row.slot.kind ?? 'hex'];
};

/**
 * The rows as the bytes that travel, or the first problem with each row. An
 * optional argument left empty at the end is left out, as the contract expects.
 */
export const encodeRows = (rows: ArgRow[]) => {
  const errors: Record<number, string> = {};
  const bytes: Uint8Array[] = [];
  const trailingEmpty = [...rows]
    .reverse()
    .findIndex((row) => !(row.slot?.optional && row.value.trim() === ''));
  const used =
    trailingEmpty === -1 ? [] : rows.slice(0, rows.length - trailingEmpty);
  for (const row of used) {
    try {
      if (row.slot && row.slot.kind === null) {
        throw new Error(`This form cannot write a ${row.slot.type}.`);
      }
      bytes.push(encodeArgument(row.kind, row.value));
    } catch (error) {
      errors[row.id] = (error as Error).message;
    }
  }
  return {
    bytes,
    errors,
    typed: used.map((row) => ({ kind: row.kind, value: row.value }))
  };
};

interface ArgumentsEditorProps {
  rows: ArgRow[];
  onChange: (rows: ArgRow[]) => void;
  errors: Record<number, string>;
  /** Without an ABI, arguments are added and removed freely. */
  free: boolean;
  /** An ABI's variadic argument, which is always the last: as many as wanted. */
  repeatSlot?: Slot;
}

export const ArgumentsEditor = ({
  rows,
  onChange,
  errors,
  free,
  repeatSlot
}: ArgumentsEditorProps) => {
  const update = (id: number, change: Partial<ArgRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const remove = (id: number) => onChange(rows.filter((row) => row.id !== id));

  return (
    <div>
      {rows.length === 0 && <p className={hint}>No arguments.</p>}
      {rows.map((row, at) => {
        const kinds = kindsFor(row);
        return (
          <div key={row.id} className='mt-2'>
            {row.slot && (
              <p className='text-[11px] text-[#6B7280]'>
                <span className='font-mono text-[#9AA0A6]'>
                  {row.slot.name}
                </span>
                : {row.slot.type}
                {row.slot.optional ? ', may be left empty' : ''}
              </p>
            )}
            <div className='mt-1 flex flex-wrap gap-2 sm:flex-nowrap'>
              <select
                aria-label='Kind of argument'
                value={row.kind}
                disabled={kinds.length < 2}
                onChange={(event) =>
                  update(row.id, {
                    kind: event.target.value as ArgumentKind,
                    // What the true-or-false select shows is what it holds.
                    value:
                      event.target.value === 'bool'
                        ? 'false'
                        : row.kind === 'bool'
                          ? ''
                          : row.value
                  })
                }
                className={`${input} sm:w-44`}
              >
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              {row.slot?.choices ? (
                <select
                  aria-label={`Value of ${row.slot.name}`}
                  value={row.value}
                  onChange={(event) =>
                    update(row.id, { value: event.target.value })
                  }
                  className={input}
                >
                  {row.slot.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              ) : row.kind === 'bool' ? (
                <select
                  aria-label='Value'
                  value={row.value || 'false'}
                  onChange={(event) =>
                    update(row.id, { value: event.target.value })
                  }
                  className={input}
                >
                  <option value='true'>true</option>
                  <option value='false'>false</option>
                </select>
              ) : (
                <input
                  aria-label={
                    row.slot
                      ? `Value of ${row.slot.name}`
                      : `Argument ${at + 1}`
                  }
                  value={row.value}
                  onChange={(event) =>
                    update(row.id, { value: event.target.value })
                  }
                  placeholder={PLACEHOLDER[row.kind]}
                  className={`${input} ${row.kind === 'address' || row.kind === 'hex' ? 'font-mono' : ''}`}
                />
              )}
              {(free || row.slot?.repeat) && (
                <button
                  type='button'
                  onClick={() => remove(row.id)}
                  className={quietButton}
                  aria-label='Remove this argument'
                >
                  Remove
                </button>
              )}
            </div>
            {errors[row.id] && (
              <p className='mt-1 text-xs text-[#F87171]'>{errors[row.id]}</p>
            )}
          </div>
        );
      })}
      {free && (
        <button
          type='button'
          onClick={() => onChange([...rows, newRow()])}
          className='mt-2 text-xs text-[#FF6E0A] hover:underline'
        >
          + add an argument
        </button>
      )}
      {!free && repeatSlot && (
        <button
          type='button'
          onClick={() =>
            onChange([...rows, newRow(repeatSlot.kind ?? 'hex', repeatSlot)])
          }
          className='mt-2 text-xs text-[#FF6E0A] hover:underline'
        >
          + add {rows.some((row) => row.slot === repeatSlot) ? 'another' : 'a'}{' '}
          {repeatSlot.name}
        </button>
      )}
    </div>
  );
};

/** Rows for an ABI endpoint: one per argument, a variadic starting with none. */
export const rowsForSlots = (slots: Slot[]): ArgRow[] =>
  slots.flatMap((slot) =>
    slot.repeat ? [] : [newRow(slot.kind ?? 'hex', slot)]
  );
