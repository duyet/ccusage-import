/**
 * Token-sum helper shared across row builders.
 */

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Total tokens = input + output + cacheCreation + cacheRead. Reasoning is
 * excluded on purpose. This is correct for BOTH Claude and Codex: the companion
 * fetcher normalizes Codex's `cachedInputTokens` into `cacheReadTokens` while
 * keeping `inputTokens` separate, so this 4-term sum equals ccusage's own
 * totalTokens. Do NOT add reasoning here — see tests/unit/companion.test.ts
 * (the `total_tokens === 2717719` assertion) before changing this.
 */
export function totalTokens(t: TokenCounts): number {
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}
