/**
 * totalTokens: 4-term sum (input + output + cacheCreation + cacheRead),
 * reasoning excluded — correct for both Claude and Codex.
 */

import { describe, it, expect } from 'bun:test';
import { totalTokens } from '../../src/utils/tokens';

describe('totalTokens', () => {
  it('Claude: input + output + cacheCreation + cacheRead', () => {
    expect(
      totalTokens({ inputTokens: 1000, outputTokens: 2000, cacheCreationTokens: 100, cacheReadTokens: 200 })
    ).toBe(3300);
  });

  it('Codex: cache included, reasoning excluded (mirrors companion 2717719)', () => {
    // From tests/unit/companion.test.ts: 469867 + 33580 + 0 + 2214272 = 2717719
    expect(
      totalTokens({ inputTokens: 469867, outputTokens: 33580, cacheCreationTokens: 0, cacheReadTokens: 2214272 })
    ).toBe(2717719);
  });

  it('all zero → 0', () => {
    expect(totalTokens({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })).toBe(0);
  });
});
