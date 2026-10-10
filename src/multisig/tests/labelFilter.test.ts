// A name is the one thing in this app a person authors, and it travels in the
// export file: whoever imports a file gets its names as they are. A name can
// hide characters that reverse the text or take no space, pass itself off as
// an address, or mix lookalike letters from two alphabets. The sentence a
// signer approves was already protected (DISP-10); names, shown on the board,
// in the history and in the header, were not (open since 7 Oct, fixed 11 Oct).
import { Address } from '@multiversx/sdk-core';
import { getLabel, mergeLabels, setLabel } from 'multisig/addressBook';

const address = (n: number) => {
  const bytes = Buffer.alloc(32, 7);
  bytes[31] = n;
  return new Address(bytes).toBech32();
};

beforeEach(() => window.localStorage.clear());

test('control: ordinary names pass unchanged, in any one alphabet', () => {
  mergeLabels({
    [address(1)]: 'Sebastian Marian',
    [address(2)]: 'Ops & Treasury',
    [address(3)]: 'Ana-Maria',
    [address(4)]: 'Лора Чолакова'
  });
  expect(getLabel(address(1))).toBe('Sebastian Marian');
  expect(getLabel(address(2))).toBe('Ops & Treasury');
  expect(getLabel(address(3))).toBe('Ana-Maria');
  expect(getLabel(address(4))).toBe('Лора Чолакова');
});

test('an imported name loses its invisible and direction-changing characters', () => {
  mergeLabels({
    [address(1)]: 'Trea‮sury',
    [address(2)]: 'Seb​astian',
    [address(3)]: '⁦Bob⁩',
    [address(4)]: 'Carolㅤ'
  });
  expect(getLabel(address(1))).toBe('Treasury');
  expect(getLabel(address(2))).toBe('Sebastian');
  expect(getLabel(address(3))).toBe('Bob');
  expect(getLabel(address(4))).toBe('Carol');
});

test('wide lookalike letters are folded into ordinary ones', () => {
  mergeLabels({ [address(1)]: 'Ｓｅｂａｓｔｉａｎ' });
  expect(getLabel(address(1))).toBe('Sebastian');
});

test('a name that passes itself off as an address is refused', () => {
  mergeLabels({ [address(1)]: 'erd1qqqqqqqq...lfe98p', [address(2)]: 'ｅｒｄ１ｑｑｑ' });
  expect(getLabel(address(1))).toBe('');
  expect(getLabel(address(2))).toBe('');
});

test('a word that mixes lookalike letters from two alphabets is refused', () => {
  // The second letter is a Cyrillic "а".
  mergeLabels({ [address(1)]: 'Pаypal' });
  expect(getLabel(address(1))).toBe('');
});

test('the same rules apply to a typed name and to one already stored', () => {
  setLabel(address(1), 'Dave‮');
  expect(getLabel(address(1))).toBe('Dave');
  window.localStorage.setItem('mvxsafe.labels', JSON.stringify({ [address(2)]: 'Er‍in' }));
  expect(getLabel(address(2))).toBe('Erin');
});
