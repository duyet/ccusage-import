/**
 * Parser Type Definitions
 *
 * Typed structs for ccusage/OpenCode JSON data, with serde aliases that
 * mirror the Zod schemas in the TS source.
 *
 * IMPORTANT: ccusage CLI emits camelCase (`inputTokens`, `totalCost`,
 * `modelBreakdowns`, …). Serde field names are snake_case, so every
 * camelCase key must be listed as an `alias` (or `rename`). Missing
 * aliases silently default tokens to 0 while costs still parse — that
 * produced the Jul 2026+ "cost-only / zero-token" daily rows on burns.
 */

use serde::Deserialize;

/// Model breakdown schema — one row per model per record.
/// Note: ccusage breakdowns do NOT carry reasoning_tokens; that's
/// a companion-only field passed separately to breakdown_row.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelBreakdown {
    #[serde(default, alias = "modelName", alias = "model", alias = "name")]
    pub model_name: String,
    #[serde(default, alias = "inputTokens", alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "outputTokens", alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(
        default,
        alias = "cacheCreationTokens",
        alias = "cacheCreationInputTokens",
        alias = "cache_creation_tokens"
    )]
    pub cache_creation_tokens: u64,
    #[serde(
        default,
        alias = "cacheReadTokens",
        alias = "cacheReadInputTokens",
        alias = "cache_read_tokens",
        alias = "cachedInputTokens"
    )]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "costUSD", alias = "totalCost", alias = "cost")]
    pub cost: f64,
}

impl Default for ModelBreakdown {
    fn default() -> Self {
        ModelBreakdown {
            model_name: String::new(),
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            cost: 0.0,
        }
    }
}

/// ccusage daily data.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct DailyUsage {
    pub date: String,
    #[serde(default, alias = "inputTokens", alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "outputTokens", alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(
        default,
        alias = "cacheCreationTokens",
        alias = "cacheCreationInputTokens",
        alias = "cache_creation_tokens"
    )]
    pub cache_creation_tokens: u64,
    #[serde(
        default,
        alias = "cacheReadTokens",
        alias = "cacheReadInputTokens",
        alias = "cache_read_tokens",
        alias = "cachedInputTokens"
    )]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "totalTokens", alias = "total_tokens")]
    pub total_tokens: u64,
    #[serde(default, alias = "totalCost", alias = "cost")]
    pub total_cost: f64,
    #[serde(default, alias = "modelsUsed", alias = "models_used")]
    pub models_used: Vec<String>,
    #[serde(default, alias = "modelBreakdowns", alias = "model_breakdowns")]
    pub model_breakdowns: Vec<ModelBreakdown>,
    #[serde(default, alias = "models")]
    pub models: Vec<String>,
}

/// ccusage monthly data.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct MonthlyUsage {
    pub month: String,
    #[serde(default, alias = "inputTokens", alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "outputTokens", alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(
        default,
        alias = "cacheCreationTokens",
        alias = "cacheCreationInputTokens",
        alias = "cache_creation_tokens"
    )]
    pub cache_creation_tokens: u64,
    #[serde(
        default,
        alias = "cacheReadTokens",
        alias = "cacheReadInputTokens",
        alias = "cache_read_tokens",
        alias = "cachedInputTokens"
    )]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "totalTokens", alias = "total_tokens")]
    pub total_tokens: u64,
    #[serde(default, alias = "totalCost", alias = "cost")]
    pub total_cost: f64,
    #[serde(default, alias = "modelsUsed", alias = "models_used")]
    pub models_used: Vec<String>,
    #[serde(default, alias = "modelBreakdowns", alias = "model_breakdowns")]
    pub model_breakdowns: Vec<ModelBreakdown>,
}

