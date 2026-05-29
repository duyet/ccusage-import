/**
 * CSV value/line formatting for the DuckDB COPY FROM path.
 */

import { describe, it, expect } from 'bun:test';
import { toCsvValue, toCsvLine } from '../../src/sinks/csv';

describe('toCsvValue', () => {
  it('null and undefined → empty string', () => {
    expect(toCsvValue(null)).toBe('');
    expect(toCsvValue(undefined)).toBe('');
  });

  it('non-finite numbers → "0"', () => {
    expect(toCsvValue(NaN)).toBe('0');
    expect(toCsvValue(Infinity)).toBe('0');
    expect(toCsvValue(-Infinity)).toBe('0');
  });

  it('finite numbers pass through', () => {
    expect(toCsvValue(0)).toBe('0');
    expect(toCsvValue(42.5)).toBe('42.5');
  });

  it('Date → "YYYY-MM-DD HH:MM:SS" (UTC)', () => {
    expect(toCsvValue(new Date('2025-01-05T10:00:00.000Z'))).toBe('2025-01-05 10:00:00');
  });

  it('quotes values containing comma, quote, or newline', () => {
    expect(toCsvValue('a,b')).toBe('"a,b"');
    expect(toCsvValue('a"b')).toBe('"a""b"');
    expect(toCsvValue('a\nb')).toBe('"a\nb"');
  });

  it('plain strings pass through unquoted', () => {
    expect(toCsvValue('hello')).toBe('hello');
  });
});

describe('toCsvLine', () => {
  it('joins columns in order with proper escaping', () => {
    const row = { a: 1, b: 'x,y', c: null };
    expect(toCsvLine(['a', 'b', 'c'], row)).toBe('1,"x,y",');
  });
});
