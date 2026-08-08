/**
 * Shared model cost estimation from public provider rates.
 *
 * Used when a source has no billed cost (Antigravity, free Hermes sessions)
 * or when Hermes `estimated_cost_usd` is absurd relative to token volume.
 *
 * Rates are USD per 1M tokens: (input, cache_read, cache_write, output).
 * Keep these in sync with provider docs; imperfect rates beat silent $0.
 */

/// USD per 1M tokens.
#[derive(Debug, Clone, Copy)]
pub struct ModelRates {
    pub input: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub output: f64,
}

const FREE: ModelRates = ModelRates {
    input: 0.0,
    cache_read: 0.0,
    cache_write: 0.0,
    output: 0.0,
};

/// Gemini 3.5 Flash (Google AI Studio / Vertex-ish list prices, 2026).
const GEMINI_35_FLASH: ModelRates = ModelRates {
    input: 1.50,
    cache_read: 0.15,
    cache_write: 1.50,
    output: 9.00,
};

/// Gemini 3 Flash family.
const GEMINI_3_FLASH: ModelRates = ModelRates {
    input: 0.50,
    cache_read: 0.05,
    cache_write: 0.50,
    output: 3.00,
};

/// Gemini 2.5 Flash (legacy).
const GEMINI_25_FLASH: ModelRates = ModelRates {
    input: 0.30,
    cache_read: 0.03,
    cache_write: 0.30,
    output: 2.50,
};

/// Claude Sonnet 4.x (Anthropic list, cache write ≈ 1.25× input).
const CLAUDE_SONNET: ModelRates = ModelRates {
    input: 3.00,
    cache_read: 0.30,
    cache_write: 3.75,
    output: 15.00,
};

/// Claude Opus 4.x.
const CLAUDE_OPUS: ModelRates = ModelRates {
    input: 15.00,
    cache_read: 1.50,
    cache_write: 18.75,
    output: 75.00,
};

/// Claude Haiku.
const CLAUDE_HAIKU: ModelRates = ModelRates {
    input: 0.80,
    cache_read: 0.08,
    cache_write: 1.00,
    output: 4.00,
};

/// Z.AI / GLM mid-tier (OpenRouter-ish).
const GLM_MID: ModelRates = ModelRates {
    input: 0.50,
    cache_read: 0.05,
    cache_write: 0.50,
    output: 1.50,
};

/// Default when model is unknown — mid Flash tier.
const DEFAULT_RATES: ModelRates = GEMINI_3_FLASH;

fn normalize(model: &str) -> String {
    model.to_ascii_lowercase().replace('_', "-").replace(' ', "-")
}

/// Map a free-form model id / display name to public rates.
pub fn rates_for_model(model: &str) -> ModelRates {
    let m = normalize(model);

    // Free / unpriced tiers
    if m.contains("free")
        || m.contains("gpt-oss")
        || m.contains("openrouter/free")
        || m.contains("anyrouter/free")
    {
        return FREE;
    }

    // Anthropic
    if m.contains("opus") {
        return CLAUDE_OPUS;
    }
    if m.contains("sonnet") {
        return CLAUDE_SONNET;
    }
    if m.contains("haiku") {
        return CLAUDE_HAIKU;
    }
    if m.contains("claude") {
        // bare "claude" → sonnet-class default
        return CLAUDE_SONNET;
    }

    // Google Gemini
    if m.contains("3.5-flash") || m.contains("3-5-flash") || m.contains("gemini-3.5") {
        return GEMINI_35_FLASH;
    }
    if m.contains("3.6-flash") || m.contains("3-6-flash") {
        return GEMINI_35_FLASH; // price like 3.5 until published
    }
    if m.contains("3-flash") || m.contains("gemini-3-flash") || m.contains("gemini-default") {
        return GEMINI_3_FLASH;
    }
    if m.contains("2.5-flash") || m.contains("2-5-flash") {
        return GEMINI_25_FLASH;
    }
    if m.contains("gemini") || m.contains("flash") {
        return GEMINI_3_FLASH;
    }

    // Z.AI / GLM
    if m.contains("glm") || m.contains("z-ai") || m.contains("zai") {
        return GLM_MID;
    }

    // Hermes presets often route to a mid coding model — Flash-class default
    if m.contains("hermes") || m.contains("@preset") {
        return GEMINI_3_FLASH;
    }

    // Gemma / other open weights — treat as free-ish local unless known paid
    if m.contains("gemma") {
        return FREE;
    }

    DEFAULT_RATES
}

