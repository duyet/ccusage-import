/**
 * Grok Build account-wide billing API (CodexBar CLI-proxy / xAI Management).
 *
 * CodexBar’s Grok path is SuperGrok **credits percent**
 * (`GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`) plus
 * optional xAI Management prepaid spend. Neither is a per-turn usage log.
 *
 * This module maps JSON only when it yields **countable** totals (token
 * events, or spend cents such as `usage.totalUsed.val`). Credits-percent
 * or prepaid-balance-only payloads are skipped — we do not fabricate
 * per-turn rows. Local `~/.grok` ingest in `source/grok.rs` is unchanged.
 *
 * Account-wide rows use `source=grok-api` and `machine_name=account`.
 */

use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;

use crate::model::{DataSource, EventRow, EventsSnapshotData, SourceResult};
use crate::util::date::ch_now;
use crate::util::hash::make_dedup_key;

pub const SOURCE_GROK_API: &str = "grok-api";
/// Account-wide identity — never the importer hostname.
pub const GROK_API_ACCOUNT_MACHINE: &str = "account";
const CLI_PROXY_BILLING: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

#[derive(Debug, Clone, Default)]
pub struct GrokApiSourceOptions {
    pub verbose: bool,
    pub import_id: String,
    /// Override auth.json (tests). `None` = `$GROK_HOME/auth.json` or `~/.grok/auth.json`.
    pub auth_path: Option<PathBuf>,
    /// Skip HTTP (tests).
    pub disable_network: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GrokBillingKind {
    /// Per-event or token totals that can become usage rows.
    TokenEvents,
    /// Monetary cents (`usage.totalUsed.val` / included / on-demand used).
    SpendCents { cents: f64, period_start: Option<String>, period_end: Option<String> },
    /// `creditUsagePercent` (and similar ratios) only — not countable.
    CreditsPercentOnly,
    Empty,
}

pub struct GrokApiSource {
    opts: GrokApiSourceOptions,
}

impl GrokApiSource {
    pub fn new(opts: GrokApiSourceOptions) -> Self {
        Self { opts }
    }
}

#[async_trait]
impl DataSource for GrokApiSource {
    fn name(&self) -> &'static str {
        SOURCE_GROK_API
    }

    async fn fetch(&self) -> anyhow::Result<SourceResult> {
        match fetch_grok_api_events(&self.opts).await {
            Ok(events) => {
                if self.opts.verbose {
                    eprintln!("Grok API Source parsed {} rows.", events.len());
                }
                Ok(SourceResult {
                    source_name: self.name().to_string(),
                    data: EventsSnapshotData { events },
                    fetched_at: chrono::Utc::now().to_rfc3339(),
                    error: None,
                })
            }
            Err(e) => {
                if self.opts.verbose {
                    eprintln!("Grok API Source skipped/failed: {e}");
                }
                Ok(SourceResult {
                    source_name: self.name().to_string(),
                    data: EventsSnapshotData { events: Vec::new() },
                    fetched_at: chrono::Utc::now().to_rfc3339(),
                    error: Some(e.to_string()),
                })
            }
        }
    }
}

pub async fn fetch_grok_api_events(opts: &GrokApiSourceOptions) -> anyhow::Result<Vec<EventRow>> {
    if opts.disable_network {
        return Ok(Vec::new());
    }
    let token = match load_grok_bearer(opts.auth_path.as_deref()) {
        Some(t) => t,
        None => {
            if opts.verbose {
                eprintln!("Grok API: no usable ~/.grok/auth.json token; skipping");
            }
            return Ok(Vec::new());
        }
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    let resp = client
        .get(CLI_PROXY_BILLING)
        .header("Authorization", format!("Bearer {token}"))
        .header("x-xai-token-auth", "xai-grok-cli")
        .header("Accept", "application/json")
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        anyhow::bail!("Grok CLI-proxy billing HTTP {status}");
    }
    let now = ch_now();
    Ok(map_grok_billing_json(&text, &opts.import_id, &now)?)
}

/// Classify a CLI-proxy / xAI billing JSON payload.
pub fn classify_grok_billing(v: &Value) -> GrokBillingKind {
    if extract_token_events(v).map(|e| !e.is_empty()).unwrap_or(false) {
        return GrokBillingKind::TokenEvents;
    }
    if let Some(cents) = spend_cents(v) {
        let (start, end) = period_bounds(v);
        return GrokBillingKind::SpendCents {
            cents,
            period_start: start,
            period_end: end,
        };
    }
    if has_credits_percent(v) {
        return GrokBillingKind::CreditsPercentOnly;
    }
    GrokBillingKind::Empty
}

