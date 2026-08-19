/**
 * Token-sum helper shared across row builders.
 */

/// Total tokens = input + output + cacheCreation + cacheRead.
/// Reasoning is excluded on purpose — correct for both Claude and Codex.
/// See the `2717719` companion test assertion before changing this.
pub fn total_tokens(input: u64, output: u64, cache_creation: u64, cache_read: u64) -> u64 {
    input + output + cache_creation + cache_read
}

/// Total tokens from a token-counts struct (convenience).
pub fn total_tokens_struct(t: &TokenCounts) -> u64 {
    t.input_tokens + t.output_tokens + t.cache_creation_tokens + t.cache_read_tokens
}

/// Token-counts struct matching the TS `TokenCounts` interface.
pub struct TokenCounts {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_four_term_sum() {
        // 1000 + 2000 + 100 + 200 = 3300
        assert_eq!(total_tokens(1000, 2000, 100, 200), 3300);
    }

    #[test]
    fn codex_cache_included_reasoning_excluded() {
        // Matches companion 2717719: 469867 + 33580 + 0 + 2214272
        assert_eq!(total_tokens(469867, 33580, 0, 2214272), 2717719);
    }

    #[test]
    fn all_zero() {
        assert_eq!(total_tokens(0, 0, 0, 0), 0);
    }
}