/// Estimate USD cost from token breakdown + model name.
pub fn estimate_model_cost(
    model: &str,
    input_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    output_tokens: u64,
) -> f64 {
    let rates = rates_for_model(model);
    let cost = (input_tokens as f64 / 1_000_000.0) * rates.input
        + (cache_read_tokens as f64 / 1_000_000.0) * rates.cache_read
        + (cache_write_tokens as f64 / 1_000_000.0) * rates.cache_write
        + (output_tokens as f64 / 1_000_000.0) * rates.output;
    round_cents(cost)
}

fn round_cents(cost: f64) -> f64 {
    (cost * 100.0).round() / 100.0
}

/// Hermes sometimes stores wild `estimated_cost_usd` values.
/// Prefer reported cost when sane; otherwise fall back to token estimate.
///
/// "Sane" = positive and ≤ 50× the token estimate, and ≤ $200 blended per 1M tokens.
pub fn resolve_reported_cost(
    model: &str,
    reported: f64,
    input_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    output_tokens: u64,
) -> f64 {
    let estimated = estimate_model_cost(
        model,
        input_tokens,
        cache_read_tokens,
        cache_write_tokens,
        output_tokens,
    );
    let total = input_tokens
        .saturating_add(cache_read_tokens)
        .saturating_add(cache_write_tokens)
        .saturating_add(output_tokens);

    if reported <= 0.0 {
        return estimated;
    }
    if total == 0 {
        return 0.0;
    }

    let blended_per_m = reported / (total as f64 / 1_000_000.0);
    if blended_per_m > 200.0 {
        return estimated;
    }
    if estimated > 0.0 && reported > estimated * 50.0 {
        return estimated;
    }

    round_cents(reported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemini_35_flash_rates() {
        let r = rates_for_model("gemini-3.5-flash-medium");
        assert!((r.input - 1.50).abs() < 1e-9);
        assert!((r.output - 9.00).abs() < 1e-9);
    }

    #[test]
    fn claude_opus_display_name() {
        let r = rates_for_model("Claude Opus 4.6 (Thinking)");
        assert!((r.input - 15.00).abs() < 1e-9);
    }

    #[test]
    fn free_models_zero() {
        assert_eq!(estimate_model_cost("openrouter/free", 1_000_000, 0, 0, 1_000_000), 0.0);
        assert_eq!(estimate_model_cost("openai/gpt-oss-20b", 1_000_000, 0, 0, 0), 0.0);
    }

    #[test]
    fn estimate_gemini_cost() {
        // 1M in + 10M cache_read + 0.1M out @ 1.50 / 0.15 / 9
        let c = estimate_model_cost("gemini-3.5-flash-medium", 1_000_000, 10_000_000, 0, 100_000);
        assert!((c - (1.50 + 1.50 + 0.90)).abs() < 0.02);
    }

    #[test]
    fn resolve_rejects_absurd_hermes_estimate() {
        // 1M tokens total, reported $50k → insane
        let c = resolve_reported_cost("gemini-3-flash", 50_000.0, 500_000, 400_000, 0, 100_000);
        assert!(c < 100.0, "should fall back to estimate, got {c}");
    }

    #[test]
    fn resolve_keeps_sane_reported() {
        let c = resolve_reported_cost("@preset/hermes-agent", 1.25, 500_000, 0, 0, 100_000);
        assert!((c - 1.25).abs() < 1e-9);
    }
}