/// Map billing JSON to EventRows. Credits-percent-only → no rows (do not fabricate turns).
pub fn map_grok_billing_json(
    json: &str,
    import_id: &str,
    now: &str,
) -> anyhow::Result<Vec<EventRow>> {
    let v: Value = serde_json::from_str(json)?;
    match classify_grok_billing(&v) {
        GrokBillingKind::TokenEvents => Ok(map_token_events(&v, import_id, now)),
        GrokBillingKind::SpendCents {
            cents,
            period_start,
            period_end,
        } => Ok(vec![spend_row(cents, period_start, period_end, import_id, now)]),
        GrokBillingKind::CreditsPercentOnly | GrokBillingKind::Empty => Ok(Vec::new()),
    }
}

fn extract_token_events(v: &Value) -> Option<Vec<&Value>> {
    let candidates = [
        v.get("events"),
        v.get("usageEvents"),
        v.pointer("/data/events"),
        v.pointer("/config/events"),
    ];
    for c in candidates {
        if let Some(arr) = c.and_then(|x| x.as_array()) {
            if arr.iter().any(looks_like_token_event) {
                return Some(arr.iter().collect());
            }
        }
    }
    None
}

fn looks_like_token_event(v: &Value) -> bool {
    v.get("prompt_tokens").is_some()
        || v.get("promptTokens").is_some()
        || v.get("input_tokens").is_some()
        || v.get("inputTokens").is_some()
        || v.get("tokenUsage").is_some()
        || v.get("completion_tokens").is_some()
}

fn map_token_events(v: &Value, import_id: &str, now: &str) -> Vec<EventRow> {
    let events = match extract_token_events(v) {
        Some(e) => e,
        None => return Vec::new(),
    };
    let mut rows = Vec::new();
    for (idx, ev) in events.iter().enumerate() {
        if !looks_like_token_event(ev) {
            continue;
        }
        let prompt = u64_field(ev, &["prompt_tokens", "promptTokens"]).unwrap_or(0);
        let cached = u64_field(ev, &["cached_prompt_tokens", "cachedPromptTokens"]).unwrap_or(0);
        let completion = u64_field(ev, &["completion_tokens", "completionTokens", "output_tokens", "outputTokens"])
            .unwrap_or(0);
        let input = prompt.saturating_sub(cached.min(prompt));
        let cache_read = cached.min(prompt);
        let output = completion;
        let total = if prompt > 0 {
            prompt.saturating_add(completion)
        } else {
            u64_field(ev, &["input_tokens", "inputTokens"]).unwrap_or(0)
                + output
                + u64_field(ev, &["cache_read_tokens", "cacheReadTokens"]).unwrap_or(0)
                + u64_field(ev, &["cache_write_tokens", "cacheWriteTokens"]).unwrap_or(0)
        };
        let model = str_field(ev, &["model", "model_id", "modelId"]).unwrap_or("grok").to_string();
        let ts = str_field(ev, &["ts", "timestamp", "created_at"]).unwrap_or(now);
        let date = if ts.len() >= 10 {
            ts[..10].to_string()
        } else {
            chrono::Utc::now().format("%Y-%m-%d").to_string()
        };
        let identity = format!("grok-api|{date}|{model}|{idx}");
        let raw = format!("grok-api|{machine}|session|{date}|{model}|{identity}", machine = GROK_API_ACCOUNT_MACHINE);
        rows.push(EventRow {
            date: date.clone(),
            record_type: "session".to_string(),
            record_key: identity.clone(),
            source: SOURCE_GROK_API.to_string(),
            machine_name: GROK_API_ACCOUNT_MACHINE.to_string(),
            account_id: String::new(),
            api_key_id: String::new(),
            model_name: model,
            session_id: identity,
            project_path: String::new(),
            input_tokens: if prompt > 0 { input } else { u64_field(ev, &["input_tokens", "inputTokens"]).unwrap_or(0) },
            output_tokens: output,
            cache_creation_tokens: u64_field(ev, &["cache_write_tokens", "cacheWriteTokens"]).unwrap_or(0),
            cache_read_tokens: if prompt > 0 {
                cache_read
            } else {
                u64_field(ev, &["cache_read_tokens", "cacheReadTokens"]).unwrap_or(0)
            },
            reasoning_tokens: u64_field(ev, &["reasoning_tokens", "reasoningTokens"]).unwrap_or(0),
            total_tokens: total,
            cost: f64_field(ev, &["cost", "cost_usd", "costUsd"]).unwrap_or(0.0),
            dedup_key: make_dedup_key(&raw),
            import_id: import_id.to_string(),
            block_id: String::new(),
            start_time: None,
            end_time: None,
            actual_end_time: None,
            is_active: 0,
            is_gap: 0,
            entries: 1,
            burn_rate: 0.0,
            projection: 0.0,
            usage_limit_reset_time: None,
            created_at: now.to_string(),
            updated_at: now.to_string(),
        });
    }
    rows
}

