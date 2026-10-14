// UPG-05: a "true or false" argument row starts with the value '' (newRow keeps
// the value empty unless the slot is an enum), the editor's select shows
// "false" for it (`value={row.value || 'false'}`), but encodeRows encodes the
// row's real value '' and fails with '"" is neither true nor false'. What is
// shown is not what is sent: the row shows false and cannot be proposed until
// the proposer picks true and then false again. With an ABI the row comes from
// rowsForSlots the same way, so every bool argument of a loaded ABI starts in
// that state.
import '../display/restoreSetImmediate';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import {
  ArgumentsEditor,
  encodeRows,
  newRow,
  rowsForSlots
} from 'components/Propose/shared';

const shown = () => (screen.getByLabelText('Value') as HTMLSelectElement).value;

/** What the editor shows for the row has to be what the row encodes to. */
const expectShownIsSent = (rows: ReturnType<typeof newRow>[]) => {
  render(
    <ArgumentsEditor rows={rows} onChange={() => undefined} errors={{}} free />
  );
  const value = shown();
  expect(['true', 'false']).toContain(value);
  const { bytes, errors } = encodeRows(rows);
  expect(errors).toEqual({});
  expect(Array.from(bytes[0])).toEqual(value === 'true' ? [1] : []);
};

test('control: a row whose value was picked encodes as shown', () => {
  const row = { ...newRow('bool'), value: 'false' };
  expectShownIsSent([row]);
});

test('a bool row added without an ABI encodes as the value the editor shows', () => {
  expectShownIsSent([newRow('bool')]);
});

test('a bool argument from an ABI encodes as the value the editor shows', () => {
  const rows = rowsForSlots([
    {
      name: 'paused',
      type: 'bool',
      kind: 'bool',
      repeat: false,
      optional: false
    }
  ]);
  expectShownIsSent(rows);
});
