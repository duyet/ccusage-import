use std::time::Instant;

use worker::{Env, Fetch, Headers, Method, Request, RequestInit};

use crate::auth::opt_secret;
use crate::types::{sql_literal, EventRow, PingSample, SinkAck};

pub fn clickhouse_configured(env: &Env) -> bool {
    !opt_secret(env, "CH_HOST").is_empty()
}

pub fn motherduck_configured(env: &Env) -> bool {
    !opt_secret(env, "MOTHERDUCK_TOKEN").is_empty()
}

pub async fn fanout_write(env: &Env, rows: &[EventRow]) -> Vec<SinkAck> {
    let mut out = Vec::new();
    if clickhouse_configured(env) {
        out.push(write_clickhouse(env, rows).await);
    }
    if motherduck_configured(env) {
        out.push(write_motherduck(env, rows).await);
    }
    out
}

pub async fn collect_pings(env: &Env) -> Vec<PingSample> {
    let mut out = Vec::new();
    if clickhouse_configured(env) {
        out.push(timed("clickhouse", ping_clickhouse(env)).await);
    }
    if motherduck_configured(env) {
        out.push(timed("motherduck", ping_motherduck(env)).await);
    }
    out
}

async fn timed<F>(name: &str, fut: F) -> PingSample
where
    F: core::future::Future<Output = std::result::Result<(), String>>,
{
    let start = Instant::now();
    match fut.await {
        Ok(()) => PingSample {
            name: name.into(),
            ok: true,
            latency_ms: start.elapsed().as_millis() as u64,
            error: None,
        },
        Err(e) => PingSample {
            name: name.into(),
            ok: false,
            latency_ms: start.elapsed().as_millis() as u64,
            error: Some(e),
        },
    }
}

async fn ping_clickhouse(env: &Env) -> std::result::Result<(), String> {
    clickhouse_query(env, "SELECT 1").await.map(|_| ())
}

async fn ping_motherduck(env: &Env) -> std::result::Result<(), String> {
    motherduck_query(env, "SELECT 1").await.map(|_| ())
}

async fn write_clickhouse(env: &Env, rows: &[EventRow]) -> SinkAck {
    let start = Instant::now();
    if let Err(e) = ensure_ch_columns(env).await {
        return ack("clickhouse", 0, start, Some(e));
    }
    if rows.is_empty() {
        return ack("clickhouse", 0, start, None);
    }
    let keys: Vec<String> = rows
        .iter()
        .map(|r| r.dedup_key.clone())
        .filter(|k| !k.is_empty())
        .collect();
    for chunk in keys.chunks(200) {
        let list = chunk.iter().map(|k| sql_literal(k)).collect::<Vec<_>>().join(",");
        if let Err(e) = clickhouse_query(
            env,
            &format!("ALTER TABLE ccusage_events DELETE WHERE dedup_key IN ({list})"),
        )
        .await
        {
            return ack("clickhouse", 0, start, Some(e));
        }
    }
    for chunk in rows.chunks(500) {
        if let Err(e) = clickhouse_insert(env, chunk).await {
            return ack("clickhouse", 0, start, Some(e));
        }
    }
    ack("clickhouse", rows.len() as u64, start, None)
}

async fn write_motherduck(env: &Env, rows: &[EventRow]) -> SinkAck {
    let start = Instant::now();
    if rows.is_empty() {
        return ack("motherduck", 0, start, None);
    }
    let keys: Vec<String> = rows
        .iter()
        .map(|r| r.dedup_key.clone())
        .filter(|k| !k.is_empty())
        .collect();
    for chunk in keys.chunks(200) {
        let list = chunk.iter().map(|k| sql_literal(k)).collect::<Vec<_>>().join(",");
        if let Err(e) = motherduck_query(
            env,
            &format!("DELETE FROM ccusage_events WHERE dedup_key IN ({list})"),
        )
        .await
        {
            return ack("motherduck", 0, start, Some(e));
        }
    }
    ack("motherduck", rows.len() as u64, start, None)
}

fn ack(name: &str, rows: u64, start: Instant, error: Option<String>) -> SinkAck {
    SinkAck {
        name: name.into(),
        rows,
        duration_ms: start.elapsed().as_millis() as u64,
        error,
    }
}

async fn ensure_ch_columns(env: &Env) -> std::result::Result<(), String> {
    let _ = clickhouse_query(
        env,
        "ALTER TABLE ccusage_events ADD COLUMN IF NOT EXISTS account_id String DEFAULT ''",
    )
    .await;
    let _ = clickhouse_query(
        env,
        "ALTER TABLE ccusage_events ADD COLUMN IF NOT EXISTS api_key_id String DEFAULT ''",
    )
    .await;
    Ok(())
}