fn spend_row(
    cents: f64,
    period_start: Option<String>,
    period_end: Option<String>,
    import_id: &str,
    now: &str,
) -> EventRow {
    let date = period_start
        .as_deref()
        .filter(|s| s.len() >= 10)
        .map(|s| s[..10].to_string())
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    let raw = format!(
        "grok-api|{machine}|daily|{date}|grok|{date}",
        machine = GROK_API_ACCOUNT_MACHINE
    );
    EventRow {
        date,
        record_type: "daily".to_string(),
        record_key: "grok-api-spend".to_string(),
        source: SOURCE_GROK_API.to_string(),
        machine_name: GROK_API_ACCOUNT_MACHINE.to_string(),
        account_id: String::new(),
        api_key_id: String::new(),
        model_name: "grok".to_string(),
        session_id: String::new(),
        project_path: String::new(),
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        cost: ((cents / 100.0) * 100.0).round() / 100.0,
        dedup_key: make_dedup_key(&raw),
        import_id: import_id.to_string(),
        block_id: String::new(),
        start_time: period_start,
        end_time: period_end,
        actual_end_time: None,
        is_active: 0,
        is_gap: 0,
        entries: 1,
        burn_rate: 0.0,
        projection: 0.0,
        usage_limit_reset_time: None,
        created_at: now.to_string(),
        updated_at: now.to_string(),
    }
}

fn cents_val(v: &Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        return Some(n);
    }
    v.get("val").and_then(|x| x.as_f64()).or_else(|| {
        v.as_str()
            .and_then(|s| s.parse::<f64>().ok())
    })
}

fn spend_cents(v: &Value) -> Option<f64> {
    let paths = [
        "/usage/totalUsed",
        "/usage/includedUsed",
        "/data/usage/totalUsed",
        "/config/usage/totalUsed",
        "/totalUsed",
        "/spendCents",
        "/total_spend_cents",
    ];
    for p in paths {
        if let Some(c) = v.pointer(p).and_then(cents_val) {
            if c.is_finite() {
                return Some(c);
            }
        }
    }
    // onDemandUsed.val is spend cents when present as an object with val,
    // but CodexBar also uses it as a ratio numerator with onDemandCap.
    // Only treat as countable spend when there is no creditUsagePercent-only
    // payload AND no cap (absolute used), or when totalUsed exists (above).
    if has_credits_percent(v) {
        return None;
    }
    let used = v
        .pointer("/config/onDemandUsed")
        .or_else(|| v.pointer("/onDemandUsed"))
        .and_then(cents_val);
    used.filter(|c| c.is_finite())
}

fn has_credits_percent(v: &Value) -> bool {
    v.pointer("/config/creditUsagePercent")
        .or_else(|| v.get("creditUsagePercent"))
        .or_else(|| v.pointer("/data/creditUsagePercent"))
        .and_then(|x| x.as_f64())
        .is_some()
}

fn period_bounds(v: &Value) -> (Option<String>, Option<String>) {
    let start = str_from(
        v,
        &[
            "/config/currentPeriod/start",
            "/billingCycle/billingPeriodStart",
            "/config/billingPeriodStart",
        ],
    );
    let end = str_from(
        v,
        &[
            "/config/currentPeriod/end",
            "/config/billingPeriodEnd",
            "/billingCycle/billingPeriodEnd",
        ],
    );
    (start, end)
}

fn str_from(v: &Value, paths: &[&str]) -> Option<String> {
    for p in paths {
        if let Some(s) = v.pointer(p).and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
            return Some(s.to_string());
        }
    }
    None
}

fn str_field<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
            return Some(s);
        }
    }
    None
}

fn u64_field(v: &Value, keys: &[&str]) -> Option<u64> {
    for k in keys {
        if let Some(n) = v.get(*k) {
            if let Some(u) = n.as_u64() {
                return Some(u);
            }
            if let Some(i) = n.as_i64() {
                return u64::try_from(i).ok();
            }
            if let Some(s) = n.as_str() {
                if let Ok(u) = s.parse::<u64>() {
                    return Some(u);
                }
            }
        }
    }
    None
}

