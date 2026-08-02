/**
 * Parser Type Definitions
 *
 * Typed structs for ccusage/OpenCode JSON data, with serde aliases that
 * mirror the Zod schemas in the TS source.
 */

use serde::Deserialize;

/// Model breakdown schema — one row per model per record.
/// Note: ccusage ccusage breakdowns do NOT carry reasoning_tokens; that's
/// a companion-only field passed separately to breakdown_row.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelBreakdown {
    #[serde(default, alias = "modelName", alias = "model", alias = "name")]
    pub model_name: String,
    #[serde(default, alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(default, alias = "cacheCreationInputTokens", alias = "cache_creation_tokens")]
    pub cache_creation_tokens: u64,
    #[serde(default, alias = "cacheReadInputTokens", alias = "cache_read_tokens", alias = "cachedInputTokens")]
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
    #[serde(default, alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(default, alias = "cacheCreationInputTokens", alias = "cache_creation_tokens")]
    pub cache_creation_tokens: u64,
    #[serde(default, alias = "cacheReadInputTokens", alias = "cache_read_tokens", alias = "cachedInputTokens")]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "total_tokens")]
    pub total_tokens: u64,
    #[serde(default, alias = "totalCost", alias = "cost")]
    pub total_cost: f64,
    #[serde(default)]
    pub models_used: Vec<String>,
    #[serde(default)]
    pub model_breakdowns: Vec<ModelBreakdown>,
    #[serde(default, alias = "models")]
    pub models: Vec<String>,
}

/// ccusage monthly data.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct MonthlyUsage {
    pub month: String,
    #[serde(default, alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(default, alias = "cacheCreationInputTokens", alias = "cache_creation_tokens")]
    pub cache_creation_tokens: u64,
    #[serde(default, alias = "cacheReadInputTokens", alias = "cache_read_tokens", alias = "cachedInputTokens")]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "total_tokens")]
    pub total_tokens: u64,
    #[serde(default, alias = "totalCost", alias = "cost")]
    pub total_cost: f64,
    #[serde(default)]
    pub models_used: Vec<String>,
    #[serde(default)]
    pub model_breakdowns: Vec<ModelBreakdown>,
}

/// ccusage session data.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SessionUsage {
    #[serde(alias = "sessionId", alias = "session", alias = "id", alias = "session_id")]
    pub session_id: String,
    #[serde(alias = "projectPath", alias = "directory", alias = "path", alias = "project_path", default)]
    pub project_path: String,
    #[serde(default, alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(default, alias = "cacheCreationInputTokens", alias = "cache_creation_tokens")]
    pub cache_creation_tokens: u64,
    #[serde(default, alias = "cacheReadInputTokens", alias = "cache_read_tokens", alias = "cachedInputTokens")]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "total_tokens")]
    pub total_tokens: u64,
    #[serde(default, alias = "totalCost", alias = "cost")]
    pub total_cost: f64,
    #[serde(alias = "lastActivity", alias = "last_activity", default)]
    pub last_activity: String,
    #[serde(default)]
    pub models_used: Vec<String>,
    #[serde(default)]
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
    #[serde(default, rename = "tokenCounts")]
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
    #[serde(alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(alias = "cacheCreationInputTokens", alias = "cache_creation_tokens")]
    pub cache_creation_tokens: u64,
    #[serde(alias = "cacheReadInputTokens", alias = "cache_read_tokens")]
    pub cache_read_tokens: u64,
}

/// Project daily usage.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ProjectDailyUsage {
    pub date: String,
    #[serde(default, alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(default, alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(default, alias = "cacheCreationInputTokens", alias = "cache_creation_tokens")]
    pub cache_creation_tokens: u64,
    #[serde(default, alias = "cacheReadInputTokens", alias = "cache_read_tokens", alias = "cachedInputTokens")]
    pub cache_read_tokens: u64,
    #[serde(default, alias = "total_tokens")]
    pub total_tokens: u64,
    #[serde(default, alias = "totalCost", alias = "cost")]
    pub total_cost: f64,
    #[serde(default)]
    pub models_used: Vec<String>,
    #[serde(default)]
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
    pub projects: std::collections::HashMap<String, Vec<ProjectDailyUsage>>,
    #[serde(default)]
    pub totals: Option<Totals>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Totals {
    #[serde(alias = "totalCost")]
    pub total_cost: f64,
    #[serde(alias = "totalTokens")]
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
    #[serde(alias = "input_tokens")]
    pub input_tokens: u64,
    #[serde(alias = "output_tokens")]
    pub output_tokens: u64,
    #[serde(alias = "cacheCreationInputTokens", alias = "cache_creation_tokens")]
    pub cache_creation_tokens: u64,
    #[serde(alias = "cacheReadInputTokens", alias = "cache_read_tokens")]
    pub cache_read_tokens: u64,
    #[serde(alias = "costUSD", alias = "total_cost")]
    pub cost: f64,
}
