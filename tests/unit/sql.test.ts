/**
 * escapeSqlLiteral: double single quotes, leave everything else untouched.
 */

import { describe, it, expect } from 'bun:test';
import { escapeSqlLiteral } from '../../src/utils/sql';

describe('escapeSqlLiteral', () => {
  it('doubles a single quote', () => {
    expect(escapeSqlLiteral("O'Brien")).toBe("O''Brien");
  });

  it('doubles every quote', () => {
    expect(escapeSqlLiteral("a'b'c")).toBe("a''b''c");
  });

  it('empty string passes through', () => {
    expect(escapeSqlLiteral('')).toBe('');
  });

  it('no quotes passes through unchanged', () => {
    expect(escapeSqlLiteral('/home/user/project')).toBe('/home/user/project');
  });
});
