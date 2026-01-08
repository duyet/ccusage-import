/**
 * Formatting utility tests
 */

import { describe, it, expect } from 'bun:test';
import {
  formatNumber,
  formatCost,
  formatDuration,
  formatPercentage,
  formatDate,
  truncate,
  pad,
} from '../../src/ui/utils/formatting';

describe('formatNumber', () => {
  it('should format zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('should format small numbers', () => {
    expect(formatNumber(123)).toBe('123');
    expect(formatNumber(999)).toBe('999');
  });

  it('should format thousands', () => {
    expect(formatNumber(1234)).toBe('1.2K');
    expect(formatNumber(1000)).toBe('1.0K');
  });

  it('should format millions', () => {
    expect(formatNumber(1234567)).toBe('1.2M');
    expect(formatNumber(1000000)).toBe('1.0M');
  });

  it('should format billions', () => {
    expect(formatNumber(1234567890)).toBe('1.2B');
    expect(formatNumber(1000000000)).toBe('1.0B');
  });

  it('should format negative numbers', () => {
    expect(formatNumber(-1234)).toBe('-1.2K');
    expect(formatNumber(-1000000)).toBe('-1.0M');
  });
});

describe('formatCost', () => {
  it('should format costs', () => {
    expect(formatCost(12.34)).toBe('$12.34');
    expect(formatCost(0.5)).toBe('$0.50');
    expect(formatCost(100)).toBe('$100.00');
  });
});

describe('formatDuration', () => {
  it('should format seconds', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('should format minutes', () => {
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(120)).toBe('2m');
  });

  it('should format hours', () => {
    expect(formatDuration(3661)).toBe('1h 1m 1s');
    expect(formatDuration(7200)).toBe('2h');
  });
});

describe('formatPercentage', () => {
  it('should format percentages', () => {
    expect(formatPercentage(95.5)).toBe('95.5%');
    expect(formatPercentage(100)).toBe('100.0%');
    expect(formatPercentage(0)).toBe('0.0%');
  });
});

describe('truncate', () => {
  it('should not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('should truncate long strings', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });
});

describe('pad', () => {
  it('should pad left by default', () => {
    expect(pad('test', 8)).toBe('test    ');
  });

  it('should pad right', () => {
    expect(pad('test', 8, 'right')).toBe('    test');
  });

  it('should pad center', () => {
    expect(pad('test', 8, 'center')).toBe('  test  ');
  });
});