fn f64_field(v: &Value, keys: &[&str]) -> Option<f64> {
    for k in keys {
        if let Some(n) = v.get(*k) {
            if let Some(f) = n.as_f64() {
                return Some(f);
            }
            if let Some(s) = n.as_str() {
                if let Ok(f) = s.parse::<f64>() {
                    return Some(f);
                }
            }
        }
    }
    None
}

fn grok_home() -> PathBuf {
    if let Ok(h) = env::var("GROK_HOME") {
        return PathBuf::from(h);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".grok")
}

/// Bearer from `auth.json`. Expired or missing → None.
pub fn load_grok_bearer(auth_path: Option<&std::path::Path>) -> Option<String> {
    if let Ok(t) = env::var("GROK_OAUTH_TOKEN") {
        let t = t.trim().to_string();
        if !t.is_empty() && !t.starts_with("xai-") {
            return Some(t);
        }
    }
    let path = auth_path
        .map(PathBuf::from)
        .unwrap_or_else(|| grok_home().join("auth.json"));
    let raw = fs::read_to_string(path).ok()?;
    bearer_from_auth_json(&raw)
}

pub fn bearer_from_auth_json(raw: &str) -> Option<String> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let obj = v.as_object()?;
    let mut entries: Vec<(&String, &Value)> = obj.iter().collect();
    entries.sort_by(|(a, _), (b, _)| {
        let rank = |k: &str| {
            if k.starts_with("https://auth.x.ai") {
                0
            } else if k.contains("accounts.x.ai") {
                1
            } else {
                2
            }
        };
        rank(a).cmp(&rank(b))
    });
    for (_, entry) in entries {
        let key = entry.get("key").and_then(|k| k.as_str()).unwrap_or("").trim();
        if key.is_empty() || key.starts_with("xai-") {
            continue;
        }
        if let Some(exp) = entry.get("expires_at") {
            if is_expired(exp) {
                continue;
            }
        }
        return Some(key.to_string());
    }
    None
}