/// ccusage session data.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SessionUsage {
    #[serde(alias = "sessionId", alias = "session", alias = "id", alias = "session_id")]
    pub session_id: String,
    #[serde(
        alias = "projectPath",
        alias = "directory",
        alias = "path",
        alias = "project_path",
        default
    )]
    pub project_path: String,
    #[serde(default, alias = "inputTokens", alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "outputTokens", alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(
        default,
        alias = "cacheCreationTokens",
        alias = "cacheCreationInputTokens",
        alias = "cache_creation_tokens"
    )]
    pub cache_creation_tokens: u64,
    #[serde(
        default,
        alias = "cacheReadTokens",
        alias = "cacheReadInputTokens",
        alias = "cache_read_tokens",
        alias = "cachedInputTokens"
    )]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "totalTokens", alias = "total_tokens")]
    pub total_tokens: u64,
    #[serde(default, alias = "totalCost", alias = "cost")]
    pub total_cost: f64,
    #[serde(alias = "lastActivity", alias = "last_activity", default)]
    pub last_activity: String,
    #[serde(default, alias = "modelsUsed", alias = "models_used")]
    pub models_used: Vec<String>,
    #[serde(default, alias = "modelBreakdowns", alias = "model_breakdowns")]
    pub model_breakdowns: Vec<ModelBreakdown>,
}

/// ccusage block data.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct BlockUsage {
    pub id: String,
    #[serde(alias = "startTime", default)]
    pub start_time: String,
    #[serde(alias = "endTime", default)]
    pub end_time: String,
    #[serde(alias = "actualEndTime", default)]
    pub actual_end_time: Option<String>,
    #[serde(alias = "isActive", default)]
    pub is_active: bool,
    #[serde(alias = "isGap", default)]
    pub is_gap: bool,
    #[serde(default)]
    pub entries: u32,
    #[serde(default, rename = "tokenCounts", alias = "token_counts")]
    pub token_counts: TokenCounts_,
    #[serde(alias = "totalTokens", default)]
    pub total_tokens: u64,
    #[serde(alias = "costUSD", default)]
    pub cost_usd: f64,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(alias = "usageLimitResetTime", default)]
    pub usage_limit_reset_time: Option<String>,
    #[serde(default)]
    pub burn_rate: serde_json::Value,
    #[serde(default)]
    pub projection: serde_json::Value,
}

/// Token counts inside a block.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct TokenCounts_ {
    #[serde(default, alias = "inputTokens", alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "outputTokens", alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(
        default,
        alias = "cacheCreationTokens",
        alias = "cacheCreationInputTokens",
        alias = "cache_creation_tokens"
    )]
    pub cache_creation_tokens: u64,
    #[serde(
        default,
        alias = "cacheReadTokens",
        alias = "cacheReadInputTokens",
        alias = "cache_read_tokens"
    )]
    pub cache_read_tokens: u64,
}

/// Project daily usage.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ProjectDailyUsage {
    pub date: String,
    #[serde(default, alias = "inputTokens", alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "outputTokens", alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(
        default,
        alias = "cacheCreationTokens",
        alias = "cacheCreationInputTokens",
        alias = "cache_creation_tokens"
    )]
    pub cache_creation_tokens: u64,
    #[serde(
        default,
        alias = "cacheReadTokens",
        alias = "cacheReadInputTokens",
        alias = "cache_read_tokens",
        alias = "cachedInputTokens"
    )]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "totalTokens", alias = "total_tokens")]
    pub total_tokens: u64,
    #[serde(default, alias = "totalCost", alias = "cost")]
    pub total_cost: f64,
    #[serde(default, alias = "modelsUsed", alias = "models_used")]
    pub models_used: Vec<String>,
    #[serde(default, alias = "modelBreakdowns", alias = "model_breakdowns")]
    pub model_breakdowns: Vec<ModelBreakdown>,
}

/// ccusage daily response wrapper.
#[derive(Debug, Clone, Deserialize)]
pub struct CcusageDailyResponse {
    pub daily: Vec<DailyUsage>,
    #[serde(default)]
    pub totals: Option<Totals>,
}

/// ccusage session response wrapper.
#[derive(Debug, Clone, Deserialize)]
pub struct CcusageSessionResponse {
    pub sessions: Vec<SessionUsage>,
    #[serde(default)]
    pub totals: Option<Totals>,
}

/// ccusage blocks response wrapper.
#[derive(Debug, Clone, Deserialize)]
pub struct CcusageBlocksResponse {
    pub blocks: Vec<BlockUsage>,
}

