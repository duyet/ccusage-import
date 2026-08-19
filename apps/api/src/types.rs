use serde::{Deserialize, Serialize};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const TOKEN_PREFIX: &str = "summa_";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EventRow {
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub record_type: String,
    #[serde(default)]
    pub record_key: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub machine_name: String,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub api_key_id: String,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub project_path: String,
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub reasoning_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
    #[serde(default)]
    pub cost: f64,
    #[serde(default)]
    pub dedup_key: String,
    #[serde(default)]
    pub import_id: String,
    #[serde(default)]
    pub block_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_end_time: Option<String>,
    #[serde(default)]
    pub is_active: u8,
    #[serde(default)]
    pub is_gap: u8,
    #[serde(default)]
    pub entries: u32,
    #[serde(default)]
    pub burn_rate: f64,
    #[serde(default)]
    pub projection: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_limit_reset_time: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestBody {
    #[serde(default)]
    pub events: Vec<EventRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SinkAck {
    pub name: String,
    pub rows: u64,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PingSample {
    pub name: String,
    pub ok: bool,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsPoint {
    pub date: String,
    pub source: String,
    pub model_name: String,
    pub cost: f64,
    pub total_tokens: u64,
    pub entries: u64,
}

pub fn sha256_hex(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(input.as_bytes());
    hex::encode(h.finalize())
}

pub fn sha256_hex16(input: &str) -> String {
    sha256_hex(input).chars().take(16).collect()
}

pub fn timing_safe_eq(a: &str, b: &str) -> bool {
    sha256_hex(a) == sha256_hex(b)
}

pub fn ch_now() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn new_id() -> String {
    let mut buf = [0u8; 16];
    let _ = getrandom::getrandom(&mut buf);
    hex::encode(buf)
}

pub fn sql_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn ingest_status_code(sinks: &[SinkAck]) -> u16 {
    if sinks.is_empty() {
        503
    } else if sinks.iter().any(|s| s.error.is_none()) {
        200
    } else {
        502
    }
}

pub fn ping_ok(samples: &[PingSample]) -> bool {
    !samples.is_empty() && samples.iter().all(|s| s.ok)
}

pub fn cors_allow_origin(origin: Option<&str>) -> Option<String> {
    let Some(o) = origin.map(str::trim).filter(|s| !s.is_empty()) else {
        return Some("*".into());
    };
    if o == "https://burn.duyet.net" || o == "https://summa.duyet.net" {
        return Some(o.to_string());
    }
    if let Some(rest) = o.strip_prefix("http://localhost") {
        if rest.is_empty() || rest.starts_with(':') || rest.starts_with('/') {
            return Some(o.to_string());
        }
    }
    if let Some(rest) = o.strip_prefix("http://127.0.0.1") {
        if rest.is_empty() || rest.starts_with(':') || rest.starts_with('/') {
            return Some(o.to_string());
        }
    }
    None
}