fn is_expired(exp: &Value) -> bool {
    let now = chrono::Utc::now();
    if let Some(s) = exp.as_str() {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
            return dt.with_timezone(&chrono::Utc) <= now;
        }
    }
    if let Some(n) = exp.as_i64() {
        let secs = if n > 1_000_000_000_000 { n / 1000 } else { n };
        return chrono::DateTime::from_timestamp(secs, 0)
            .map(|dt| dt <= now)
            .unwrap_or(true);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    const CREDITS_ONLY: &str = r#"{
      "config": {
        "creditUsagePercent": 42.5,
        "onDemandUsed": { "val": 1234 },
        "onDemandCap": { "val": 10000 },
        "currentPeriod": { "end": "2026-08-25T00:00:00Z" },
        "billingPeriodEnd": "2026-08-25T00:00:00Z"
      }
    }"#;

    /// Shape returned by GET cli-chat-proxy.grok.com/v1/billing?format=credits
    /// (probed 2026-08-19): weekly credits percent, no per-turn tokens.
    const CLI_PROXY_LIVE_SHAPE: &str = r#"{
      "config": {
        "currentPeriod": {
          "type": "USAGE_PERIOD_TYPE_WEEKLY",
          "start": "2026-08-16T08:01:46.444219+00:00",
          "end": "2026-08-23T08:01:46.444219+00:00"
        },
        "creditUsagePercent": 15.0,
        "onDemandCap": { "val": 0 },
        "onDemandUsed": { "val": 0 },
        "productUsage": [
          { "product": "GrokBuild", "usagePercent": 15.0 },
          { "product": "GrokChat" }
        ],
        "isUnifiedBillingUser": true,
        "prepaidBalance": { "val": 0 },
        "topUpMethod": "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
        "billingPeriodStart": "2026-08-16T08:01:46.444219+00:00",
        "billingPeriodEnd": "2026-08-23T08:01:46.444219+00:00"
      }
    }"#;

    const SPEND_CENTS: &str = r#"{
      "billingCycle": {
        "billingPeriodStart": "2026-08-01T00:00:00Z",
        "billingPeriodEnd": "2026-09-01T00:00:00Z"
      },
      "usage": {
        "includedUsed": { "val": 12345 },
        "onDemandUsed": { "val": 0 },
        "totalUsed": { "val": 12345 }
      }
    }"#;

    const TOKEN_EVENTS: &str = r#"{
      "events": [
        {
          "ts": "2026-08-05T10:00:00.000Z",
          "model": "grok-4.5",
          "prompt_tokens": 1000,
          "cached_prompt_tokens": 400,
          "completion_tokens": 50,
          "reasoning_tokens": 40
        }
      ]
    }"#;

    #[test]
    fn credits_percent_is_not_countable_and_maps_to_no_rows() {
        let v: Value = serde_json::from_str(CREDITS_ONLY).unwrap();
        assert_eq!(classify_grok_billing(&v), GrokBillingKind::CreditsPercentOnly);
        let rows = map_grok_billing_json(CREDITS_ONLY, "imp", "2026-08-19 00:00:00").unwrap();
        assert!(
            rows.is_empty(),
            "credits-percent APIs must not fabricate per-turn rows"
        );
    }

    #[test]
    fn cli_proxy_live_credits_shape_does_not_fabricate_turns() {
        let v: Value = serde_json::from_str(CLI_PROXY_LIVE_SHAPE).unwrap();
        assert_eq!(classify_grok_billing(&v), GrokBillingKind::CreditsPercentOnly);
        let rows = map_grok_billing_json(CLI_PROXY_LIVE_SHAPE, "imp", "2026-08-19 00:00:00").unwrap();
        assert!(rows.is_empty());
        assert!(rows.iter().all(|r| r.source != "grok"), "must not replace local grok rows");
    }

    #[test]
    fn spend_cents_maps_one_account_wide_row() {
        let v: Value = serde_json::from_str(SPEND_CENTS).unwrap();
        match classify_grok_billing(&v) {
            GrokBillingKind::SpendCents { cents, .. } => {
                assert!((cents - 12345.0).abs() < 1e-9);
            }
            other => panic!("expected SpendCents, got {other:?}"),
        }
        let rows = map_grok_billing_json(SPEND_CENTS, "imp", "2026-08-19 00:00:00").unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.source, SOURCE_GROK_API);
        assert_eq!(r.machine_name, GROK_API_ACCOUNT_MACHINE);
        assert_ne!(r.machine_name, "test-host");
        assert_eq!(r.record_type, "daily");
        assert!((r.cost - 123.45).abs() < 1e-9, "12345 cents → $123.45, got {}", r.cost);
        assert_eq!(r.total_tokens, 0);
        assert_eq!(r.date, "2026-08-01");
    }

    #[test]
    fn token_events_map_without_replacing_local_grok_mapping() {
        let v: Value = serde_json::from_str(TOKEN_EVENTS).unwrap();
        assert_eq!(classify_grok_billing(&v), GrokBillingKind::TokenEvents);
        let rows = map_grok_billing_json(TOKEN_EVENTS, "imp", "2026-08-19 00:00:00").unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.source, SOURCE_GROK_API);
        assert_eq!(r.machine_name, "account");
        assert_eq!(r.input_tokens, 600);
        assert_eq!(r.cache_read_tokens, 400);
        assert_eq!(r.output_tokens, 50);
        assert_eq!(r.reasoning_tokens, 40);
        assert_eq!(r.total_tokens, 1050);
        assert_eq!(r.model_name, "grok-4.5");
    }

    #[test]
    fn missing_auth_fetch_is_empty() {
        let tmp = tempfile::TempDir::new().unwrap();
        let opts = GrokApiSourceOptions {
            verbose: false,
            import_id: "t".into(),
            auth_path: Some(tmp.path().join("no-auth.json")),
            disable_network: false,
        };
        let src = GrokApiSource::new(opts);
        let result = futures::executor::block_on(async move { src.fetch().await }).unwrap();
        assert_eq!(result.source_name, SOURCE_GROK_API);
        assert!(result.data.events.is_empty());
        assert!(result.error.is_none());
    }

    #[test]
    fn expired_auth_json_yields_no_bearer() {
        let json = r#"{
          "https://auth.x.ai::abc": {
            "key": "eyJhbGciOiJIUzI1NiJ9.e30.sig",
            "expires_at": "2020-01-01T00:00:00Z",
            "email": "a@b.c"
          }
        }"#;
        assert!(bearer_from_auth_json(json).is_none());
    }

    #[test]
    fn unexpired_auth_json_yields_bearer() {
        let json = r#"{
          "https://auth.x.ai::abc": {
            "key": "eyJhbGciOiJIUzI1NiJ9.e30.sig",
            "expires_at": "2099-01-01T00:00:00Z",
            "email": "a@b.c"
          }
        }"#;
        assert_eq!(
            bearer_from_auth_json(json).as_deref(),
            Some("eyJhbGciOiJIUzI1NiJ9.e30.sig")
        );
    }

    #[test]
    fn disable_network_skips_http() {
        let opts = GrokApiSourceOptions {
            disable_network: true,
            import_id: "t".into(),
            ..GrokApiSourceOptions::default()
        };
        let rows = futures::executor::block_on(fetch_grok_api_events(&opts)).unwrap();
        assert!(rows.is_empty());
    }
}
