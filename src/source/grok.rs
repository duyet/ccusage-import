/**
 * Grok Build Source
 *
 * Fetches usage data from local Grok home (`~/.grok` or `GROK_HOME`):
 * - Turn tokens: `logs/unified.jsonl` lines with msg `shell.turn.inference_done`
 * - Model/cwd: `sessions/**/<sid>/summary.json` (fallback: `signals.json`)
 *
 * Token mapping (Grok-specific, cache-inclusive prompt_tokens):
 *   input      = prompt_tokens - cached_prompt_tokens
 *   cache_read = cached_prompt_tokens
 *   output     = completion_tokens
 *   reasoning  = reasoning_tokens (preserved; not double-added into total)
 *   total      = prompt_tokens + completion_tokens
 */

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::Deserialize;
use walkdir::WalkDir;

use crate::model::{DataSource, EventRow, EventsSnapshotData, SourceResult};
use crate::util::date::ch_now;
use crate::util::hash::{hash_project_name_sync, make_dedup_key};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct GrokSourceOptions {
    pub machine_name: String,
    pub hash_projects: bool,
    pub verbose: bool,
    pub days_back: Option<i64>,
    pub since: Option<String>,
    pub end_date: Option<String>,
    pub import_id: String,
    /// Override Grok home (tests). When None, uses `GROK_HOME` or `~/.grok`.
    pub base_dir: Option<PathBuf>,
}

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
struct SessionMeta {
    model: String,
    cwd: String,
}

#[derive(Debug, Deserialize)]
struct LogLine {
    ts: Option<String>,
    sid: Option<String>,
    msg: Option<String>,
    ctx: Option<InferenceCtx>,
}

#[derive(Debug, Deserialize)]
struct InferenceCtx {
    prompt_tokens: Option<u64>,
    cached_prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SummaryFile {
    current_model_id: Option<String>,
    git_root_dir: Option<String>,
    info: Option<SummaryInfo>,
}

#[derive(Debug, Deserialize)]
struct SummaryInfo {
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SignalsFile {
    primary_model_id: Option<String>,
    #[serde(rename = "primaryModelId")]
    primary_model_id_camel: Option<String>,
    models_used: Option<Vec<String>>,
    #[serde(rename = "modelsUsed")]
    models_used_camel: Option<Vec<String>>,
}

/// Normalized token fields from one inference_done turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GrokTokenMapping {
    pub input_tokens: u64,
    pub cache_read_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub total_tokens: u64,
}

/// Map raw Grok inference counters to EventRow token fields.
///
/// `prompt_tokens` is cache-inclusive; `reasoning_tokens` is a subset of
/// `completion_tokens` and must not be double-counted into total.
pub fn map_grok_tokens(
    prompt_tokens: u64,
    cached_prompt_tokens: u64,
    completion_tokens: u64,
    reasoning_tokens: u64,
) -> GrokTokenMapping {
    let cache_read = cached_prompt_tokens.min(prompt_tokens);
    let input = prompt_tokens.saturating_sub(cache_read);
    GrokTokenMapping {
        input_tokens: input,
        cache_read_tokens: cache_read,
        output_tokens: completion_tokens,
        reasoning_tokens,
        total_tokens: prompt_tokens.saturating_add(completion_tokens),
    }
}

/// Long-context pricing threshold used by xAI flagship models (prompt tokens).
const GROK_LONG_CONTEXT_PROMPT: u64 = 200_000;

/// USD per 1M tokens: (input, cached_input, output).
#[derive(Debug, Clone, Copy)]
struct GrokRates {
    input: f64,
    cached: f64,
    output: f64,
}

/// Official xAI text API rates (docs.x.ai, short vs long-context ≥200k prompt).
/// Unknown / future ids fall back to grok-4.5 short rates.
fn grok_rates(model: &str, prompt_tokens: u64) -> GrokRates {
    let m = model.to_ascii_lowercase();
    let long = prompt_tokens >= GROK_LONG_CONTEXT_PROMPT;

    // Fast / volume tiers (no dual long-context table published for these)
    if m.contains("4.1-fast") || m.contains("4-1-fast") || m.contains("code-fast") {
        return GrokRates {
            input: 0.20,
            cached: 0.05,
            output: if m.contains("code") { 1.50 } else { 0.50 },
        };
    }

    // grok-build-0.1
    if m.contains("build") {
        return if long {
            GrokRates {
                input: 2.00,
                cached: 0.40,
                output: 4.00,
            }
        } else {
            GrokRates {
                input: 1.00,
                cached: 0.20,
                output: 2.00,
            }
        };
    }

    // grok-4.5 flagship
    if m.contains("4.5") || m.contains("4-5") {
        return if long {
            GrokRates {
                input: 4.00,
                cached: 0.60,
                output: 12.00,
            }
        } else {
            GrokRates {
                input: 2.00,
                cached: 0.30,
                output: 6.00,
            }
        };
    }

    // grok-4.3 / grok-4.20* / multi-agent / reasoning SKUs
    if m.contains("4.3")
        || m.contains("4-3")
        || m.contains("4.20")
        || m.contains("4-20")
        || m.contains("multi-agent")
    {
        return if long {
            GrokRates {
                input: 2.50,
                cached: 0.40,
                output: 5.00,
            }
        } else {
            GrokRates {
                input: 1.25,
                cached: 0.20,
                output: 2.50,
            }
        };
    }

    // Legacy grok-3 / unknown → treat as 4.5 short (conservative mid-tier)
    if long {
        GrokRates {
            input: 4.00,
            cached: 0.60,
            output: 12.00,
        }
    } else {
        GrokRates {
            input: 2.00,
            cached: 0.30,
            output: 6.00,
        }
    }
}

/// Estimate USD cost for one Grok turn from token counts + model id.
///
/// Logs do not include billed cost — we price from xAI public rates.
/// Long-context (≥200k prompt) rates apply to **all** tokens in that request.
pub fn estimate_grok_cost(
    model: &str,
    input_tokens: u64,
    cache_read_tokens: u64,
    output_tokens: u64,
    prompt_tokens: u64,
) -> f64 {
    let rates = grok_rates(model, prompt_tokens);
    let cost = (input_tokens as f64 / 1_000_000.0) * rates.input
        + (cache_read_tokens as f64 / 1_000_000.0) * rates.cached
        + (output_tokens as f64 / 1_000_000.0) * rates.output;
    // 8 decimal places — same rounding used by distribute_cost elsewhere
    (cost * 1e8).round() / 1e8
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

pub struct GrokSource {
    opts: GrokSourceOptions,
}

impl GrokSource {
    pub fn new(opts: GrokSourceOptions) -> Self {
        Self { opts }
    }

    pub fn name(&self) -> &'static str {
        "grok"
    }
}

#[async_trait]
impl DataSource for GrokSource {
    fn name(&self) -> &'static str {
        "grok"
    }

    async fn fetch(&self) -> anyhow::Result<SourceResult> {
        let events = fetch_grok_events(&self.opts)?;
        if self.opts.verbose {
            eprintln!("Grok Source parsed {} rows.", events.len());
        }
        Ok(SourceResult {
            source_name: self.name().to_string(),
            data: EventsSnapshotData { events },
            fetched_at: chrono::Utc::now().to_rfc3339(),
            error: None,
        })
    }
}

/// Pure entry used by fetch and unit tests (no async, injectable options).
pub fn fetch_grok_events(opts: &GrokSourceOptions) -> anyhow::Result<Vec<EventRow>> {
    let effective_since = if let Some(s) = &opts.since {
        Some(s.clone())
    } else if let Some(days) = opts.days_back {
        if days > 0 {
            let d = chrono::Utc::now() - chrono::Duration::days(days);
            Some(d.format("%Y-%m-%d").to_string())
        } else {
            None
        }
    } else {
        None
    };

    let base_dir = if let Some(ref d) = opts.base_dir {
        d.clone()
    } else if let Ok(h) = env::var("GROK_HOME") {
        PathBuf::from(h)
    } else {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        home.join(".grok")
    };

    let log_path = base_dir.join("logs").join("unified.jsonl");
    let mut events: Vec<EventRow> = Vec::new();
    let now = ch_now();

    if !log_path.exists() {
        if opts.verbose {
            eprintln!("Grok unified log not found: {}", log_path.display());
        }
        return Ok(events);
    }

    let session_meta = load_session_meta_map(&base_dir.join("sessions"));

    // Aggregate: session_id -> totals
    struct SessionAgg {
        input: u64,
        output: u64,
        cache_read: u64,
        reasoning: u64,
        total: u64,
        cost: f64,
        turns: u32,
        min_ts: String,
        max_ts: String,
        model: String,
        cwd: String,
        date: String,
    }

    let mut session_sums: HashMap<String, SessionAgg> = HashMap::new();
    // daily key: date|model → (input, output, cache_read, reasoning, total, cost, turns, cwd)
    let mut daily_sums: HashMap<String, (u64, u64, u64, u64, u64, f64, u32, String)> = HashMap::new();

    let file = fs::File::open(&log_path)?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Fast path: skip non-inference lines without full JSON parse.
        if !trimmed.contains("shell.turn.inference_done") {
            continue;
        }

        let parsed: LogLine = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if parsed.msg.as_deref() != Some("shell.turn.inference_done") {
            continue;
        }
        let sid = match parsed.sid {
            Some(ref s) if !s.is_empty() => s.clone(),
            _ => continue,
        };
        let ts = match parsed.ts {
            Some(ref t) if t.len() >= 10 => t.clone(),
            _ => continue,
        };
        let date = ts[..10].to_string();

        if let Some(ref eff) = effective_since {
            if &date < eff {
                continue;
            }
        }
        if let Some(ref ed) = opts.end_date {
            if &date > ed {
                continue;
            }
        }

        let ctx = match parsed.ctx {
            Some(c) => c,
            None => continue,
        };
        let prompt = ctx.prompt_tokens.unwrap_or(0);
        let cached = ctx.cached_prompt_tokens.unwrap_or(0);
        let completion = ctx.completion_tokens.unwrap_or(0);
        let reasoning = ctx.reasoning_tokens.unwrap_or(0);
        let mapped = map_grok_tokens(prompt, cached, completion, reasoning);
        if mapped.total_tokens == 0 {
            continue;
        }

        let meta = session_meta.get(&sid).cloned().unwrap_or_default();
        let model = if meta.model.is_empty() {
            "unknown".to_string()
        } else {
            meta.model.clone()
        };
        let cwd = meta.cwd;

        // Price each turn (long-context threshold is per-request prompt size).
        let turn_cost = estimate_grok_cost(
            &model,
            mapped.input_tokens,
            mapped.cache_read_tokens,
            mapped.output_tokens,
            prompt,
        );

        let entry = session_sums.entry(sid).or_insert_with(|| SessionAgg {
            input: 0,
            output: 0,
            cache_read: 0,
            reasoning: 0,
            total: 0,
            cost: 0.0,
            turns: 0,
            min_ts: ts.clone(),
            max_ts: ts.clone(),
            model: model.clone(),
            cwd: cwd.clone(),
            date: date.clone(),
        });
        entry.input += mapped.input_tokens;
        entry.output += mapped.output_tokens;
        entry.cache_read += mapped.cache_read_tokens;
        entry.reasoning += mapped.reasoning_tokens;
        entry.total += mapped.total_tokens;
        entry.cost += turn_cost;
        entry.turns += 1;
        if ts < entry.min_ts {
            entry.min_ts = ts.clone();
        }
        if ts > entry.max_ts {
            entry.max_ts = ts.clone();
            // Prefer the date of the latest activity for multi-day sessions.
            entry.date = date.clone();
        }
        if entry.model == "unknown" && model != "unknown" {
            entry.model = model.clone();
        }
        if entry.cwd.is_empty() && !cwd.is_empty() {
            entry.cwd = cwd.clone();
        }

        let daily_key = format!("{}|{}", date, model);
        let d = daily_sums
            .entry(daily_key)
            .or_insert((0, 0, 0, 0, 0, 0.0, 0, cwd.clone()));
        d.0 += mapped.input_tokens;
        d.1 += mapped.output_tokens;
        d.2 += mapped.cache_read_tokens;
        d.3 += mapped.reasoning_tokens;
        d.4 += mapped.total_tokens;
        d.5 += turn_cost;
        d.6 += 1;
        if d.7.is_empty() && !cwd.is_empty() {
            d.7 = cwd;
        }
    }

    for (session_id, agg) in &session_sums {
        let hashed_session_id = hash_project_name_sync(session_id, opts.hash_projects);
        let proj_raw = if agg.cwd.is_empty() {
            session_id.as_str()
        } else {
            agg.cwd.as_str()
        };
        let hashed_proj = hash_project_name_sync(proj_raw, opts.hash_projects);

        let raw_session_key = format!(
            "grok|{}|session|{}|{}|{}",
            opts.machine_name, agg.date, agg.model, hashed_session_id
        );
        let session_dedup_key = make_dedup_key(&raw_session_key);

        let start_time = format_ch_datetime(&agg.min_ts);
        let end_time = format_ch_datetime(&agg.max_ts);

        events.push(EventRow {
            date: agg.date.clone(),
            record_type: "session".to_string(),
            record_key: hashed_session_id.clone(),
            source: "grok".to_string(),
            machine_name: opts.machine_name.clone(),
            model_name: agg.model.clone(),
            session_id: hashed_session_id,
            project_path: hashed_proj,
            input_tokens: agg.input,
            output_tokens: agg.output,
            cache_creation_tokens: 0,
            cache_read_tokens: agg.cache_read,
            reasoning_tokens: agg.reasoning,
            total_tokens: agg.total,
            cost: (agg.cost * 100.0).round() / 100.0,
            dedup_key: session_dedup_key,
            import_id: opts.import_id.clone(),
            start_time: Some(start_time),
            end_time: Some(end_time),
            actual_end_time: None,
            is_active: 0,
            is_gap: 0,
            entries: agg.turns,
            burn_rate: 0.0,
            projection: 0.0,
            usage_limit_reset_time: None,
            block_id: String::new(),
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    for (key, sum) in &daily_sums {
        let (input, output, cache_read, reasoning, total, cost, turns, ref cwd) = *sum;
        let parts: Vec<&str> = key.splitn(2, '|').collect();
        if parts.len() < 2 {
            continue;
        }
        let date = parts[0];
        let model = parts[1];
        let hashed_proj =
            hash_project_name_sync(if cwd.is_empty() { "unknown" } else { cwd }, opts.hash_projects);

        let raw_daily_key = format!(
            "grok|{}|daily|{}|{}|{}",
            opts.machine_name, date, model, date
        );
        let daily_dedup_key = make_dedup_key(&raw_daily_key);

        events.push(EventRow {
            date: date.to_string(),
            record_type: "daily".to_string(),
            record_key: date.to_string(),
            source: "grok".to_string(),
            machine_name: opts.machine_name.clone(),
            model_name: model.to_string(),
            session_id: String::new(),
            project_path: hashed_proj,
            input_tokens: input,
            output_tokens: output,
            cache_creation_tokens: 0,
            cache_read_tokens: cache_read,
            reasoning_tokens: reasoning,
            total_tokens: total,
            cost: (cost * 100.0).round() / 100.0,
            dedup_key: daily_dedup_key,
            import_id: opts.import_id.clone(),
            start_time: None,
            end_time: None,
            actual_end_time: None,
            is_active: 0,
            is_gap: 0,
            entries: turns,
            burn_rate: 0.0,
            projection: 0.0,
            usage_limit_reset_time: None,
            block_id: String::new(),
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    Ok(events)
}

fn format_ch_datetime(iso: &str) -> String {
    // "2026-08-07T03:41:08.619Z" → "2026-08-07 03:41:08"
    if iso.len() >= 19 {
        let date = &iso[0..10];
        let time = &iso[11..19];
        format!("{} {}", date, time)
    } else {
        iso.to_string()
    }
}

/// Build sid → {model, cwd} from sessions tree.
fn load_session_meta_map(sessions_dir: &Path) -> HashMap<String, SessionMeta> {
    let mut map = HashMap::new();
    if !sessions_dir.is_dir() {
        return map;
    }

    for entry in WalkDir::new(sessions_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };

        if file_name == "summary.json" {
            let sid = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if sid.is_empty() {
                continue;
            }
            if let Ok(text) = fs::read_to_string(path) {
                if let Ok(summary) = serde_json::from_str::<SummaryFile>(&text) {
                    let model = summary.current_model_id.unwrap_or_default();
                    let cwd = summary
                        .info
                        .and_then(|i| i.cwd)
                        .or(summary.git_root_dir)
                        .unwrap_or_default()
                        .trim_end_matches('/')
                        .to_string();
                    let e = map.entry(sid.to_string()).or_default();
                    if !model.is_empty() {
                        e.model = model;
                    }
                    if !cwd.is_empty() {
                        e.cwd = cwd;
                    }
                }
            }
            continue;
        }

        if file_name == "signals.json" {
            let sid = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if sid.is_empty() {
                continue;
            }
            // Only fill gaps when summary did not set model.
            let needs_model = map.get(sid).map(|m| m.model.is_empty()).unwrap_or(true);
            if !needs_model {
                continue;
            }
            if let Ok(text) = fs::read_to_string(path) {
                if let Ok(signals) = serde_json::from_str::<SignalsFile>(&text) {
                    let model = signals
                        .primary_model_id
                        .or(signals.primary_model_id_camel)
                        .or_else(|| {
                            signals
                                .models_used
                                .or(signals.models_used_camel)
                                .and_then(|v| v.into_iter().next())
                        })
                        .unwrap_or_default();
                    if !model.is_empty() {
                        map.entry(sid.to_string()).or_default().model = model;
                    }
                }
            }
        }
    }

    map
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write_fixture(dir: &Path, relative: &str, content: &str) {
        let path = dir.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    fn base_opts(base: PathBuf) -> GrokSourceOptions {
        GrokSourceOptions {
            machine_name: "test-host".into(),
            hash_projects: false,
            verbose: false,
            days_back: None,
            since: None,
            end_date: None,
            import_id: "import-test".into(),
            base_dir: Some(base),
        }
    }

    #[test]
    fn map_tokens_non_cached_and_no_double_count_reasoning() {
        // Sample from live unified.jsonl:
        // prompt=147462, cached=131200, completion=533, reasoning=530
        let m = map_grok_tokens(147462, 131200, 533, 530);
        assert_eq!(m.input_tokens, 147462 - 131200);
        assert_eq!(m.cache_read_tokens, 131200);
        assert_eq!(m.output_tokens, 533);
        assert_eq!(m.reasoning_tokens, 530);
        assert_eq!(m.total_tokens, 147462 + 533);
        // reasoning must not be added on top of completion
        assert_ne!(m.total_tokens, 147462 + 533 + 530);
    }

    #[test]
    fn map_tokens_cached_exceeds_prompt_clamps() {
        let m = map_grok_tokens(100, 150, 10, 5);
        assert_eq!(m.cache_read_tokens, 100);
        assert_eq!(m.input_tokens, 0);
        assert_eq!(m.total_tokens, 110);
    }

    #[test]
    fn estimate_cost_grok_45_short_context() {
        // 1M input + 0.5M cached + 0.25M output @ $2 / $0.30 / $6
        let c = estimate_grok_cost("grok-4.5", 1_000_000, 500_000, 250_000, 100_000);
        assert!((c - (2.0 + 0.15 + 1.5)).abs() < 1e-9);
    }

    #[test]
    fn estimate_cost_grok_45_long_context_doubles() {
        // prompt ≥ 200k → $4 / $0.60 / $12
        let c = estimate_grok_cost("grok-4.5", 1_000_000, 500_000, 250_000, 200_000);
        assert!((c - (4.0 + 0.30 + 3.0)).abs() < 1e-9);
    }

    #[test]
    fn estimate_cost_zero_tokens_is_zero() {
        assert_eq!(estimate_grok_cost("grok-4.5", 0, 0, 0, 0), 0.0);
    }

    #[test]
    fn name_is_grok() {
        let src = GrokSource::new(base_opts(PathBuf::from("/tmp")));
        assert_eq!(src.name(), "grok");
    }

    #[test]
    fn missing_home_returns_empty_ok() {
        let tmp = TempDir::new().unwrap();
        let empty = tmp.path().join("no-such-grok-home");
        let events = fetch_grok_events(&base_opts(empty)).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn fixture_parse_mapping_model_join_and_filters() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();

        // Session with model + cwd
        write_fixture(
            base,
            "sessions/%2FUsers%2Fme%2Fproj/sid-aaa/summary.json",
            r#"{
              "info": {"id": "sid-aaa", "cwd": "/Users/me/proj"},
              "current_model_id": "grok-4.5",
              "git_root_dir": "/Users/me/proj/"
            }"#,
        );
        // Session without summary model — signals fallback
        write_fixture(
            base,
            "sessions/%2FUsers%2Fme%2Fother/sid-bbb/signals.json",
            r#"{"primaryModelId":"grok-3","modelsUsed":["grok-3"]}"#,
        );

        let log = r#"
{"ts":"2026-08-05T10:00:00.000Z","src":"shell","sid":"sid-aaa","msg":"shell.turn.inference_done","ctx":{"prompt_tokens":1000,"cached_prompt_tokens":400,"completion_tokens":50,"reasoning_tokens":40}}
{"ts":"2026-08-05T10:01:00.000Z","src":"shell","sid":"sid-aaa","msg":"shell.tool.exec_done","ctx":{"tool_name":"read_file"}}
{"ts":"2026-08-05T11:00:00.000Z","src":"shell","sid":"sid-aaa","msg":"shell.turn.inference_done","ctx":{"prompt_tokens":2000,"cached_prompt_tokens":1500,"completion_tokens":100,"reasoning_tokens":80}}
{"ts":"2026-08-06T09:00:00.000Z","src":"shell","sid":"sid-bbb","msg":"shell.turn.inference_done","ctx":{"prompt_tokens":500,"cached_prompt_tokens":0,"completion_tokens":20,"reasoning_tokens":10}}
{"ts":"2026-08-07T12:00:00.000Z","src":"shell","sid":"sid-ccc","msg":"shell.turn.inference_done","ctx":{"prompt_tokens":300,"cached_prompt_tokens":100,"completion_tokens":30,"reasoning_tokens":25}}
{"ts":"2026-08-07T12:00:01.000Z","src":"shell","sid":"sid-zero","msg":"shell.turn.inference_done","ctx":{"prompt_tokens":0,"cached_prompt_tokens":0,"completion_tokens":0,"reasoning_tokens":0}}
{"ts":"not-json
"#;
        write_fixture(base, "logs/unified.jsonl", log.trim_start());

        // Full window
        let events = fetch_grok_events(&base_opts(base.to_path_buf())).unwrap();
        assert!(!events.is_empty());

        let sessions: Vec<_> = events
            .iter()
            .filter(|e| e.record_type == "session")
            .collect();
        let dailies: Vec<_> = events
            .iter()
            .filter(|e| e.record_type == "daily")
            .collect();

        // sid-aaa (2 turns), sid-bbb, sid-ccc; zero-token skipped
        assert_eq!(sessions.len(), 3);
        assert!(!dailies.is_empty());

        let aaa = sessions
            .iter()
            .find(|e| e.session_id == "sid-aaa")
            .expect("sid-aaa session");
        assert_eq!(aaa.source, "grok");
        assert_eq!(aaa.model_name, "grok-4.5");
        assert_eq!(aaa.project_path, "/Users/me/proj");
        // turn1: in=600, cr=400, out=50, r=40, tot=1050
        // turn2: in=500, cr=1500, out=100, r=80, tot=2100
        assert_eq!(aaa.input_tokens, 600 + 500);
        assert_eq!(aaa.cache_read_tokens, 400 + 1500);
        assert_eq!(aaa.output_tokens, 50 + 100);
        assert_eq!(aaa.reasoning_tokens, 40 + 80);
        assert_eq!(aaa.total_tokens, 1050 + 2100);
        assert_eq!(aaa.cache_creation_tokens, 0);
        // grok-4.5 short rates: $2/$0.30/$6 per 1M
        // turn1: 600*2 + 400*0.30 + 50*6 = 1200+120+300 = 1620 / 1e6
        // turn2: 500*2 + 1500*0.30 + 100*6 = 1000+450+600 = 2050 / 1e6
        // total ≈ 0.00367 → rounded to 0.00 at cents
        assert!(aaa.cost >= 0.0);
        let expected_aaa = estimate_grok_cost("grok-4.5", 600, 400, 50, 1000)
            + estimate_grok_cost("grok-4.5", 500, 1500, 100, 2000);
        assert!((aaa.cost - (expected_aaa * 100.0).round() / 100.0).abs() < 1e-9);
        assert_eq!(aaa.entries, 2);
        assert!(aaa.dedup_key.len() == 16);
        assert_eq!(aaa.start_time.as_deref(), Some("2026-08-05 10:00:00"));
        assert_eq!(aaa.end_time.as_deref(), Some("2026-08-05 11:00:00"));

        let bbb = sessions
            .iter()
            .find(|e| e.session_id == "sid-bbb")
            .expect("sid-bbb");
        assert_eq!(bbb.model_name, "grok-3");
        assert_eq!(bbb.input_tokens, 500);
        assert_eq!(bbb.cache_read_tokens, 0);
        assert_eq!(bbb.total_tokens, 520);

        let ccc = sessions
            .iter()
            .find(|e| e.session_id == "sid-ccc")
            .expect("sid-ccc");
        assert_eq!(ccc.model_name, "unknown");
        assert_eq!(ccc.input_tokens, 200);
        assert_eq!(ccc.cache_read_tokens, 100);
        assert_eq!(ccc.output_tokens, 30);
        assert_eq!(ccc.reasoning_tokens, 25);
        assert_eq!(ccc.total_tokens, 330);

        // Daily for 2026-08-05 + grok-4.5 should match aaa totals
        let daily_aaa = dailies
            .iter()
            .find(|e| e.date == "2026-08-05" && e.model_name == "grok-4.5")
            .expect("daily grok-4.5");
        assert_eq!(daily_aaa.input_tokens, aaa.input_tokens);
        assert_eq!(daily_aaa.total_tokens, aaa.total_tokens);
        assert_eq!(daily_aaa.entries, 2);
        assert_eq!(daily_aaa.session_id, "");

        // Date filter: since 2026-08-06 → only bbb + ccc sessions
        let mut opts = base_opts(base.to_path_buf());
        opts.since = Some("2026-08-06".into());
        let filtered = fetch_grok_events(&opts).unwrap();
        let filt_sessions: Vec<_> = filtered
            .iter()
            .filter(|e| e.record_type == "session")
            .map(|e| e.session_id.as_str())
            .collect();
        assert!(filt_sessions.contains(&"sid-bbb"));
        assert!(filt_sessions.contains(&"sid-ccc"));
        assert!(!filt_sessions.contains(&"sid-aaa"));

        // end_date filter
        opts.since = None;
        opts.end_date = Some("2026-08-05".into());
        let end_f = fetch_grok_events(&opts).unwrap();
        let end_s: Vec<_> = end_f
            .iter()
            .filter(|e| e.record_type == "session")
            .map(|e| e.session_id.as_str())
            .collect();
        assert_eq!(end_s, vec!["sid-aaa"]);
    }

    #[test]
    fn fetch_async_ok_on_fixture() {
        let tmp = TempDir::new().unwrap();
        write_fixture(
            tmp.path(),
            "logs/unified.jsonl",
            r#"{"ts":"2026-08-08T01:00:00.000Z","sid":"s1","msg":"shell.turn.inference_done","ctx":{"prompt_tokens":10,"cached_prompt_tokens":2,"completion_tokens":3,"reasoning_tokens":1}}
"#,
        );
        let src = GrokSource::new(base_opts(tmp.path().to_path_buf()));
        let result = futures::executor::block_on(async move { src.fetch().await }).unwrap();
        assert_eq!(result.source_name, "grok");
        assert_eq!(result.data.events.len(), 2); // 1 session + 1 daily
        let sess = result
            .data
            .events
            .iter()
            .find(|e| e.record_type == "session")
            .unwrap();
        assert_eq!(sess.input_tokens, 8);
        assert_eq!(sess.cache_read_tokens, 2);
        assert_eq!(sess.output_tokens, 3);
        assert_eq!(sess.reasoning_tokens, 1);
        assert_eq!(sess.total_tokens, 13);
    }
}