/// ccusage projects response wrapper.
#[derive(Debug, Clone, Deserialize)]
pub struct CcusageProjectsResponse {
    #[serde(default)]
    pub projects: std::collections::HashMap<String, Vec<ProjectDailyUsage>>,
    #[serde(default)]
    pub totals: Option<Totals>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Totals {
    #[serde(default, alias = "totalCost")]
    pub total_cost: f64,
    #[serde(default, alias = "totalTokens")]
    pub total_tokens: u64,
}

/// OpenCode message schema.
#[derive(Debug, Clone, Deserialize)]
pub struct OpenCodeMessage {
    pub role: String,
    pub model: String,
    pub date: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub usage: OpenCodeUsage,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct OpenCodeUsage {
    #[serde(default, alias = "inputTokens", alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "outputTokens", alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(
        default,
        alias = "cacheCreationTokens",
        alias = "cacheCreationInputTokens",
        alias = "cache_creation_tokens"
    )]
    pub cache_creation_tokens: u64,
    #[serde(
        default,
        alias = "cacheReadTokens",
        alias = "cacheReadInputTokens",
        alias = "cache_read_tokens"
    )]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "costUSD", alias = "total_cost")]
    pub cost: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Regression: ccusage CLI camelCase must populate tokens (not only cost).
    #[test]
    fn daily_usage_parses_ccusage_camel_case() {
        let raw = json!({
            "date": "2026-08-07",
            "inputTokens": 250777,
            "outputTokens": 64149,
            "cacheCreationTokens": 520714,
            "cacheReadTokens": 11176815,
            "totalTokens": 12012455,
            "totalCost": 301.2222,
            "modelsUsed": ["claude-opus-4-8"],
            "modelBreakdowns": [{
                "modelName": "claude-opus-4-8",
                "inputTokens": 250777,
                "outputTokens": 64149,
                "cacheCreationTokens": 520714,
                "cacheReadTokens": 11176815,
                "cost": 301.2222
            }]
        });

        let day: DailyUsage = serde_json::from_value(raw).expect("deserialize");
        assert_eq!(day.input_tokens, 250777);
        assert_eq!(day.output_tokens, 64149);
        assert_eq!(day.cache_creation_tokens, 520714);
        assert_eq!(day.cache_read_tokens, 11176815);
        assert_eq!(day.total_tokens, 12012455);
        assert!((day.total_cost - 301.2222).abs() < 1e-6);
        assert_eq!(day.models_used, vec!["claude-opus-4-8"]);
        assert_eq!(day.model_breakdowns.len(), 1);
        let bd = &day.model_breakdowns[0];
        assert_eq!(bd.model_name, "claude-opus-4-8");
        assert_eq!(bd.input_tokens, 250777);
        assert_eq!(bd.cache_read_tokens, 11176815);
        assert!((bd.cost - 301.2222).abs() < 1e-6);
    }

    /// Without camelCase aliases this would silently zero tokens (the Jul bug).
    #[test]
    fn daily_usage_does_not_zero_tokens_when_cost_present() {
        let raw = json!({
            "date": "2026-08-07",
            "inputTokens": 100,
            "outputTokens": 50,
            "cacheCreationTokens": 0,
            "cacheReadTokens": 0,
            "totalTokens": 150,
            "totalCost": 1.5,
            "modelsUsed": [],
            "modelBreakdowns": []
        });
        let day: DailyUsage = serde_json::from_value(raw).unwrap();
        assert!(day.total_tokens > 0, "tokens must not be zeroed");
        assert!(day.total_cost > 0.0);
    }

    #[test]
    fn block_token_counts_camel_case() {
        let raw = json!({
            "id": "block-1",
            "startTime": "2026-08-07T00:00:00.000Z",
            "endTime": "2026-08-07T05:00:00.000Z",
            "actualEndTime": null,
            "isActive": false,
            "isGap": false,
            "entries": 3,
            "tokenCounts": {
                "inputTokens": 10,
                "outputTokens": 20,
                "cacheCreationInputTokens": 30,
                "cacheReadInputTokens": 40
            },
            "totalTokens": 100,
            "costUSD": 1.23,
            "models": ["claude-opus-4-8"]
        });
        let block: BlockUsage = serde_json::from_value(raw).unwrap();
        assert_eq!(block.token_counts.input_tokens, 10);
        assert_eq!(block.token_counts.output_tokens, 20);
        assert_eq!(block.token_counts.cache_creation_tokens, 30);
        assert_eq!(block.token_counts.cache_read_tokens, 40);
        assert_eq!(block.total_tokens, 100);
        assert!((block.cost_usd - 1.23).abs() < 1e-9);
    }
}
