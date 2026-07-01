import { describe, it, expect } from 'vitest';
import { parseStrictInt } from './parseStrictInt';

describe('parseStrictInt', () => {
  it('parses plain integers', () => {
    expect(parseStrictInt('0')).toBe(0);
    expect(parseStrictInt('5')).toBe(5);
    expect(parseStrictInt('1000')).toBe(1000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseStrictInt('  42 ')).toBe(42);
  });

  it('parses signed integers', () => {
    expect(parseStrictInt('-3')).toBe(-3);
    expect(parseStrictInt('+7')).toBe(7);
  });

  it('rejects exponent notation (parseInt would silently truncate)', () => {
    expect(parseStrictInt('1e3')).toBeNull();
    expect(parseStrictInt('1e2')).toBeNull();
  });

  it('rejects numeric strings with trailing tokens', () => {
    expect(parseStrictInt('12abc')).toBeNull();
    expect(parseStrictInt('500words')).toBeNull();
  });

  it('rejects decimals', () => {
    expect(parseStrictInt('3.5')).toBeNull();
    expect(parseStrictInt('10.0')).toBeNull();
  });

  it('rejects empty and non-numeric input', () => {
    expect(parseStrictInt('')).toBeNull();
    expect(parseStrictInt('   ')).toBeNull();
    expect(parseStrictInt('abc')).toBeNull();
    expect(parseStrictInt('NaN')).toBeNull();
  });

  it('rejects integers beyond the safe range', () => {
    expect(parseStrictInt('99999999999999999999')).toBeNull();
  });
});