pub async fn clickhouse_query(env: &Env, sql: &str) -> std::result::Result<String, String> {
    let host = opt_secret(env, "CH_HOST");
    let port = opt_secret(env, "CH_PORT");
    let port = if port.is_empty() { "8123".into() } else { port };
    let user = opt_secret(env, "CH_USER");
    let pass = opt_secret(env, "CH_PASSWORD");
    let db = opt_secret(env, "CH_DATABASE");
    let proto = opt_secret(env, "CH_PROTOCOL");
    let proto = if proto.is_empty() { "http".into() } else { proto };
    let mut url = format!("{proto}://{host}:{port}/");
    if !db.is_empty() {
        url.push_str(&format!("?database={}", urlencoding(&db)));
    }
    http_post(&url, sql, Some((&user, &pass))).await
}

async fn clickhouse_insert(env: &Env, rows: &[EventRow]) -> std::result::Result<(), String> {
    let mut body = String::new();
    for row in rows {
        body.push_str(&serde_json::to_string(row).map_err(|e| e.to_string())?);
        body.push('\n');
    }
    let host = opt_secret(env, "CH_HOST");
    let port = opt_secret(env, "CH_PORT");
    let port = if port.is_empty() { "8123".into() } else { port };
    let user = opt_secret(env, "CH_USER");
    let pass = opt_secret(env, "CH_PASSWORD");
    let proto = opt_secret(env, "CH_PROTOCOL");
    let proto = if proto.is_empty() { "http".into() } else { proto };
    let url = format!("{proto}://{host}:{port}/?query=INSERT+INTO+ccusage_events+FORMAT+JSONEachRow");
    http_post(&url, &body, Some((&user, &pass))).await.map(|_| ())
}

pub async fn motherduck_query(env: &Env, sql: &str) -> std::result::Result<String, String> {
    let token = opt_secret(env, "MOTHERDUCK_TOKEN");
    let database = opt_secret(env, "MOTHERDUCK_DATABASE");
    let database = if database.is_empty() {
        "ccusage".into()
    } else {
        database
    };
    let url = opt_secret(env, "MOTHERDUCK_SQL_URL");
    let url = if url.is_empty() {
        "https://api.motherduck.com/v1/query".into()
    } else {
        url
    };
    let body = serde_json::json!({ "sql": format!("USE {database};\n{sql}"), "database": database });
    http_post_json(&url, &body.to_string(), Some(&token)).await
}

async fn http_post(url: &str, body: &str, basic: Option<(&str, &str)>) -> std::result::Result<String, String> {
    let headers = Headers::new();
    headers
        .set("content-type", "text/plain; charset=UTF-8")
        .map_err(|e| e.to_string())?;
    if let Some((user, pass)) = basic {
        let raw = format!("{user}:{pass}");
        let b64 = base64(&raw);
        headers
            .set("authorization", &format!("Basic {b64}"))
            .map_err(|e| e.to_string())?;
    }
    fetch_post(url, headers, body).await
}

async fn http_post_json(url: &str, body: &str, bearer: Option<&str>) -> std::result::Result<String, String> {
    let headers = Headers::new();
    headers
        .set("content-type", "application/json")
        .map_err(|e| e.to_string())?;
    if let Some(t) = bearer {
        headers
            .set("authorization", &format!("Bearer {t}"))
            .map_err(|e| e.to_string())?;
    }
    fetch_post(url, headers, body).await
}

async fn fetch_post(url: &str, headers: Headers, body: &str) -> std::result::Result<String, String> {
    let mut init = RequestInit::new();
    init.with_method(Method::Post);
    init.with_headers(headers);
    init.with_body(Some(wasm_bindgen::JsValue::from_str(body)));
    let req = Request::new_with_init(url, &init).map_err(|e| e.to_string())?;
    let mut resp = Fetch::Request(req).send().await.map_err(|e| e.to_string())?;
    let status = resp.status_code();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!("http {status}: {}", text.chars().take(400).collect::<String>()));
    }
    Ok(text)
}

fn urlencoding(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn base64(input: &str) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
        out.push(T[(b0 >> 2) as usize] as char);
        out.push(T[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(T[(((b1 & 15) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < bytes.len() {
            out.push(T[(b2 & 63) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

pub fn parse_json_each_row(text: &str) -> Vec<crate::types::AnalyticsPoint> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        out.push(crate::types::AnalyticsPoint {
            date: v.get("date").and_then(|x| x.as_str()).unwrap_or("").into(),
            source: v.get("source").and_then(|x| x.as_str()).unwrap_or("").into(),
            model_name: v.get("model_name").and_then(|x| x.as_str()).unwrap_or("").into(),
            cost: v.get("cost").and_then(|x| x.as_f64()).unwrap_or(0.0),
            total_tokens: v
                .get("total_tokens")
                .and_then(|x| x.as_u64().or_else(|| x.as_i64().map(|n| n.max(0) as u64)))
                .unwrap_or(0),
            entries: v
                .get("entries")
                .and_then(|x| x.as_u64().or_else(|| x.as_i64().map(|n| n.max(0) as u64)))
                .unwrap_or(0),
        });
    }
    out
}
